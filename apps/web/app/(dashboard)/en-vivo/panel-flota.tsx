'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { EstadoFrescura, PosicionEnVivo } from '@quivo/shared';
import { CircleCheck } from 'lucide-react';
import {
  ORDEN_ESTADOS_FRESCURA,
  conteoPorEstado,
  estadoDe,
  listaAtencion,
  listaFlota,
  resumenFlota,
} from '../../../src/lib/en-vivo/atencion';
import { presentacionFrescura } from '../../../src/lib/en-vivo/traza';
import { GlifoEstado } from './glifo-estado';

const etiquetaEstado = (e: EstadoFrescura) => presentacionFrescura(e).etiqueta;

type Pestana = 'atencion' | 'flota';
const PESTANAS: readonly Pestana[] = ['atencion', 'flota'];

interface PanelFlotaProps {
  /** Flota de la línea elegida: base de los conteos (el filtro de estado no los vacía). */
  posicionesLinea: readonly PosicionEnVivo[];
  /** Lo que queda tras el filtro de nivel y de estado: lo mismo que pinta el mapa. */
  posicionesVisibles: readonly PosicionEnVivo[];
  ordenMolinos: ReadonlyMap<string, number>;
  colorLineaPorId: Readonly<Record<string, string | null | undefined>>;
  estadoFiltro: EstadoFrescura | null;
  onEstado: (estado: EstadoFrescura | null) => void;
  seleccionadoId: string | null;
  onSeleccionar: (id: string) => void;
  /** Módulos compactos de abajo (Molinos, Jornada). */
  children?: ReactNode;
  /** Solo < 1024 px: el panel es una hoja que se abre desde la barra. */
  abierto: boolean;
  /** Escape: cierra la hoja y devuelve el foco al botón Flota. */
  onCerrar: () => void;
}

export function PanelFlota(p: PanelFlotaProps) {
  const [pestana, setPestana] = useState<Pestana>('atencion');
  const conteo = useMemo(() => conteoPorEstado(p.posicionesLinea), [p.posicionesLinea]);
  const { total, enServicio } = resumenFlota(conteo);
  const atencion = useMemo(() => listaAtencion(p.posicionesVisibles, p.ordenMolinos), [p.posicionesVisibles, p.ordenMolinos]);
  const flota = useMemo(
    () => (pestana === 'flota' ? listaFlota(p.posicionesVisibles, p.ordenMolinos) : []),
    [pestana, p.posicionesVisibles, p.ordenMolinos],
  );
  const sinGps = p.posicionesVisibles.filter((v) => v.lat === null || v.lng === null).length;
  const filas = pestana === 'atencion' ? atencion : flota;

  const { abierto, onCerrar } = p;
  const asideRef = useRef<HTMLElement>(null);
  // < 1024 px la hoja se abre desde el botón Flota: el foco entra a la hoja y Escape lo devuelve.
  useEffect(() => {
    if (!abierto) return;
    asideRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      onCerrar();
      document.querySelector<HTMLElement>('.qv-live-barra__flota')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, onCerrar]);

  const teclaPestana = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = PESTANAS.indexOf(pestana);
    const siguiente =
      e.key === 'ArrowRight' ? PESTANAS[(i + 1) % PESTANAS.length]
      : e.key === 'ArrowLeft' ? PESTANAS[(i + PESTANAS.length - 1) % PESTANAS.length]
      : e.key === 'Home' ? PESTANAS[0]
      : e.key === 'End' ? PESTANAS[PESTANAS.length - 1]
      : undefined;
    if (!siguiente) return;
    e.preventDefault();
    setPestana(siguiente);
    document.getElementById(`qv-live-tab-${siguiente}`)?.focus();
  };

  return (
    <aside ref={asideRef} id="qv-live-flota" className={`qv-live-flota${p.abierto ? ' qv-live-flota--abierto' : ''}`} aria-label="Flota">
      <div className="qv-live-flota__cuerpo">
        <div className="qv-live-resumen">
          <span className="qv-live-resumen__grande">{enServicio}</span>
          <span className="qv-live-resumen__de">
            en servicio de <strong>{total}</strong> en flota
          </span>
          {sinGps > 0 && <span className="qv-live-resumen__sin-gps">{sinGps} sin GPS aún</span>}
        </div>

        <div className="qv-live-estados" role="group" aria-label="Filtrar por estado">
          {ORDEN_ESTADOS_FRESCURA.map((e) => {
            const n = conteo[e];
            const activo = p.estadoFiltro === e;
            return (
              <button
                key={e}
                type="button"
                className="qv-live-estado"
                aria-pressed={activo}
                disabled={n === 0 && !activo}
                title={`Mostrar solo ${etiquetaEstado(e).toLowerCase()}`}
                aria-label={`${etiquetaEstado(e)}: ${n}`}
                onClick={() => p.onEstado(activo ? null : e)}
              >
                <GlifoEstado estado={e} />
                <span className="qv-live-estado__texto">{presentacionFrescura(e).corta}</span>
                <span className="qv-live-estado__n">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="qv-live-pestanas" role="tablist" aria-label="Lista de vehículos" onKeyDown={teclaPestana}>
          {PESTANAS.map((t) => (
            <button
              key={t}
              id={`qv-live-tab-${t}`}
              type="button"
              role="tab"
              aria-selected={pestana === t}
              aria-controls="qv-live-lista"
              tabIndex={pestana === t ? 0 : -1}
              className="qv-live-pestana"
              onClick={() => setPestana(t)}
            >
              {t === 'atencion' ? 'Atención' : 'Toda la flota'}
              <span className="qv-live-pestana__n">{t === 'atencion' ? atencion.length : p.posicionesVisibles.length}</span>
            </button>
          ))}
        </div>

        <div id="qv-live-lista" className="qv-live-lista" role="tabpanel" aria-labelledby={`qv-live-tab-${pestana}`}>
          {/* Siempre montada: anuncia cuando la lista de atención se vacía o se llena. */}
          <p className="qv-visually-hidden" role="status">
            {atencion.length === 0 ? 'Sin vehículos que requieran atención' : 'Hay vehículos que requieren atención'}
          </p>
          {filas.length === 0 ? (
            <p className="qv-live-lista__vacio">
              {p.posicionesVisibles.length === 0 ? (
                'Ningún vehículo con estos filtros.'
              ) : (
                <>
                  <CircleCheck size={16} aria-hidden="true" />
                  Sin vehículos que requieran atención
                </>
              )}
            </p>
          ) : (
            <ul>
              {filas.map(({ posicion: v, motivos }) => {
                const estado = estadoDe(v);
                const color = p.colorLineaPorId[v.lineaId];
                const sinUbicacion = v.lat === null || v.lng === null;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      className="qv-live-fila"
                      aria-current={p.seleccionadoId === v.id ? 'true' : undefined}
                      onClick={() => p.onSeleccionar(v.id)}
                    >
                      <GlifoEstado estado={estado} />
                      <span className="qv-live-fila__placa" translate="no">
                        {v.vehiculoPlaca}
                      </span>
                      <span className="qv-live-fila__linea">
                        <i
                          className="qv-live-linea-punto"
                          style={{ '--qv-linea': color || 'var(--qv-color-primary)' } as CSSProperties}
                          aria-hidden="true"
                        />
                        {v.lineaNombre}
                      </span>
                      <span className="qv-live-fila__motivo">
                        <span className={`qv-live-est--${estado}`}>{etiquetaEstado(estado)}</span>
                        {motivos.length > 0 ? ` · ${motivos.join(' · ')}` : ''}
                        {sinUbicacion && estado !== 'sin_datos' ? ' · sin ubicación' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {p.children}
      </div>
    </aside>
  );
}
