'use client';

import { Alert, Button, PlateBadge } from '@quivo/design-system';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ListOrdered, MessageCircle, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  colaDe,
  construirUrlWhatsApp,
  demandaDe,
  distanciaEntreAvancesM,
  horariosCola,
  largoTotalM,
  paradasConAltaDemanda,
  recorridosDelDia,
  salidasDelDia,
  useFlotaMock,
  type AccionResultado,
  type EstadoFlotaMock,
  type FaseTrufi,
  type LineaMock,
  type LineaMockId,
  type ParadaMock,
  type TrufiMock,
} from '../../../../../src/lib/mock-flota';
import { VistaPanel, type VistaProps } from './vista-panel';

/**
 * Vista "Salidas" (E07 04:03/04:49 del guion — `docs/guion-grabacion-mock.md`): cola de
 * despacho por línea, coordinación (despachar/adelantar-atrasar/avisar por WhatsApp), tabla de
 * salidas del día y línea de tiempo de recorridos 00–24 h.
 */

const DURACION_VUELTA_PROMEDIO_MIN = 50;
const FASES_VISIBLES_EN_RUTA = new Set<FaseTrufi>(['en_ruta', 'atascado', 'desviado']);
const TICKS_EJE = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function formatHora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "línea Z12" / "Línea 120" — mismo criterio que `trufi-marcador.tsx#ariaLabel`:
 * `linea.nombre` a veces ya trae el prefijo "Línea " (la 120) y a veces no (Z12). Antepone
 * "línea " solo cuando hace falta, para que el mensaje de WhatsApp no lea "la línea Línea 120". */
function fraseLinea(linea: LineaMock): string {
  return /^línea\s/i.test(linea.nombre) ? linea.nombre : `línea ${linea.nombre}`;
}

function minutosDelDia(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutos estimados hasta que la unidad EN RUTA más cercana llegue a `parada` — fracción de
 * loop recorrida (distancia de arco / largo total) × una duración de vuelta promedio (40-60 min
 * según `recorridos.ts#sembrarHistorial`, 50 min de punto medio). Aproximación informativa para
 * el aviso de alta demanda — no hay velocidad nominal expuesta fuera del reducer. */
function proximaUnidadEnRutaMin(
  estado: EstadoFlotaMock,
  linea: LineaMock,
  parada: ParadaMock,
  trufisLinea: TrufiMock[],
): number | null {
  const largo = largoTotalM(linea.polilinea);
  if (largo === 0) return null;
  let mejor: number | null = null;
  for (const trufi of trufisLinea) {
    const t = estado.trufis[trufi.id];
    if (!t || !FASES_VISIBLES_EN_RUTA.has(t.fase)) continue;
    const distancia = distanciaEntreAvancesM(linea.polilinea, t.avance, parada.avance);
    const minutos = Math.round((distancia / largo) * DURACION_VUELTA_PROMEDIO_MIN);
    if (mejor === null || minutos < mejor) mejor = minutos;
  }
  return mejor;
}

/** Ítem 6 del guion de fixes: `despacharSiguiente` devuelve `AccionResultado` — el banner de
 * confirmación de `ColaLineaBloque` tiene que poder mostrar TANTO el éxito ("Salió...") como el
 * `motivo` de un fallo (cola vacía), con tono de error en el segundo caso. */
type ConfirmacionDespacho = { mensaje: string; ok: boolean };

interface ColaLineaBloqueProps {
  linea: LineaMock;
  estado: EstadoFlotaMock;
  trufis: TrufiMock[];
  ahora: Date;
  confirmacion?: ConfirmacionDespacho;
  onDespachar: () => void;
  onMover: (trufiId: string, delta: 1 | -1) => void;
  onSeleccionarTrufi: (trufiId: string) => void;
}

function ColaLineaBloque({
  linea,
  estado,
  trufis,
  ahora,
  confirmacion,
  onDespachar,
  onMover,
  onSeleccionarTrufi,
}: ColaLineaBloqueProps) {
  const cola = colaDe(estado, linea.id);
  // Ítem 3 del guion de fixes (2026-09-27): `proximaSalidaEstimada` (borrado) calculaba desde la
  // ÚLTIMA `SalidaMock.programada` histórica sin chequear contra `ahora` — si el historial
  // sembrado terminaba temprano, la cola mostraba horas YA PASADAS. `horariosCola` (mismo
  // encadenado que ya usa el reducer para la salida real) nunca da una hora pasada.
  const horarios = useMemo(() => horariosCola(estado, linea.id, ahora), [estado, linea.id, ahora]);
  const trufisLinea = useMemo(() => trufis.filter((t) => t.lineaId === linea.id), [trufis, linea.id]);
  const paradasAlta = paradasConAltaDemanda(estado, ahora, linea.id);
  const primeraAlta = paradasAlta[0];
  const minutosProximaUnidad = primeraAlta
    ? proximaUnidadEnRutaMin(estado, linea, primeraAlta, trufisLinea)
    : null;
  const estiloLinea: CSSProperties & Record<string, string> = { '--qv-linea-color': linea.color };

  return (
    <div className="qv-cola-linea">
      <div className="qv-cola-linea__header">
        <span className="qv-cola-linea__nombre" style={estiloLinea}>
          <span className="qv-cola-linea__dot" aria-hidden="true" />
          {linea.nombre}
        </span>
        <Button size="sm" variant="primary" onClick={onDespachar} disabled={cola.length === 0}>
          <Send size={14} aria-hidden="true" />
          Despachar siguiente
        </Button>
      </div>

      <div aria-live="polite">
        {confirmacion && (
          <span className={`qv-cola-linea__confirmacion ${confirmacion.ok ? '' : 'qv-cola-linea__confirmacion--error'}`}>
            {confirmacion.ok ? <CheckCircle2 size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />}
            {confirmacion.mensaje}
          </span>
        )}
      </div>

      {primeraAlta && (
        <Alert variant="warning" title="Alta demanda" className="qv-cola-linea__aviso">
          Parada {primeraAlta.nombre} con alta demanda (~
          {demandaDe(primeraAlta.id, ahora, estado.horaPico).esperando} esperando)
          {minutosProximaUnidad !== null && ` · próxima unidad en ruta a ${minutosProximaUnidad} min`}
        </Alert>
      )}

      {cola.length === 0 ? (
        <p className="qv-vista-hint">Sin trufis en cola en este momento.</p>
      ) : (
        <ol className="qv-cola-lista">
          {horarios.map(({ trufiId, programada }, idx) => {
            const trufi = trufisLinea.find((t) => t.id === trufiId);
            if (!trufi) return null;
            const mensaje = `Hola ${trufi.conductorNombre}, sos el siguiente en salir en la ${fraseLinea(linea)} a las ${formatHora(programada)}.`;
            return (
              <li key={trufiId} className="qv-cola-item">
                <span className="qv-cola-item__pos" aria-hidden="true">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  className="qv-cola-item__placa"
                  onClick={() => onSeleccionarTrufi(trufiId)}
                >
                  <PlateBadge plate={trufi.placa} />
                </button>
                <span className="qv-cola-item__conductor">{trufi.conductorNombre}</span>
                <span className="qv-cola-item__hora qv-tabular">{formatHora(programada)}</span>
                <div className="qv-cola-item__acciones">
                  <button
                    type="button"
                    className="qv-icon-btn"
                    aria-label={`Adelantar a ${trufi.placa} en la cola`}
                    disabled={idx === 0}
                    onClick={() => onMover(trufiId, -1)}
                  >
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="qv-icon-btn"
                    aria-label={`Atrasar a ${trufi.placa} en la cola`}
                    disabled={idx === cola.length - 1}
                    onClick={() => onMover(trufiId, 1)}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  <a
                    className="qv-icon-btn"
                    href={construirUrlWhatsApp(trufi.whatsapp, mensaje)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Avisar a ${trufi.conductorNombre} por WhatsApp`}
                  >
                    <MessageCircle size={14} aria-hidden="true" />
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

interface TimelineRecorridosProps {
  trufis: TrufiMock[];
  lineas: Record<LineaMockId, LineaMock>;
  estado: EstadoFlotaMock;
  ahora: Date;
  onSeleccionarTrufi: (trufiId: string) => void;
}

function TimelineRecorridos({ trufis, lineas, estado, ahora, onSeleccionarTrufi }: TimelineRecorridosProps) {
  const nowMinutos = ahora.getHours() * 60 + ahora.getMinutes() + ahora.getSeconds() / 60;
  const nowPct = (nowMinutos / 1440) * 100;

  return (
    <div className="qv-timeline">
      <div className="qv-timeline__eje" aria-hidden="true">
        {TICKS_EJE.map((h) => (
          <span key={h} className="qv-timeline__tick" style={{ left: `${(h / 24) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <div className="qv-timeline__filas">
        {trufis.map((trufi) => {
          const linea = lineas[trufi.lineaId];
          const recorridos = recorridosDelDia(estado, { trufiId: trufi.id });
          return (
            <div className="qv-timeline__fila" key={trufi.id}>
              <button
                type="button"
                className="qv-timeline__etiqueta"
                onClick={() => onSeleccionarTrufi(trufi.id)}
              >
                <PlateBadge plate={trufi.placa} />
              </button>
              <div
                className="qv-timeline__pista"
                role="list"
                aria-label={`Recorridos de hoy de ${trufi.placa}`}
              >
                <span className="qv-timeline__ahora" style={{ left: `${nowPct}%` }} aria-hidden="true" />
                {recorridos.map((r) => {
                  const inicioMin = minutosDelDia(r.inicio);
                  const finMin = r.fin ? minutosDelDia(r.fin) : nowMinutos;
                  const left = (inicioMin / 1440) * 100;
                  const width = Math.max(0.35, ((finMin - inicioMin) / 1440) * 100);
                  const titulo = `${formatHora(r.inicio)}–${r.fin ? formatHora(r.fin) : 'ahora'} · ${r.puntosCumplidos}/${r.puntosTotal} puntos de control`;
                  const estiloSegmento: CSSProperties & Record<string, string> = {
                    left: `${left}%`,
                    width: `${width}%`,
                    '--qv-linea-color': linea.color,
                  };
                  return (
                    <span
                      key={r.id}
                      role="listitem"
                      className={`qv-timeline__segmento qv-timeline__segmento--${r.estado}`}
                      style={estiloSegmento}
                      title={titulo}
                      aria-label={titulo}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LIMITE_SALIDAS_TABLA = 12;

export function VistaSalidas({ lineaId, onSeleccionarTrufi, onCerrar }: VistaProps) {
  const { estado, lineas, trufis, despacharSiguiente, moverEnCola } = useFlotaMock();
  const ahora = new Date();
  const filtroLinea = useMemo(() => (lineaId ? { lineaId } : {}), [lineaId]);
  const lineasVisibles = useMemo<LineaMock[]>(
    () => (lineaId ? [lineas[lineaId]] : Object.values(lineas)),
    [lineaId, lineas],
  );
  const trufisVisibles = useMemo(
    () => (lineaId ? trufis.filter((t) => t.lineaId === lineaId) : trufis),
    [trufis, lineaId],
  );

  const [confirmaciones, setConfirmaciones] = useState<Record<string, ConfirmacionDespacho>>({});
  const [verTodasSalidas, setVerTodasSalidas] = useState(false);
  const timeoutsRef = useRef<Partial<Record<LineaMockId, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      Object.values(timeouts).forEach((id) => {
        if (id) clearTimeout(id);
      });
    };
  }, []);

  function handleDespachar(linea: LineaMock) {
    const cabezaId = colaDe(estado, linea.id)[0];
    const trufi = cabezaId ? trufis.find((t) => t.id === cabezaId) : undefined;
    const resultado: AccionResultado = despacharSiguiente(linea.id);
    const previo = timeoutsRef.current[linea.id];
    if (previo) clearTimeout(previo);

    if (!resultado.ok) {
      // Ítem 6: cola vacía (o cualquier otro motivo futuro) — mismo banner `aria-live`, tono de
      // error en vez del check verde.
      setConfirmaciones((prev) => ({ ...prev, [linea.id]: { mensaje: resultado.motivo, ok: false } }));
    } else if (trufi) {
      const hhmm = formatHora(new Date().toISOString());
      setConfirmaciones((prev) => ({ ...prev, [linea.id]: { mensaje: `Salió ${trufi.placa} · ${hhmm}`, ok: true } }));
    }

    timeoutsRef.current[linea.id] = setTimeout(() => {
      setConfirmaciones((prev) => {
        const next = { ...prev };
        delete next[linea.id];
        return next;
      });
    }, 6000);
  }

  const todasLasSalidas = useMemo(
    () =>
      salidasDelDia(estado, filtroLinea)
        .slice()
        .sort((a, b) => Date.parse(b.real ?? b.programada) - Date.parse(a.real ?? a.programada)),
    [estado, filtroLinea],
  );
  const salidasMostradas = verTodasSalidas ? todasLasSalidas : todasLasSalidas.slice(0, LIMITE_SALIDAS_TABLA);

  const recorridosVisibles = recorridosDelDia(estado, filtroLinea);
  const completos = recorridosVisibles.filter((r) => r.estado === 'completo').length;
  const incompletos = recorridosVisibles.filter((r) => r.estado === 'incompleto').length;

  return (
    <VistaPanel titulo="Salidas" icono={<ListOrdered size={18} aria-hidden="true" />} onCerrar={onCerrar} ancho="ancho">
      <section className="qv-vista-section" aria-label="Cola de salida">
        <h3 className="qv-vista-section__title">Cola de salida</h3>
        {lineasVisibles.map((linea) => (
          <ColaLineaBloque
            key={linea.id}
            linea={linea}
            estado={estado}
            trufis={trufis}
            ahora={ahora}
            confirmacion={confirmaciones[linea.id]}
            onDespachar={() => handleDespachar(linea)}
            onMover={moverEnCola}
            onSeleccionarTrufi={onSeleccionarTrufi}
          />
        ))}
      </section>

      <section className="qv-vista-section" aria-label="Salidas de hoy">
        <h3 className="qv-vista-section__title">Salidas de hoy</h3>
        {salidasMostradas.length === 0 ? (
          <p className="qv-vista-hint">Todavía no hay salidas registradas hoy.</p>
        ) : (
          <>
            <table className="qv-salidas-tabla">
              <thead>
                <tr>
                  <th scope="col">Trufi</th>
                  <th scope="col">Línea</th>
                  <th scope="col">Programada</th>
                  <th scope="col">Real</th>
                  <th scope="col">
                    <span className="qv-visually-hidden">Orden</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {salidasMostradas.map((s) => {
                  const trufi = trufis.find((t) => t.id === s.trufiId);
                  const linea = lineas[s.lineaId];
                  return (
                    <tr key={s.id}>
                      <td>{trufi?.placa ?? s.trufiId}</td>
                      <td>{linea.nombre}</td>
                      <td className="qv-tabular">{formatHora(s.programada)}</td>
                      <td className="qv-tabular">{s.real ? formatHora(s.real) : '—'}</td>
                      <td>
                        {s.fueraDeOrden && <span className="qv-chip qv-chip--warning">Fuera de orden</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!verTodasSalidas && todasLasSalidas.length > LIMITE_SALIDAS_TABLA && (
              <button type="button" className="qv-vista-link-btn" onClick={() => setVerTodasSalidas(true)}>
                Ver todas ({todasLasSalidas.length})
              </button>
            )}
          </>
        )}
      </section>

      <section className="qv-vista-section" aria-label="Recorridos del día">
        <h3 className="qv-vista-section__title">Recorridos del día (00–24 h)</h3>
        <TimelineRecorridos
          trufis={trufisVisibles}
          lineas={lineas}
          estado={estado}
          ahora={ahora}
          onSeleccionarTrufi={onSeleccionarTrufi}
        />
        <p className="qv-vista-hint">
          {recorridosVisibles.length} recorridos registrados hoy · {completos} completos · {incompletos} incompletos
        </p>
      </section>
    </VistaPanel>
  );
}
