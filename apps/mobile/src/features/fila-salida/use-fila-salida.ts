import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoFilaSalida } from '@quivo/shared';
import { anunciarAvisoEnCanal } from '../operacion/anuncio-punto-control';
import { registrarLlegada, registrarSalida } from './fila-salida-acciones';
import { ultimoFixFila } from './fila-salida-deteccion';
import {
  TEXTO_AVISO_FILA,
  TITULO_AVISO_FILA,
  ahoraCorregido,
  debeAvisar,
  desfaseReloj,
  estaDemorado,
  habilitadoLocal,
  idAvisoFila,
  restanteMs,
  textoAccesible,
  textoBoton,
  textoHoraSalida,
  textoPosicion,
  textoTurno,
} from './fila-salida-core';
import { estaCercaDeTerminal, type TerminalZona } from './zona-terminal';

/** Último `etaTs` ya avisado en primer plano (módulo: sobrevive a remontar la pantalla). */
let etaAvisado: string | null = null;

interface Params {
  /** Del cache de vuelta-actual (`useVueltaActual`): este hook no consulta la red por su cuenta. */
  fila: EstadoFilaSalida | null;
  recibidoEn: number | null;
  tracking: boolean;
  terminal: TerminalZona | null;
  posicion: { lat: number; lng: number } | null;
  obtenerAccessToken: () => Promise<string | null>;
}

export interface VistaFilaSalida {
  posicionTexto: string;
  horaSalidaTexto: string | null;
  turnoTexto: string;
  botonTexto: string;
  /** Cambia solo por minuto o al habilitarse: para la región viva del lector de pantalla. */
  anuncioAccesible: string;
  habilitado: boolean;
  demorado: boolean;
}

export interface FilaSalidaUi {
  vista: VistaFilaSalida | null;
  ocupado: boolean;
  error: string | null;
  /** Se ofrece el botón de respaldo "Estoy en la fila". */
  puedeEstoyEnLaFila: boolean;
  salir: () => void;
  estoyEnLaFila: () => void;
}

export function useFilaSalida({
  fila,
  recibidoEn,
  tracking,
  terminal,
  posicion,
  obtenerAccessToken,
}: Params): FilaSalidaUi {
  const [ahora, setAhora] = useState(() => Date.now());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ocupadoRef = useRef(false);
  const tokenRef = useRef(obtenerAccessToken);
  tokenRef.current = obtenerAccessToken;
  const obtenerToken = useCallback(() => tokenRef.current(), []);

  // Tick de 1 s solo mientras hay fila.
  const hayFila = fila !== null;
  useEffect(() => {
    if (!hayFila) return;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [hayFila]);

  // Un error de una acción deja de valer cuando cambia el estado de la fila.
  useEffect(() => {
    setError(null);
  }, [hayFila]);

  const calculo = useMemo(() => {
    if (!fila) return null;
    const desfase = desfaseReloj(fila, recibidoEn ?? ahora);
    const ahoraC = ahoraCorregido(ahora, desfase);
    return { ahoraC, restante: restanteMs(fila, ahoraC), habilitado: habilitadoLocal(fila, ahoraC) };
  }, [fila, recibidoEn, ahora]);

  // Aviso T-1 en primer plano (la notificación programada cubre la pantalla apagada).
  useEffect(() => {
    if (!fila || !calculo || !debeAvisar(fila, calculo.ahoraC, etaAvisado)) return;
    etaAvisado = fila.etaTs;
    void anunciarAvisoEnCanal({
      identifier: idAvisoFila(fila.etaTs),
      titulo: TITULO_AVISO_FILA,
      cuerpo: TEXTO_AVISO_FILA,
      voz: TEXTO_AVISO_FILA,
    });
  }, [fila, calculo]);

  const vista = useMemo<VistaFilaSalida | null>(() => {
    if (!fila || !calculo) return null;
    return {
      posicionTexto: textoPosicion(fila),
      horaSalidaTexto: textoHoraSalida(fila),
      turnoTexto: textoTurno(calculo.habilitado, calculo.restante),
      botonTexto: textoBoton(calculo.habilitado, calculo.restante),
      anuncioAccesible: textoAccesible(calculo.habilitado, calculo.restante),
      habilitado: calculo.habilitado,
      demorado: estaDemorado(fila, calculo.ahoraC),
    };
  }, [fila, calculo]);

  const ejecutar = useCallback(async (accion: () => Promise<{ ok: true } | { ok: false; mensaje: string }>) => {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOcupado(true);
    setError(null);
    try {
      const r = await accion();
      if (!r.ok) setError(r.mensaje);
    } finally {
      ocupadoRef.current = false;
      setOcupado(false);
    }
  }, []);

  const salir = useCallback(() => {
    void ejecutar(() => registrarSalida(obtenerToken, 'boton'));
  }, [ejecutar, obtenerToken]);

  const estoyEnLaFila = useCallback(() => {
    void ejecutar(async () => {
      const fix = ultimoFixFila();
      if (!fix) return { ok: false, mensaje: 'Todavía no tengo tu ubicación. Esperá unos segundos.' };
      return registrarLlegada(obtenerToken, fix);
    });
  }, [ejecutar, obtenerToken]);

  const puedeEstoyEnLaFila =
    tracking && !fila && terminal !== null && posicion !== null && estaCercaDeTerminal(posicion, terminal);

  return { vista, ocupado, error, puedeEstoyEnLaFila, salir, estoyEnLaFila };
}
