'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Clock, Hourglass } from 'lucide-react';
import type { MolinosLinea, PosicionEnVivo, PuntoControl, Variante } from '@quivo/shared';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import {
  OPCION_DIRECTO,
  ahoraServidor,
  esSugerido,
  esperaMinDeVariante,
  esperaMolinos,
  estadoAcuse,
  motivoBloqueo,
  opcionSeleccionada,
  variantesDeEspera,
} from '../../../src/lib/en-vivo/vuelta';
import { mensajeError } from './map-builders';

interface SeccionVueltaProps {
  posicion: PosicionEnVivo | undefined;
  /** Variantes de la ruta (`undefined` = cargando). */
  variantes: Variante[] | undefined;
  variantesError: boolean;
  puntos: PuntoControl[] | undefined;
  /** HUD de la línea del vehículo (para el chip "Sugerido"). */
  linea: MolinosLinea | undefined;
  molinosServidorTs: string | undefined;
  molinosRecibidoEn: number;
  posicionesServidorTs: string | undefined;
  posicionesRecibidoEn: number;
  /** Designa (`varianteId`) o cancela (`null`). Rechaza con el error de la API (409 = motivo). */
  onDesignar: (varianteId: string | null, nombre: string | null) => Promise<void>;
}

/** Sección "Vuelta N de hoy" del panel del vehículo: designación a Molinos, acuse y espera. */
export function SeccionVuelta(props: SeccionVueltaProps) {
  const { posicion, variantes, variantesError, puntos, linea, onDesignar } = props;
  const ahora = useReloj(10_000);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idTitulo = useId();
  const idError = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // Roving tabindex: índice con el foco dentro del grupo (`null` = el grupo no tiene foco).
  const [foco, setFoco] = useState<number | null>(null);

  const vuelta = posicion?.vuelta ?? null;
  const opciones = variantesDeEspera(variantes);
  const bloqueo = motivoBloqueo(vuelta);
  const reloj = ahoraServidor(props.posicionesServidorTs, props.posicionesRecibidoEn, ahora);
  const relojHud = ahoraServidor(props.molinosServidorTs, props.molinosRecibidoEn, ahora);
  const sugerido = posicion ? esSugerido(posicion, linea, relojHud) : false;
  const acuse = estadoAcuse(vuelta);
  const seleccion = opcionSeleccionada(vuelta);
  const bloqueado = bloqueo !== null || pendiente !== null;

  // El error de un intento anterior no sobrevive a un cambio de vuelta.
  const numeroVuelta = vuelta?.numero ?? null;
  useEffect(() => setError(null), [numeroVuelta]);

  // Una designación activa a una variante que ya no se ofrece (desactivada o sin punto de espera)
  // se sigue mostrando —marcada— para poder verla y volver a "Directo".
  const designadaNoListada = Boolean(
    vuelta?.varianteId && !opciones.some((v) => v.id === vuelta.varianteId),
  );

  // Sin variantes designables (la ruta no tiene Molinos) la sección no aporta: no se muestra,
  // salvo que haya una designación activa que no se puede esconder.
  if (variantes && opciones.length === 0 && !variantesError && !designadaNoListada) return null;

  const esperaMin = esperaMinDeVariante(vuelta?.varianteId, variantes, puntos);
  const espera = vuelta?.enEspera ? esperaMolinos(vuelta.esperaDesdeTs, esperaMin, reloj) : null;

  const items = [
    { id: OPCION_DIRECTO, etiqueta: 'Directo', varianteId: null as string | null },
    ...opciones.map((v) => ({ id: v.id, etiqueta: v.nombre, varianteId: v.id as string | null })),
    ...(designadaNoListada && vuelta?.varianteId
      ? [{ id: vuelta.varianteId, etiqueta: `${vuelta.varianteNombre ?? 'Molinos'} (inactiva)`, varianteId: vuelta.varianteId as string | null }]
      : []),
  ];
  // Un único tabstop: el que tiene el foco o, si no, el marcado (o el primero si ninguno coincide).
  const indiceActivo = items.findIndex((item) => item.id === seleccion);
  const indiceTab = foco !== null && foco < items.length ? foco : Math.max(0, indiceActivo);

  async function elegir(item: (typeof items)[number]) {
    if (bloqueado || item.id === seleccion) return;
    setError(null);
    setPendiente(item.id);
    try {
      await onDesignar(item.varianteId, item.varianteId ? item.etiqueta : null);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setError(status === 409 ? mensajeError(err) : `No se pudo guardar la designación. ${mensajeError(err)}`);
    } finally {
      setPendiente(null);
    }
  }

  // Radiogroup: flechas/Home/End SOLO mueven el foco (elegir designa de verdad al chofer y no debe
  // dispararse al pasar por una opción); Enter y Espacio activan el botón nativo (`onClick`).
  function onKeyDown(e: React.KeyboardEvent, indice: number) {
    const salto =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const destino = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : salto ? (indice + salto + items.length) % items.length : -1;
    if (destino < 0) return;
    e.preventDefault();
    setFoco(destino);
    refs.current.get(items[destino]!.id)?.focus();
  }

  return (
    <div className="qv-live-panel__seccion qv-vuelta" role="group" aria-labelledby={idTitulo}>
      <h3 className="qv-live-panel__h">
        <span id={idTitulo}>{vuelta ? `Vuelta ${vuelta.numero} de hoy` : 'Vuelta de hoy'}</span>
        {sugerido && !bloqueado && <span className="qv-vuelta__chip">Sugerido</span>}
      </h3>

      {!vuelta ? (
        <p className="qv-live-panel__vacio">Todavía no pasó por la terminal.</p>
      ) : variantes === undefined && !variantesError ? (
        <p className="qv-live-panel__vacio" role="status">
          Cargando opciones…
        </p>
      ) : variantesError ? (
        <p className="qv-live-panel__error" role="alert">
          No se pudieron cargar las opciones de la vuelta.
        </p>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-labelledby={idTitulo}
            aria-describedby={error ? idError : undefined}
            aria-disabled={bloqueado || undefined}
            aria-busy={pendiente !== null || undefined}
            className="qv-vuelta__segmentos"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setFoco(null);
            }}
          >
            {items.map((item, i) => {
              const activo = item.id === seleccion;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    if (el) refs.current.set(item.id, el);
                    else refs.current.delete(item.id);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  tabIndex={i === indiceTab ? 0 : -1}
                  disabled={bloqueado && !activo}
                  className="qv-vuelta__segmento"
                  data-pendiente={pendiente === item.id || undefined}
                  onClick={() => void elegir(item)}
                  onFocus={() => setFoco(i)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                >
                  {item.etiqueta}
                </button>
              );
            })}
          </div>

          {pendiente !== null && <p className="qv-vuelta__nota">Guardando…</p>}
          {bloqueo && (
            <p className="qv-vuelta__nota">
              <Clock size={12} aria-hidden="true" /> {bloqueo}
            </p>
          )}
          {!bloqueo && posicion?.molinosHoy && vuelta.varianteId === null && (
            <p className="qv-vuelta__nota">Ya fue a Molinos hoy; igual podés enviarlo de nuevo.</p>
          )}
          {error && (
            <p id={idError} className="qv-live-panel__error" role="alert">
              {error}
            </p>
          )}
          {acuse.tipo !== 'sin_designacion' && (
            <p className="qv-vuelta__acuse" data-visto={acuse.tipo === 'visto' || undefined} role="status">
              {acuse.tipo === 'visto' ? <Check size={13} aria-hidden="true" /> : <Hourglass size={13} aria-hidden="true" />}
              <span>{acuse.texto}</span>
            </p>
          )}
          {espera && (
            <p className="qv-vuelta__espera" data-cumplida={espera.cumplida || undefined}>
              <Hourglass size={13} aria-hidden="true" /> <span>{espera.texto}</span>
            </p>
          )}
          {/* El contador cambia cada 10 s y no se anuncia: solo se avisa cuando la espera se cumple. */}
          <span className="qv-visually-hidden" aria-live="polite">
            {espera?.cumplida ? espera.texto : ''}
          </span>
        </>
      )}
    </div>
  );
}
