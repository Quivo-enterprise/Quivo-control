'use client';

import { Button, MetricStrip, PlateBadge } from '@quivo/design-system';
import { Activity, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import {
  demandaDe,
  movimientoPorHora,
  movimientoTipicoPorHora,
  paradasDe,
  recorridosDelDia,
  useFlotaMock,
  type DemandaParada,
  type FaseTrufi,
  type LineaMock,
  type ParadaMock,
} from '../../../../../src/lib/mock-flota';
import { VistaPanel, type VistaProps } from './vista-panel';

/**
 * Vista "Análisis" (E07 04:32 del guion — `docs/guion-grabacion-mock.md`): tráfico, alta
 * demanda y horas pico. `movimientoPorHora` se grafica con un chart de barras propio (24
 * columnas) en vez de `BarTrendChart` del design-system — ese componente no soporta resaltar
 * columnas individuales (picos) ni marcar la hora actual, y ambas cosas son requisito del
 * contrato de esta vista.
 *
 * Ítem 2 del guion de fixes (2026-09-27): `movimientoPorHora` da 0 en toda hora que todavía no
 * pasó (nada sembrado/disparado ahí todavía) — antes el chart lo graficaba tal cual y se veía
 * "cortado" en 0 desde la hora actual hasta las 23. Ahora dibuja barras REALES hasta la hora
 * actual y, para el resto, la curva "típica" (`movimientoTipicoPorHora`) como barras más claras
 * y punteadas — leyenda "Hoy" / "Típico" para distinguirlas. Las 3 etiquetas "HORA PICO"
 * flotantes (mal ancladas al no tener una columna fija a la que apuntar) se reemplazan por una
 * franja sombreada DETRÁS de las barras 7-9/12-14/18-20.
 */

const PICOS: [number, number][] = [
  [7, 9],
  [12, 14],
  [18, 20],
];

function esHoraPico(hora: number): boolean {
  return PICOS.some(([inicio, fin]) => hora >= inicio && hora < fin);
}

interface HoraChartProps {
  valoresReales: number[];
  valoresTipicos: number[];
  horaActual: number;
}

function HoraChart({ valoresReales, valoresTipicos, horaActual }: HoraChartProps) {
  const max = Math.max(1, ...valoresReales, ...valoresTipicos);
  return (
    <div className="qv-hora-chart">
      <div className="qv-hora-chart__legend">
        <span className="qv-hora-chart__legend-item">
          <span className="qv-hora-chart__swatch qv-hora-chart__swatch--normal" aria-hidden="true" />
          Hoy
        </span>
        <span className="qv-hora-chart__legend-item">
          <span className="qv-hora-chart__swatch qv-hora-chart__swatch--tipico" aria-hidden="true" />
          Típico
        </span>
        <span className="qv-hora-chart__legend-item">
          <span className="qv-hora-chart__swatch qv-hora-chart__swatch--pico" aria-hidden="true" />
          Hora pico
        </span>
        <span className="qv-hora-chart__legend-item">
          <span className="qv-hora-chart__swatch qv-hora-chart__swatch--ahora" aria-hidden="true" />
          Ahora
        </span>
      </div>
      <div className="qv-hora-chart__plot-wrap">
        <div className="qv-hora-chart__picos" aria-hidden="true">
          {PICOS.map(([inicio, fin]) => (
            <span
              key={inicio}
              className="qv-hora-chart__pico-band"
              style={{ left: `${(inicio / 24) * 100}%`, width: `${((fin - inicio) / 24) * 100}%` }}
            />
          ))}
        </div>
        <ul className="qv-hora-chart__plot" role="list">
          {valoresReales.map((valorReal, hora) => {
            // Después de la hora actual todavía no hay recorridos reales — usa la curva típica
            // (más clara/punteada) en vez del 0 real, así el chart no se ve cortado.
            const esTipico = hora > horaActual;
            const valor = esTipico ? valoresTipicos[hora]! : valorReal;
            const alturaPct = Math.max(4, (valor / max) * 100);
            const pico = esHoraPico(hora);
            const esAhora = hora === horaActual;
            const etiquetaHora = `${String(hora).padStart(2, '0')}:00`;
            const descripcion = `${etiquetaHora} · ${valor} recorrido${valor === 1 ? '' : 's'}${esTipico ? ' (típico)' : ' (hoy)'}${pico ? ' · hora pico' : ''}${esAhora ? ' · hora actual' : ''}`;
            return (
              <li
                key={hora}
                role="listitem"
                className={`qv-hora-chart__col ${pico ? 'qv-hora-chart__col--pico' : ''} ${esAhora ? 'qv-hora-chart__col--ahora' : ''}`}
              >
                <span
                  className={`qv-hora-chart__bar ${esTipico ? 'qv-hora-chart__bar--tipico' : ''}`}
                  style={{ height: `${alturaPct}%` }}
                  title={descripcion}
                  aria-label={descripcion}
                />
                <span className="qv-hora-chart__eje-label qv-tabular">{String(hora).padStart(2, '0')}</span>
                {esAhora && <span className="qv-hora-chart__ahora-tag">Ahora</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function VistaAnalisis({ lineaId, onSeleccionarTrufi, onCerrar }: VistaProps) {
  const { estado, lineas, trufis, alternarHoraPico } = useFlotaMock();
  const ahora = new Date();
  const horaActual = ahora.getHours();
  const filtroLinea = useMemo(() => (lineaId ? { lineaId } : {}), [lineaId]);
  const lineasVisibles = useMemo<LineaMock[]>(
    () => (lineaId ? [lineas[lineaId]] : Object.values(lineas)),
    [lineaId, lineas],
  );
  const trufisVisibles = useMemo(
    () => (lineaId ? trufis.filter((t) => t.lineaId === lineaId) : trufis),
    [trufis, lineaId],
  );

  const recorridosHoy = recorridosDelDia(estado, filtroLinea);
  const cerrados = recorridosHoy.filter((r) => r.fin);
  const promedioMin =
    cerrados.length > 0
      ? Math.round(
          cerrados.reduce((acc, r) => acc + (Date.parse(r.fin!) - Date.parse(r.inicio)) / 60_000, 0) / cerrados.length,
        )
      : null;

  const valoresHora = movimientoPorHora(estado, lineaId ?? undefined);
  const valoresHoraTipico = movimientoTipicoPorHora(lineaId ?? undefined);
  const horaMasMovimiento = valoresHora.reduce(
    (mejor, valor, hora) => (valor > valoresHora[mejor]! ? hora : mejor),
    0,
  );

  const paradasDemanda: { parada: ParadaMock; linea: LineaMock; demanda: DemandaParada }[] = [];
  for (const linea of lineasVisibles) {
    // `paradasDe` (no `linea.paradas`, ítem 2): nombres editados en vivo desde Configuración.
    for (const parada of paradasDe(estado, linea.id)) {
      const demanda = demandaDe(parada.id, ahora, estado.horaPico);
      if (demanda.nivel !== 'baja') {
        paradasDemanda.push({ parada, linea, demanda });
      }
    }
  }
  paradasDemanda.sort((a, b) => b.demanda.esperando - a.demanda.esperando);

  const FASES_PROBLEMA = new Set<FaseTrufi>(['atascado', 'desviado']);
  const trufisProblema = trufisVisibles.filter((t) => {
    const fase = estado.trufis[t.id]?.fase;
    return fase !== undefined && FASES_PROBLEMA.has(fase);
  });

  return (
    <VistaPanel titulo="Análisis" icono={<Activity size={18} aria-hidden="true" />} onCerrar={onCerrar} ancho="ancho">
      <section className="qv-vista-section" aria-label="Indicadores">
        <MetricStrip
          metrics={[
            { label: 'Recorridos hoy', value: String(recorridosHoy.length) },
            { label: 'Promedio por vuelta', value: promedioMin !== null ? `${promedioMin} min` : '—' },
            { label: 'Hora de mayor movimiento', value: `${String(horaMasMovimiento).padStart(2, '0')}:00` },
          ]}
        />
      </section>

      <section className="qv-vista-section" aria-label="Movimiento por hora">
        <h3 className="qv-vista-section__title">Movimiento por hora (00–24 h)</h3>
        <HoraChart valoresReales={valoresHora} valoresTipicos={valoresHoraTipico} horaActual={horaActual} />
      </section>

      <section className="qv-vista-section" aria-label="Paradas con alta demanda">
        <div className="qv-vista-section__header">
          <h3 className="qv-vista-section__title">Paradas con alta demanda ahora</h3>
          <Button
            size="sm"
            variant={estado.horaPico ? 'primary' : 'secondary'}
            aria-pressed={estado.horaPico}
            onClick={() => alternarHoraPico()}
          >
            <TrendingUp size={14} aria-hidden="true" />
            {estado.horaPico ? 'Volver a demanda real' : 'Ver escenario hora pico'}
          </Button>
        </div>
        {paradasDemanda.length === 0 ? (
          <p className="qv-vista-hint">Sin paradas con demanda elevada ahora.</p>
        ) : (
          <ul className="qv-demanda-lista">
            {paradasDemanda.map(({ parada, linea, demanda }) => (
              <li key={parada.id} className="qv-demanda-item">
                <span className="qv-demanda-item__nombre">{parada.nombre}</span>
                <span className="qv-demanda-item__linea">{linea.nombre}</span>
                <span className="qv-demanda-item__esperando qv-tabular">~{demanda.esperando} esperando</span>
                <span className={`qv-chip ${demanda.nivel === 'alta' ? 'qv-chip--danger' : 'qv-chip--warning'}`}>
                  {demanda.nivel === 'alta' ? 'Alta' : 'Media'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="qv-vista-section" aria-label="Unidades con problemas de tráfico">
        <h3 className="qv-vista-section__title">Unidades con problemas de tráfico</h3>
        {trufisProblema.length === 0 ? (
          <p className="qv-vista-hint">Sin unidades con problemas de tráfico ahora.</p>
        ) : (
          <ul className="qv-trafico-lista">
            {trufisProblema.map((t) => {
              const fase = estado.trufis[t.id]!.fase;
              const linea = lineas[t.lineaId];
              return (
                <li key={t.id}>
                  <button type="button" className="qv-trafico-item" onClick={() => onSeleccionarTrufi(t.id)}>
                    <PlateBadge plate={t.placa} />
                    <span className="qv-trafico-item__linea">{linea.nombre}</span>
                    <span className={`qv-chip ${fase === 'atascado' ? 'qv-chip--danger' : 'qv-chip--warning'}`}>
                      {fase === 'atascado' ? 'Atascado' : 'Desviado'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </VistaPanel>
  );
}
