'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Alert, Button, Loader, PlateBadge, Tag } from '@quivo/design-system';
import type { FilaSalidaPanelItem, SalidaRecientePanel } from '@quivo/shared';
import { ArrowDown, Bus, ChevronDown, EllipsisVertical, X } from 'lucide-react';
import { formatearHoraBolivia } from '../../../src/lib/en-vivo/jornadas';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import { ETIQUETA_ORIGEN, formatearCuenta, restanteMs } from '../../../src/lib/salidas/salidas.logic';

export type TipoAccion = 'despachar' | 'moverAlFinal' | 'retirar';

const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * Cuenta hasta la salida. El tick de 1 Hz vive en esta hoja (como `SaludRefrescoVista`): repinta
 * solo el texto, no la lista. La hora de referencia es la del servidor (`offsetMs`). `plano`: sin
 * peso propio (lo da el contenedor); pasada su hora sigue en color de aviso.
 */
export function CuentaFila({ etaTs, offsetMs, plano = false }: { etaTs: string; offsetMs: number; plano?: boolean }) {
  const ahora = useReloj(1_000);
  const restante = restanteMs(etaTs, offsetMs, ahora);
  return (
    <span style={{ ...NUM, fontWeight: plano ? undefined : 700, color: restante < 0 ? 'var(--qv-color-warning)' : undefined }}>
      {formatearCuenta(restante)}
    </span>
  );
}

interface FilaMovilProps {
  items: FilaSalidaPanelItem[];
  cargando: boolean;
  error?: string;
  offsetMs: number;
  conductores: Record<string, string>;
  internos: Record<string, string>;
  ocupado: boolean;
  progreso: (tipo: TipoAccion, id: string) => boolean;
  /** Item con el diálogo de confirmación abierto: al cerrarse sin acción, el foco vuelve a su ⋮. */
  pendienteId: string | null;
  onPedir: (tipo: TipoAccion, item: FilaSalidaPanelItem) => void;
  recientes: SalidaRecientePanel[];
  /** `null` = la terminal no tiene base (la tarjeta de base muestra "—"): el aviso sí se conserva. */
  baseMin: number | null | undefined;
}

/** Fila de salida del celular (comp B): lista propia en vez de la tabla apilada; escritorio sigue con `DataTable`. */
export function FilaMovil({ items, cargando, error, offsetMs, conductores, internos, ocupado, progreso, pendienteId, onPedir, recientes, baseMin }: FilaMovilProps) {
  const disparadores = useRef(new Map<string, HTMLButtonElement>());
  const ultimoPendiente = useRef<string | null>(null);
  useEffect(() => {
    if (pendienteId !== null) {
      ultimoPendiente.current = pendienteId;
      return;
    }
    const id = ultimoPendiente.current;
    ultimoPendiente.current = null;
    const boton = id ? disparadores.current.get(id) : undefined;
    // Si el diálogo se confirmó y la fila ya no existe, el botón está desmontado: no hay a dónde volver.
    if (boton?.isConnected && document.activeElement === document.body) boton.focus();
  }, [pendienteId]);

  const primero = items[0];
  return (
    <div className="qv-fila-m">
      <div className="qv-fila-m__lbl">
        <h2 className="qv-fila-m__lbl-titulo">La fila</h2>
        {primero && (
          <span>
            Sigue <CuentaFila etaTs={primero.etaTs} offsetMs={offsetMs} plano />
          </span>
        )}
      </div>
      {cargando && <Loader label="Cargando fila…" />}
      {error && <Alert variant="danger" title="No se pudo cargar la fila">{error}</Alert>}
      {!cargando && !error && items.length === 0 && (
        <p className="qv-fila-m__vacio">No hay trufis en la fila. Aparecen apenas llegan a la terminal.</p>
      )}
      {items.length > 0 && (
        <ul className="qv-fila-m__lista">
          {items.map((r, i) => {
            const primera = i === 0;
            const detalle = [internos[r.vehiculoId] && `Int. ${internos[r.vehiculoId]}`, conductores[r.vehiculoId]].filter(Boolean).join(' · ');
            return (
              <li key={r.id} className={`qv-fila-m__item${primera ? ' qv-fila-m__item--primera' : ''}`}>
                <div className="qv-fila-m__fila">
                  <span className="qv-fila-m__pos" aria-label={`Posición ${r.posicion}`}>{r.posicion}</span>
                  <div className="qv-fila-m__quien">
                    <span className="qv-fila-m__placa">
                      <PlateBadge plate={r.placa} />
                      {r.anticipada && <Tag variant="accent">Anticipada</Tag>}
                    </span>
                    {detalle && <span className="qv-fila-m__conductor">{detalle}</span>}
                  </div>
                  {!primera && (
                    <div className="qv-fila-m__cuenta">
                      <small>sale en</small>
                      <CuentaFila etaTs={r.etaTs} offsetMs={offsetMs} plano />
                    </div>
                  )}
                  <MenuFila
                    item={r}
                    puedeDespachar={!primera}
                    ocupado={ocupado}
                    unico={items.length < 2}
                    progreso={progreso}
                    onPedir={onPedir}
                    registrar={(el) => {
                      if (el) disparadores.current.set(r.id, el);
                      else disparadores.current.delete(r.id);
                    }}
                  />
                </div>
                {primera && (
                  <>
                    <div className="qv-fila-m__cuenta qv-fila-m__cuenta--grande">
                      <small>Sale en</small>
                      <CuentaFila etaTs={r.etaTs} offsetMs={offsetMs} plano />
                    </div>
                    <Button
                      variant="primary"
                      className="qv-fila-m__despachar"
                      disabled={ocupado}
                      aria-busy={progreso('despachar', r.id)}
                      aria-label={`Despachar ${r.placa}`}
                      onClick={() => onPedir('despachar', r)}
                    >
                      <Bus size={24} aria-hidden />
                      {progreso('despachar', r.id) ? 'Despachando…' : 'Despachar'}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {baseMin === null && (
        <p className="qv-fila-m__nota">La parada no tiene frecuencia base: configurala arriba para calcular las horas de salida.</p>
      )}
      <RecientesMovil salidas={recientes} />
    </div>
  );
}

/** Menú ⋮ de cada fila: botón con `aria-haspopup`, foco al primer ítem, flechas, Escape/Tab/clic afuera cierran. */
function MenuFila({
  item,
  puedeDespachar,
  ocupado,
  unico,
  progreso,
  onPedir,
  registrar,
}: {
  item: FilaSalidaPanelItem;
  puedeDespachar: boolean;
  ocupado: boolean;
  unico: boolean;
  progreso: (tipo: TipoAccion, id: string) => boolean;
  onPedir: (tipo: TipoAccion, item: FilaSalidaPanelItem) => void;
  registrar: (el: HTMLButtonElement | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const itemsHabilitados = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  // Al abrir, el foco va al primer ítem habilitado.
  useEffect(() => {
    if (abierto) itemsHabilitados()[0]?.focus();
  }, [abierto]);

  // Clic/toque fuera cierra (sin robar el foco a lo que se tocó).
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  const teclasMenu = (e: KeyboardEvent<HTMLDivElement>) => {
    const lista = itemsHabilitados();
    const actual = lista.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      lista[(actual + paso + lista.length) % lista.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      lista[e.key === 'Home' ? 0 : lista.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    } else if (e.key === 'Tab') {
      // El foco pasa al ⋮ y el Tab del navegador sigue desde ahí; el menú no queda abierto ni huérfano.
      setAbierto(false);
      boton.current?.focus();
    }
  };

  const elegir = (tipo: TipoAccion) => {
    setAbierto(false);
    onPedir(tipo, item);
  };

  return (
    <div className="qv-fila-m__menu-raiz" ref={raiz}>
      <button
        ref={(el) => {
          boton.current = el;
          registrar(el);
        }}
        type="button"
        className="qv-fila-m__kb"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? menuId : undefined}
        aria-label={`Más acciones de ${item.placa}`}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !abierto) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        <EllipsisVertical size={24} aria-hidden />
      </button>
      {abierto && (
        <div ref={menu} id={menuId} role="menu" aria-label={`Acciones de ${item.placa}`} className="qv-fila-m__menu" onKeyDown={teclasMenu}>
          {puedeDespachar && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="qv-fila-m__menu-item"
              disabled={ocupado}
              aria-busy={progreso('despachar', item.id)}
              onClick={() => elegir('despachar')}
            >
              <Bus size={20} aria-hidden />
              Despachar
            </button>
          )}
          <button type="button" role="menuitem" tabIndex={-1} className="qv-fila-m__menu-item" disabled={ocupado || unico} onClick={() => elegir('moverAlFinal')}>
            <ArrowDown size={20} aria-hidden />
            Al final
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="qv-fila-m__menu-item qv-fila-m__menu-item--peligro" disabled={ocupado} onClick={() => elegir('retirar')}>
            <X size={20} aria-hidden />
            Retirar
          </button>
        </div>
      )}
    </div>
  );
}

/** "Salidas recientes" plegado de entrada (comp .coll): el conteo queda a la vista sin ocupar la pantalla. */
function RecientesMovil({ salidas }: { salidas: SalidaRecientePanel[] }) {
  const [abierto, setAbierto] = useState(false);
  const regionId = useId();
  return (
    <section aria-label="Salidas recientes" className="qv-fila-m__recientes">
      <button type="button" className="qv-fila-m__coll" aria-expanded={abierto} aria-controls={regionId} onClick={() => setAbierto((a) => !a)}>
        <span>Salidas recientes</span>
        <span className="qv-fila-m__coll-der">
          <span className="qv-fila-m__coll-n">{salidas.length}</span>
          <ChevronDown size={24} aria-hidden className="qv-fila-m__coll-chevron" />
        </span>
      </button>
      <div id={regionId} hidden={!abierto}>
        {salidas.length === 0 ? (
          <p className="qv-fila-m__vacio">Todavía no salió ningún trufi hoy.</p>
        ) : (
          <ul className="qv-fila-m__rec-lista">
            {salidas.map((r) => (
              <li key={r.id} className="qv-fila-m__rec">
                <span className="qv-fila-m__rec-hora">{formatearHoraBolivia(r.salidaTs)}</span>
                <PlateBadge plate={r.placa} />
                <span className="qv-fila-m__rec-origen">{ETIQUETA_ORIGEN[r.salidaOrigen] ?? r.salidaOrigen}</span>
                {r.anticipada && <Tag variant="accent">Anticipada</Tag>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
