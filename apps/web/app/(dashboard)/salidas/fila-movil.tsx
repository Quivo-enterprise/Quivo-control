'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Alert, Button, Loader, PlateBadge, StatusBadge, Tag } from '@quivo/design-system';
import type { FilaSalidaPanelItem, SalidaRecientePanel } from '@quivo/shared';
import { ArrowDown, Bus, ChevronDown, Ellipsis, X } from 'lucide-react';
import { formatearHoraBolivia } from '../../../src/lib/en-vivo/jornadas';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import {
  ESTADO_BADGE,
  ETIQUETA_ESTADO_FILA,
  ETIQUETA_ORIGEN,
  TEXTO_PROGRESO,
  conductorDeFila,
  estadoVisualFila,
  formatearCuenta,
  restanteMs,
  type TipoAccion,
} from '../../../src/lib/salidas/salidas.logic';

const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * Cuenta hasta la salida. El tick de 1 Hz vive en esta hoja (como `SaludRefrescoVista`): repinta
 * solo el texto, no la lista; por eso se monta una por celda. La hora de referencia es la del servidor
 * (`offsetMs`). `plano` (celular): sin peso propio (lo da el contenedor) y, pasada su hora, en el color
 * de aviso legible sobre la tarjeta (`--qv-color-warning` no llega a 4.5:1).
 */
export function CuentaFila({ etaTs, offsetMs, plano = false }: { etaTs: string; offsetMs: number; plano?: boolean }) {
  const restante = restanteMs(etaTs, offsetMs, useReloj(1_000));
  const aviso = plano ? 'var(--qv-color-warning-texto)' : 'var(--qv-color-warning)';
  return (
    <span style={{ ...NUM, fontWeight: plano ? undefined : 700, color: restante < 0 ? aviso : undefined }}>
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
  /** Item con el diálogo de confirmación abierto: al cerrarse sin acción, el foco vuelve a su ⋯. */
  pendienteId: string | null;
  onPedir: (tipo: TipoAccion, item: FilaSalidaPanelItem) => void;
  recientes: SalidaRecientePanel[];
  /** `null` = la terminal no tiene base (la tarjeta de base muestra "—"): el aviso sí se conserva. */
  baseMin: number | null | undefined;
}

/** Fila de salida del celular (comp B): lista propia en vez de la tabla apilada; escritorio sigue con `DataTable`. */
export function FilaMovil({ items, cargando, error, offsetMs, conductores, internos, ocupado, progreso, pendienteId, onPedir: pedir, recientes, baseMin }: FilaMovilProps) {
  const disparadores = useRef(new Map<string, HTMLButtonElement>());
  const titulo = useRef<HTMLHeadingElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const accionada = useRef<{ id: string; idx: number; origen: HTMLElement | null } | null>(null);
  const onPedir = (tipo: TipoAccion, item: FilaSalidaPanelItem) => {
    // Desde dónde se pidió (el ⋯ por el menú, el botón Despachar directo): ahí vuelve el foco si el diálogo se cancela.
    const origen = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    accionada.current = { id: item.id, idx: itemsRef.current.findIndex((x) => x.id === item.id), origen };
    pedir(tipo, item);
  };
  // Al terminar la acción o cancelar el diálogo el foco no se queda en <body>: vuelve a donde se pidió; si eso ya no
  // está, al ⋯ de la fila o, si salió, al de la que ocupa su lugar (la siguiente), la anterior o el título de la lista.
  useEffect(() => {
    const a = accionada.current;
    if (ocupado || !a || pendienteId !== null) return;
    accionada.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (a.origen?.isConnected && !(a.origen as HTMLButtonElement).disabled) {
      a.origen.focus({ preventScroll: true });
      return;
    }
    const lista = itemsRef.current;
    const propio = disparadores.current.get(a.id);
    const destino = propio?.isConnected ? propio : [lista[a.idx], lista[a.idx - 1]].map((x) => x && disparadores.current.get(x.id)).find(Boolean) ?? titulo.current;
    destino?.focus({ preventScroll: true });
  }, [ocupado, pendienteId]);

  const primero = items[0];
  return (
    <div className="qv-fila-m">
      <div className="qv-fila-m__lbl">
        <h2 className="qv-fila-m__lbl-titulo" ref={titulo} tabIndex={-1}>La fila</h2>
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
            const haciendo = (Object.keys(TEXTO_PROGRESO) as TipoAccion[]).find((t) => progreso(t, r.id));
            const detalle = [internos[r.vehiculoId] && `Int. ${internos[r.vehiculoId]}`, conductorDeFila(r, conductores)].filter(Boolean).join(' · ');
            return (
              <li key={r.id} className={`qv-fila-m__item${primera ? ' qv-fila-m__item--primera' : ''}`}>
                <div className="qv-fila-m__fila">
                  <span className="qv-fila-m__pos">
                    <span className="qv-visually-hidden">Posición </span>
                    {r.posicion}
                  </span>
                  <div className="qv-fila-m__quien">
                    <span className="qv-fila-m__placa">
                      <PlateBadge plate={r.placa} />
                      {r.anticipada && <Tag variant="accent">Anticipada</Tag>}
                    </span>
                    {detalle && <span className="qv-fila-m__conductor">{detalle}</span>}
                    {/* Región viva siempre montada (si no, el lector no anuncia el texto al aparecer); el menú ya se cerró. */}
                    {/* Fila 1 al despachar: el botón ya dice "Despachando…"; el texto queda solo para el lector y la línea de estado no se mueve. */}
                    <span role="status" className={`qv-fila-m__progreso${primera && haciendo === 'despachar' ? ' qv-visually-hidden' : ''}`}>{haciendo && TEXTO_PROGRESO[haciendo]}</span>
                    {(!haciendo || (primera && haciendo === 'despachar')) && (
                      <span className="qv-fila-m__estado">
                        <StatusBadge status={ESTADO_BADGE[estadoVisualFila(r)]} label={ETIQUETA_ESTADO_FILA[estadoVisualFila(r)]} />
                        <span className="qv-fila-m__hora">Sale {formatearHoraBolivia(r.etaTs)}</span>
                      </span>
                    )}
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
                      {progreso('despachar', r.id) ? TEXTO_PROGRESO.despachar : 'Despachar'}
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

/** Menú ⋯ de cada fila: botón con `aria-haspopup`, foco al primer ítem, flechas, Escape/Tab/clic afuera cierran. */
function MenuFila({
  item,
  puedeDespachar,
  ocupado,
  unico,
  onPedir,
  registrar,
}: {
  item: FilaSalidaPanelItem;
  puedeDespachar: boolean;
  ocupado: boolean;
  unico: boolean;
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
    if (!abierto) return;
    itemsHabilitados()[0]?.focus();
    // La última fila abre el menú sobre el borde de la pantalla: que quede entero a la vista (respeta el scroll-padding de la tabbar).
    menu.current?.scrollIntoView({ block: 'nearest' });
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
      // El foco pasa al ⋯ y el Tab del navegador sigue desde ahí; el menú no queda abierto ni huérfano.
      setAbierto(false);
      boton.current?.focus();
    }
  };

  // Con el menú abierto, otra acción en curso o un cambio de la fila (la 2 pasa a ser la 1: ya no hay "Despachar") lo cierra:
  // los ítems se desmontan y el foco se perdería con ellos.
  // `unico` igual: "Al final" pasa a deshabilitado y el foco se perdería.
  const antes = useRef({ puedeDespachar, unico });
  useEffect(() => {
    const cambio = antes.current.puedeDespachar !== puedeDespachar || antes.current.unico !== unico;
    antes.current = { puedeDespachar, unico };
    if (!abierto || !(ocupado || cambio)) return;
    const foco = document.activeElement;
    if (foco === document.body || menu.current?.contains(foco)) boton.current?.focus();
    setAbierto(false);
  }, [ocupado, puedeDespachar, unico, abierto]);

  const elegir = (tipo: TipoAccion) => {
    setAbierto(false);
    // El ítem se desmonta: el foco vuelve al ⋯ antes de la acción (si abre un diálogo, éste lo toma y lo devuelve al cerrar).
    boton.current?.focus();
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
        // aria-disabled y no `disabled`: éste soltaría el foco del ⋯ mientras corre la acción.
        aria-disabled={ocupado || undefined}
        onClick={() => !ocupado && setAbierto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !abierto && !ocupado) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        <Ellipsis size={24} aria-hidden />
      </button>
      {abierto && (
        <div ref={menu} id={menuId} role="menu" aria-label={`Acciones de ${item.placa}`} className="qv-fila-m__menu" onKeyDown={teclasMenu}>
          {puedeDespachar && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="qv-fila-m__menu-item"
              onClick={() => elegir('despachar')}
            >
              <Bus size={20} aria-hidden />
              Despachar
            </button>
          )}
          <button type="button" role="menuitem" tabIndex={-1} className="qv-fila-m__menu-item" disabled={unico} onClick={() => elegir('moverAlFinal')}>
            <ArrowDown size={20} aria-hidden />
            Al final
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="qv-fila-m__menu-item qv-fila-m__menu-item--peligro" onClick={() => elegir('retirar')}>
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
    <section aria-label="Salidas recientes">
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
