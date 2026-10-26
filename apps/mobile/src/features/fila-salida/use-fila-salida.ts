import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoFilaSalida } from '@quivo/shared';
import { anunciarAvisoEnCanal, cancelarProgramada } from '../operacion/anuncio-punto-control';
import { registrarLlegada, registrarSalida } from './fila-salida-acciones';
import { leerPausa } from '../operacion/pausa-recorrido';
import { ultimoFixFila } from './fila-salida-deteccion';
import {
  TEXTO_AVISO_FILA,
  TITULO_AVISO_FILA,
  debeAvisar,
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
  sesionId: string;
  /** Del cache de vuelta-actual (`useVueltaActual`): este hook no consulta la red por su cuenta. */
  fila: EstadoFilaSalida | null;
  /** Cache de más de 15 min: se muestra la fila pero marcada y sin aviso de foreground. */
  sinActualizar: boolean;
  /** `servidorTs - recepción local` (ms) de `fila`; `null` = desconocido (se asume 0). */
  desfaseMs: number | null;
  /** Salió de la fila y todavía no se alejó de la terminal. */
  desarmada: boolean;
  tracking: boolean;
  terminal: TerminalZona | null;
  posicion: { lat: number; lng: number } | null;
  obtenerAccessToken: () => Promise<string | null>;
  /** Cierra la vuelta al llegar a la terminal (misma confirmación que la detección automática). */
  confirmarLlegadaTerminal: () => Promise<void>;
}

export interface VistaFilaSalida {
  posicionTexto: string;
  /** 1 = el próximo en salir. */
  posicion: number;
  total: number;
  /** Placa del trufi de adelante; `null` si es el primero. */
  delantePlaca: string | null;
  horaSalidaTexto: string | null;
  turnoTexto: string;
  botonTexto: string;
  /** Cambia solo por minuto o al habilitarse: para la región viva del lector de pantalla. */
  anuncioAccesible: string;
  habilitado: boolean;
  demorado: boolean;
  sinActualizar: boolean;
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
  sesionId,
  fila,
  sinActualizar,
  desfaseMs,
  desarmada,
  tracking,
  terminal,
  posicion,
  obtenerAccessToken,
  confirmarLlegadaTerminal,
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

  const puedeEstoyEnLaFila =
    tracking &&
    !fila &&
    !desarmada &&
    terminal !== null &&
    posicion !== null &&
    estaCercaDeTerminal(posicion, terminal);

  // Un error de una acción deja de valer cuando cambia la fila o desaparece el botón que lo originó.
  useEffect(() => {
    setError(null);
  }, [hayFila, puedeEstoyEnLaFila]);

  const calculo = useMemo(() => {
    if (!fila) return null;
    const ahoraC = ahora + (desfaseMs ?? 0);
    return {
      ahoraC,
      restante: restanteMs(fila, ahoraC),
      habilitado: habilitadoLocal(fila, ahoraC),
    };
  }, [fila, desfaseMs, ahora]);

  // Aviso T-1 en primer plano (la notificación programada cubre la pantalla apagada).
  useEffect(() => {
    if (!fila || !calculo || sinActualizar || !debeAvisar(fila, calculo.ahoraC, etaAvisado)) return;
    etaAvisado = fila.etaTs;
    const identifier = idAvisoFila(fila.etaTs);
    // Se cancela la programada (sin tocar lo presentado) para que no suene dos veces.
    void cancelarProgramada(identifier).then(() =>
      anunciarAvisoEnCanal({
        identifier,
        titulo: TITULO_AVISO_FILA,
        cuerpo: TEXTO_AVISO_FILA,
        voz: TEXTO_AVISO_FILA,
      }),
    );
  }, [fila, calculo, sinActualizar]);

  const vista = useMemo<VistaFilaSalida | null>(() => {
    if (!fila || !calculo) return null;
    return {
      posicionTexto: textoPosicion(fila),
      posicion: fila.posicion,
      total: fila.total,
      delantePlaca: fila.delantePlaca,
      horaSalidaTexto: textoHoraSalida(fila),
      turnoTexto: textoTurno(calculo.habilitado),
      botonTexto: textoBoton(calculo.habilitado, calculo.restante),
      anuncioAccesible: textoAccesible(calculo.habilitado, calculo.restante),
      habilitado: calculo.habilitado,
      demorado: estaDemorado(fila, calculo.ahoraC),
      sinActualizar,
    };
  }, [fila, calculo, sinActualizar]);

  const ejecutar = useCallback(
    async (accion: () => Promise<{ ok: true } | { ok: false; mensaje: string }>) => {
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
    },
    [],
  );

  const salir = useCallback(() => {
    void ejecutar(() => registrarSalida(obtenerToken, 'boton'));
  }, [ejecutar, obtenerToken]);

  const estoyEnLaFila = useCallback(() => {
    void ejecutar(async () => {
      if (await leerPausa(sesionId))
        return {
          ok: false,
          mensaje: 'Estás en pausa: reanudá el recorrido para entrar a la fila.',
        };
      const fix = ultimoFixFila();
      if (!fix)
        return { ok: false, mensaje: 'Todavía no tengo tu ubicación. Esperá unos segundos.' };
      return registrarLlegada(obtenerToken, fix, confirmarLlegadaTerminal);
    });
  }, [ejecutar, obtenerToken, sesionId, confirmarLlegadaTerminal]);

  return { vista, ocupado, error, puedeEstoyEnLaFila, salir, estoyEnLaFila };
}
