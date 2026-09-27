'use client';

import { Button, Select } from '@quivo/design-system';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  CornerUpRight,
  MapPin,
  MessageCircle,
  MessageSquare,
  TrafficCone,
  WifiOff,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  construirUrlWhatsApp,
  infraccionDeNovedad,
  mensajeParaConductor,
  useFlotaMock,
  type NovedadMock,
  type SubtipoReporteConductor,
  type TipoNovedad,
} from '../../../../../src/lib/mock-flota';
import { VistaPanel, type VistaProps } from './vista-panel';

export type { VistaProps };

const ICONO_TIPO: Record<TipoNovedad, typeof AlertTriangle> = {
  desvio: CornerUpRight,
  fuera_de_orden: ArrowUpDown,
  reporte_conductor: MessageSquare,
  atascado: TrafficCone,
  sin_senal: WifiOff,
};

const ETIQUETA_TIPO: Record<TipoNovedad, string> = {
  desvio: 'Desvío de ruta',
  fuera_de_orden: 'Fuera de orden',
  reporte_conductor: 'Reporte del conductor',
  atascado: 'Atascado en tráfico',
  sin_senal: 'Sin señal',
};

const ETIQUETA_SUBTIPO: Record<SubtipoReporteConductor, string> = {
  pinchazo: 'Pinchazo',
  control_policial: 'Control policial',
  bloqueo_via: 'Bloqueo de vía',
  falla_mecanica: 'Falla mecánica',
  incidente_pasajero: 'Incidente con pasajero',
};

const ETIQUETA_ESTADO: Record<NovedadMock['estado'], string> = {
  nueva: 'Nueva',
  en_revision: 'En revisión',
  atendida: 'Atendida',
};

function tituloDe(novedad: NovedadMock): string {
  if (novedad.tipo === 'reporte_conductor' && novedad.subtipo) {
    return `${ETIQUETA_TIPO[novedad.tipo]}: ${ETIQUETA_SUBTIPO[novedad.subtipo]}`;
  }
  return ETIQUETA_TIPO[novedad.tipo];
}

function tiempoRelativo(iso: string, ahoraMs: number): string {
  const minutos = Math.max(0, Math.round((ahoraMs - Date.parse(iso)) / 60_000));
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `hace ${horas} h ${minutos % 60} min`;
}

export function VistaNovedades({ lineaId, onSeleccionarTrufi, onCerrar }: VistaProps) {
  const { estado, trufis, lineas, catalogo, revisarNovedad, atenderNovedad, crearInfraccionDesdeNovedad } = useFlotaMock();
  const [filtro, setFiltro] = useState<'abiertas' | 'todas'>('abiertas');
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [tipoInfraccion, setTipoInfraccion] = useState('');
  // Ítem 6 del guion de fixes: `crearInfraccionDesdeNovedad` devuelve `AccionResultado` — el
  // banner tiene que poder mostrar el `motivo` del fallo (p. ej. el trufi ya tiene una
  // infracción activa), no solo el mensaje de éxito.
  const [confirmacion, setConfirmacion] = useState<{ mensaje: string; ok: boolean } | null>(null);

  const trufiDe = (trufiId: string) => trufis.find((t) => t.id === trufiId);

  const novedadesFiltradas = useMemo(() => {
    const porLinea = estado.novedades.filter((n) => {
      if (!lineaId) return true;
      return trufiDe(n.trufiId)?.lineaId === lineaId;
    });
    const porEstado = filtro === 'todas' ? porLinea : porLinea.filter((n) => n.estado !== 'atendida');
    return [...porEstado].sort((a, b) => Date.parse(b.creadaEn) - Date.parse(a.creadaEn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.novedades, lineaId, filtro, trufis]);

  const seleccionada = seleccionadaId ? estado.novedades.find((n) => n.id === seleccionadaId) : undefined;
  const trufiSeleccionada = seleccionada ? trufiDe(seleccionada.trufiId) : undefined;
  const lineaSeleccionada = trufiSeleccionada ? lineas[trufiSeleccionada.lineaId] : undefined;

  function abrir(novedad: NovedadMock) {
    setSeleccionadaId(novedad.id);
    setNota('');
    setTipoInfraccion('');
    setConfirmacion(null);
    if (novedad.estado === 'nueva') {
      revisarNovedad(novedad.id);
    }
  }

  function handleMarcarAtendida() {
    if (!seleccionada || nota.trim().length === 0) return;
    atenderNovedad(seleccionada.id, nota.trim());
    setConfirmacion({ mensaje: 'Novedad marcada como atendida.', ok: true });
    setNota('');
  }

  function handleCrearInfraccion() {
    if (!seleccionada || !tipoInfraccion) return;
    const resultado = crearInfraccionDesdeNovedad(seleccionada.id, tipoInfraccion);
    if (!resultado.ok) {
      setConfirmacion({ mensaje: resultado.motivo, ok: false });
      return;
    }
    const tipo = catalogo.find((t) => t.id === tipoInfraccion);
    setConfirmacion({ mensaje: tipo ? `Infracción "${tipo.nombre}" creada.` : 'Infracción creada.', ok: true });
    setTipoInfraccion('');
  }

  // Ítem 7 del guion de fixes: antes `seleccionada?.tipo === 'desvio'` asumía que TODO desvío
  // tenía infracción automática — falso para novedades sembradas del historial (nunca la
  // tienen) y para un desvío en vivo cuya infracción se descartó por dedupe (el trufi ya tenía
  // una activa, ver `flota-mock-context.tsx`). `infraccionDeNovedad` mira el vínculo real.
  const infraccionAsociada = seleccionada ? infraccionDeNovedad(estado, seleccionada.id) : undefined;
  const tipoInfraccionAsociada = infraccionAsociada ? catalogo.find((t) => t.id === infraccionAsociada.tipoId) : undefined;

  return (
    <VistaPanel titulo="Novedades" icono={<AlertTriangle size={16} aria-hidden="true" />} onCerrar={onCerrar}>
      <div className="qv-novedades">
        <div className="qv-novedades__segmented" role="tablist" aria-label="Filtro de novedades">
          <button
            type="button"
            role="tab"
            aria-selected={filtro === 'abiertas'}
            className={`qv-novedades__segmented-btn ${filtro === 'abiertas' ? 'qv-novedades__segmented-btn--active' : ''}`}
            onClick={() => setFiltro('abiertas')}
          >
            Abiertas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filtro === 'todas'}
            className={`qv-novedades__segmented-btn ${filtro === 'todas' ? 'qv-novedades__segmented-btn--active' : ''}`}
            onClick={() => setFiltro('todas')}
          >
            Todas
          </button>
        </div>

        <div className="qv-novedades__layout">
          <ul className="qv-novedades__lista">
            {novedadesFiltradas.length === 0 && <li className="qv-novedades__vacio">Sin novedades para mostrar.</li>}
            {novedadesFiltradas.map((novedad) => {
              const trufi = trufiDe(novedad.trufiId);
              const Icono = ICONO_TIPO[novedad.tipo];
              return (
                <li key={novedad.id}>
                  <button
                    type="button"
                    className={`qv-novedades__item ${seleccionadaId === novedad.id ? 'qv-novedades__item--active' : ''}`}
                    onClick={() => abrir(novedad)}
                    aria-current={seleccionadaId === novedad.id ? 'true' : undefined}
                  >
                    <Icono size={16} aria-hidden="true" className="qv-novedades__item-icono" />
                    <span className="qv-novedades__item-texto">
                      <span className="qv-novedades__item-titulo">{tituloDe(novedad)}</span>
                      <span className="qv-novedades__item-meta">
                        {trufi ? `${trufi.placa} · ${lineas[trufi.lineaId].nombre}` : novedad.trufiId} ·{' '}
                        {tiempoRelativo(novedad.creadaEn, Date.now())}
                      </span>
                    </span>
                    <span className={`qv-novedades__estado-chip qv-novedades__estado-chip--${novedad.estado}`}>
                      {ETIQUETA_ESTADO[novedad.estado]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {seleccionada && trufiSeleccionada && lineaSeleccionada && (
            <div className="qv-novedades__detalle">
              <h4 className="qv-novedades__detalle-titulo">{tituloDe(seleccionada)}</h4>
              <p className="qv-novedades__detalle-meta">
                {trufiSeleccionada.placa} · {lineaSeleccionada.nombre} · {trufiSeleccionada.conductorNombre}
              </p>
              <span className={`qv-novedades__estado-chip qv-novedades__estado-chip--${seleccionada.estado}`}>
                {ETIQUETA_ESTADO[seleccionada.estado]}
              </span>

              {seleccionada.nota && (
                <p className="qv-novedades__detalle-nota">
                  <strong>Nota:</strong> {seleccionada.nota}
                </p>
              )}

              <div className="qv-novedades__acciones-row">
                <Button size="sm" variant="secondary" onClick={() => onSeleccionarTrufi(seleccionada.trufiId)}>
                  <MapPin size={14} aria-hidden="true" /> Ver en mapa
                </Button>
                <a
                  className="qv-novedades__whatsapp-btn"
                  href={construirUrlWhatsApp(trufiSeleccionada.whatsapp, mensajeParaConductor(trufiSeleccionada, lineaSeleccionada))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                </a>
              </div>

              {!infraccionAsociada && seleccionada.estado !== 'atendida' && (
                <div className="qv-novedades__section">
                  <span className="qv-novedades__section-title">Crear infracción</span>
                  <div className="qv-novedades__row">
                    <Select
                      aria-label="Tipo de infracción"
                      options={catalogo.map((t) => ({ label: t.nombre, value: t.id }))}
                      placeholder="Elegir tipo…"
                      value={tipoInfraccion}
                      onChange={(e) => setTipoInfraccion(e.target.value)}
                    />
                    <Button size="sm" variant="secondary" onClick={handleCrearInfraccion} disabled={!tipoInfraccion}>
                      Crear
                    </Button>
                  </div>
                </div>
              )}
              {infraccionAsociada && (
                <span className="qv-novedades__hint">
                  Infracción generada: {tipoInfraccionAsociada?.nombre ?? infraccionAsociada.tipoId} —{' '}
                  <button type="button" className="qv-vista-link-btn" onClick={() => onSeleccionarTrufi(seleccionada.trufiId)}>
                    ver en ficha
                  </button>
                </span>
              )}

              {seleccionada.estado !== 'atendida' && (
                <div className="qv-novedades__section">
                  <span className="qv-novedades__section-title">Marcar atendida</span>
                  <label className="qv-novedades__label" htmlFor="qv-novedades-nota">
                    Nota de atención
                  </label>
                  <textarea
                    id="qv-novedades-nota"
                    className="qv-novedades__textarea"
                    placeholder="Nota breve de lo actuado (obligatoria)…"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={2}
                  />
                  <Button size="sm" variant="primary" onClick={handleMarcarAtendida} disabled={nota.trim().length === 0}>
                    <CheckCircle2 size={14} aria-hidden="true" /> Marcar atendida
                  </Button>
                </div>
              )}

              <div aria-live="polite">
                {confirmacion && (
                  <div className={`qv-novedades__confirmacion ${confirmacion.ok ? '' : 'qv-novedades__confirmacion--error'}`}>
                    {confirmacion.mensaje}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </VistaPanel>
  );
}
