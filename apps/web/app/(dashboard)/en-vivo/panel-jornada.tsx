import { useEffect, useMemo, useState } from 'react';
import { Button, Loader, Tag } from '@quivo/design-system';
import type { EstadoJornada, JornadaVehiculo } from '@quivo/shared';
import { ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useJornadasHoy } from '../../../src/lib/en-vivo/use-en-vivo';
import {
  agruparJornadas,
  fechaSiDifiereDeHoy,
  lineaTiempo,
  textoResumen,
} from '../../../src/lib/en-vivo/jornadas';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import { mensajeError } from './map-builders';

const CLAVE_EXPANDIDA = 'qv:en-vivo:jornada-expandida';
const ID_LISTA = 'panel-jornada-lista';

/** Color del punto de cada grupo. Es refuerzo: el estado SIEMPRE va también como texto. */
const COLOR_ESTADO: Record<EstadoJornada, string> = {
  sin_iniciar: 'var(--qv-color-warning)',
  dia_iniciado: 'var(--qv-color-primary)',
  en_recorrido: 'var(--qv-color-success)',
  finalizado: 'var(--qv-text-muted)',
};

function capitalizar(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

function FilaVehiculo({ v, ahora }: { v: JornadaVehiculo; ahora: number }) {
  const tiempo = lineaTiempo(v, ahora);
  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1rem',
        padding: '0.4rem 0.5rem',
        borderRadius: 'var(--qv-radius-md)',
        backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 50%, transparent)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
        <strong
          translate="no"
          style={{
            fontSize: '0.9375rem',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--qv-text-primary)',
          }}
        >
          {v.placa}
        </strong>
        {v.numeroInterno && (
          <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
            #{v.numeroInterno}
          </span>
        )}
        <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
          {v.lineaNombre} · {capitalizar(v.rutaSentido)}
        </span>
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)' }}>
        {v.conductorNombre ?? 'Sin conductor'}
      </span>
      {tiempo && (
        <span
          style={{
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
            color: tiempo.atenuado ? 'var(--qv-text-muted)' : 'var(--qv-text-primary)',
          }}
        >
          {tiempo.texto}
        </span>
      )}
    </li>
  );
}

/**
 * Release 13 — "Jornada de hoy": qué vehículos asignados declararon "Empezar día" desde la
 * app móvil, cuáles están en recorrido y cuáles todavía no iniciaron. Es de solo lectura y obedece
 * al filtro de línea de la página.
 *
 * Nace PLEGADO: el mapa es la superficie principal y el resumen de una línea (`8 iniciaron ·
 * 3 sin iniciar · 2 en recorrido`) ya responde la pregunta frecuente; el detalle por vehículo se
 * abre a pedido. La elección se recuerda por navegador (`localStorage`, solo conveniencia).
 *
 * Es dueño de su query y de su reloj (30 s) para que el poll no re-renderice la página del
 * mapa — mismo criterio que `PanelFrescura`. `flotante={false}` lo deja en el flujo normal
 * (estado vacío de la página, donde no hay mapa al que flotarle encima).
 */
export function PanelJornada({
  lineaFilter,
  flotante = true,
}: {
  lineaFilter: string;
  flotante?: boolean;
}) {
  const { token } = useAuth();
  const jornadas = useJornadasHoy(token);
  // 30 s: la fuente se refresca con el mismo ritmo; un tick de 1 Hz no aportaría información.
  const ahora = useReloj(30_000);
  const [expandido, setExpandido] = useState(false);

  // Se lee en un efecto (no en el inicializador) para no divergir del HTML del servidor.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_EXPANDIDA) === '1') setExpandido(true);
    } catch {
      /* almacenamiento bloqueado: se queda plegado */
    }
  }, []);

  const alternar = () => {
    const siguiente = !expandido;
    setExpandido(siguiente);
    try {
      window.localStorage.setItem(CLAVE_EXPANDIDA, siguiente ? '1' : '0');
    } catch {
      /* sin persistencia: no es crítico */
    }
  };

  const { grupos, resumen } = useMemo(
    () => agruparJornadas(jornadas.data?.vehiculos ?? [], lineaFilter),
    [jornadas.data, lineaFilter],
  );

  const sinDatos = !jornadas.data;
  // Hay datos pero el último refetch falló: lo que se ve es viejo y hay que decirlo.
  const desactualizado = jornadas.isError && !sinDatos;
  const fechaAjena = jornadas.data ? fechaSiDifiereDeHoy(jornadas.data.fecha, ahora) : null;
  const resumenTexto = jornadas.isLoading
    ? 'Cargando…'
    : sinDatos && jornadas.isError
      ? 'No disponible'
      : textoResumen(resumen) + (desactualizado ? ' · sin actualizar' : '');

  return (
    <section
      className={flotante ? 'qv-live-hud-jornada' : undefined}
      aria-label="Jornada de hoy"
      // El contenedor de la página vacía centra el texto: el panel siempre va alineado a la izquierda.
      style={flotante ? { textAlign: 'left' } : { width: 'min(24rem, 100%)', textAlign: 'left' }}
    >
      <div
        className="qv-live-hud-card"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', width: '100%', boxSizing: 'border-box' }}
      >
        <button
          type="button"
          className="qv-live-hud-jornada-toggle"
          onClick={alternar}
          aria-expanded={expandido}
          aria-controls={ID_LISTA}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            width: '100%',
            minHeight: '2.25rem',
            padding: 0,
            border: 'none',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <ClipboardCheck size={15} aria-hidden style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>Jornada de hoy</strong>
            <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)' }}>{resumenTexto}</span>
          </span>
          {expandido ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>

        <div
          id={ID_LISTA}
          hidden={!expandido}
          className="qv-live-hud-jornada-lista"
          style={{
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--qv-border-glass)',
          }}
        >
          {jornadas.isLoading && <Loader label="Cargando jornada…" />}

          {desactualizado && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                marginBottom: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--qv-color-warning)',
              }}
            >
              <span>No se pudo actualizar; se muestran los últimos datos.</span>
              <Button size="sm" variant="secondary" onClick={() => void jornadas.refetch()}>
                Reintentar
              </Button>
            </div>
          )}

          {fechaAjena && (
            <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.6875rem', color: 'var(--qv-text-muted)' }}>
              Datos del {fechaAjena}
            </p>
          )}

          {sinDatos && jornadas.isError && (
            <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8125rem' }}>
              <span>No se pudo cargar la jornada: {mensajeError(jornadas.error)}</span>
              <span>
                <Button size="sm" variant="secondary" onClick={() => void jornadas.refetch()}>
                  Reintentar
                </Button>
              </span>
            </div>
          )}

          {jornadas.data && resumen.total === 0 && (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
              {lineaFilter
                ? 'Sin vehículos asignados hoy en esta línea'
                : 'Sin vehículos asignados hoy'}
            </p>
          )}

          {grupos.map((g) => (
            <section key={g.estado} aria-label={g.etiqueta} style={{ marginBottom: '0.625rem' }}>
              <h3
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: '0 0 0.3rem 0',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--qv-text-muted)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: '0.5rem',
                    height: '0.5rem',
                    borderRadius: '50%',
                    background: COLOR_ESTADO[g.estado],
                  }}
                />
                {g.etiqueta}
                <Tag variant="neutral">{g.vehiculos.length}</Tag>
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {g.vehiculos.map((v) => (
                  <FilaVehiculo key={v.vehiculoId} v={v} ahora={ahora} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
