'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DatePicker,
  Grid,
  KpiCard,
  PageHeader,
  Select,
} from '@quivo/design-system';
import type {
  AgrupacionActividad,
  AgrupacionCumplimiento,
  CumplimientoFila,
  EstadoSancion,
  SujetoTipo,
} from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { reportesApi } from '../../../src/lib/api/reportes';
import { exportesApi } from '../../../src/lib/api/exportes';
import { ApiError } from '../../../src/lib/api/client';

const OPCIONES_ACTIVIDAD: { label: string; value: AgrupacionActividad }[] = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
];

const OPCIONES_AGRUPACION: { label: string; value: AgrupacionCumplimiento }[] = [
  { label: 'Línea', value: 'linea' },
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Ruta', value: 'ruta' },
];

const OPCIONES_ESTADO_SANCION: { label: string; value: EstadoSancion | '' }[] = [
  { label: 'Todos los estados', value: '' },
  { label: 'Pendiente', value: 'pendiente' },
  { label: 'Aplicada', value: 'aplicada' },
  { label: 'Anulada', value: 'anulada' },
  { label: 'Apelada', value: 'apelada' },
  { label: 'Pagada', value: 'pagada' },
];

const OPCIONES_SUJETO_SANCION: { label: string; value: SujetoTipo | '' }[] = [
  { label: 'Todos los sujetos', value: '' },
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
  { label: 'Socio', value: 'socio' },
];

/** RF-74..77 (QUI-246) — % de puntos de control cumplidos y recorridos completados vs
 * asignados, agrupado por línea/vehículo/ruta. Fuente de verdad: `validadoPor = 'worker'`
 * (RF-39), calculado en `apps/api/src/modules/reportes/cumplimiento.service.ts`. */
export default function ReportesPage() {
  return (
    <Suspense>
      <ReportesContent />
    </Suspense>
  );
}

function ReportesContent() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Filtros de cumplimiento — persistidos en query params ─────────────────
  const porParam = (searchParams.get('por') as AgrupacionCumplimiento | null) ?? 'linea';
  const desdeParam = searchParams.get('desde') ?? '';
  const hastaParam = searchParams.get('hasta') ?? '';

  // Controles del formulario (pueden diferir de la URL hasta "Aplicar filtros")
  const [por, setPor] = useState<AgrupacionCumplimiento>(porParam);
  const [desde, setDesde] = useState(desdeParam);
  const [hasta, setHasta] = useState(hastaParam);

  // Sincronizar controles si la URL cambia externamente (ej: navegar atrás)
  useEffect(() => {
    setPor(porParam);
    setDesde(desdeParam);
    setHasta(hastaParam);
  }, [porParam, desdeParam, hastaParam]);

  const [filas, setFilas] = useState<CumplimientoFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [porActividad, setPorActividad] = useState<AgrupacionActividad>('vehiculo');
  const [estadoSancion, setEstadoSancion] = useState<EstadoSancion | ''>('');
  const [sujetoTipoSancion, setSujetoTipoSancion] = useState<SujetoTipo | ''>('');
  const [exportando, setExportando] = useState<string | null>(null);

  const rangoFechasInvalido = Boolean(desde && hasta && desde > hasta);

  // ── Carga de datos: se dispara cuando cambian los query params ────────────
  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setLoading(true);
    setError(null);
    reportesApi
      .cumplimiento(token, {
        por: porParam,
        desde: desdeParam ? new Date(desdeParam) : undefined,
        hasta: hastaParam ? new Date(hastaParam) : undefined,
      })
      .then((rows) => {
        if (!cancelado) setFilas(rows);
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, porParam, desdeParam, hastaParam]);

  const puntosTotales = filas.reduce((acc, f) => acc + f.puntosTotales, 0);
  const puntosCumplidos = filas.reduce((acc, f) => acc + f.puntosCumplidos, 0);
  const porcentajeGeneral = puntosTotales > 0 ? (puntosCumplidos / puntosTotales) * 100 : 0;
  const recorridosAsignados = filas.reduce((acc, f) => acc + f.recorridosAsignados, 0);
  const recorridosCompletados = filas.reduce((acc, f) => acc + f.recorridosCompletados, 0);

  // ── Persistir filtros en la URL ───────────────────────────────────────────
  const aplicarFiltros = useCallback(() => {
    if (rangoFechasInvalido) return;
    const usp = new URLSearchParams();
    usp.set('por', por);
    if (desde) usp.set('desde', desde);
    if (hasta) usp.set('hasta', hasta);
    router.replace(`/reportes?${usp.toString()}`);
  }, [rangoFechasInvalido, por, desde, hasta, router]);

  const limpiarFiltros = useCallback(() => {
    setPor('linea');
    setDesde('');
    setHasta('');
    router.replace('/reportes');
  }, [router]);

  // ── Exportaciones ─────────────────────────────────────────────────────────
  async function exportar(reporte: 'cumplimiento' | 'recorridos' | 'sanciones' | 'actividad') {
    if (!token) return;
    setExportando(reporte);
    setError(null);
    try {
      const rango = { desde: desdeParam || undefined, hasta: hastaParam || undefined };
      if (reporte === 'cumplimiento') {
        await exportesApi.cumplimiento(token, { ...rango, por: porParam });
      } else if (reporte === 'recorridos') {
        await exportesApi.recorridos(token, rango);
      } else if (reporte === 'sanciones') {
        await exportesApi.sanciones(token, {
          ...rango,
          estado: estadoSancion || undefined,
          sujetoTipo: sujetoTipoSancion || undefined,
        });
      } else {
        await exportesApi.actividad(token, { ...rango, por: porActividad });
      }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setExportando(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Reportes"
        subtitle="RF-74..77 — cumplimiento de puntos de control y recorridos completados, agrupado por línea, vehículo o ruta."
        actions={
          <Button variant="secondary" onClick={() => router.push('/reportes/recorridos')}>
            Ver recorridos (RNF-24)
          </Button>
        }
      />
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}

      <Grid columns={3} gap="md">
        <KpiCard
          label="Cumplimiento de puntos de control"
          value={`${porcentajeGeneral.toFixed(1)}%`}
          tone="primary"
        />
        <KpiCard
          label="Puntos cumplidos"
          value={`${puntosCumplidos} / ${puntosTotales}`}
          tone="accent"
        />
        <KpiCard
          label="Recorridos completados"
          value={`${recorridosCompletados} / ${recorridosAsignados}`}
          tone="success"
        />
      </Grid>

      <Card header="Filtros">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          <Select
            label="Agrupar por"
            options={OPCIONES_AGRUPACION}
            value={por}
            onChange={(e) => setPor(e.target.value as AgrupacionCumplimiento)}
          />
          <DatePicker label="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <DatePicker label="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        {rangoFechasInvalido && (
          <Alert variant="warning" title="Revisá el rango de fechas" style={{ marginTop: '1rem' }}>
            La fecha de inicio no puede ser posterior a la fecha de fin.
          </Alert>
        )}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <Button onClick={aplicarFiltros} disabled={rangoFechasInvalido}>
            Aplicar filtros
          </Button>
          <Button variant="ghost" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        </div>
      </Card>

      <DataTable<CumplimientoFila>
        loading={loading}
        rows={filas}
        empty="Sin datos de cumplimiento para el período seleccionado."
        columns={[
          { key: 'nombre', header: 'Nombre' },
          {
            key: 'porcentajeCumplimiento',
            header: '% cumplimiento',
            render: (f) => `${f.porcentajeCumplimiento.toFixed(1)}%`,
          },
          {
            key: 'puntosCumplidos',
            header: 'Puntos de control',
            render: (f) => `${f.puntosCumplidos} / ${f.puntosTotales}`,
          },
          {
            key: 'recorridosCompletados',
            header: 'Recorridos',
            render: (f) => `${f.recorridosCompletados} / ${f.recorridosAsignados}`,
          },
        ]}
      />

      <Card header="Exportar reportes (RF-78..80)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <Button
            variant="secondary"
            disabled={exportando !== null}
            onClick={() => exportar('cumplimiento')}
          >
            {exportando === 'cumplimiento' ? 'Exportando...' : 'Cumplimiento (CSV)'}
          </Button>
          <Button
            variant="secondary"
            disabled={exportando !== null}
            onClick={() => exportar('recorridos')}
          >
            {exportando === 'recorridos' ? 'Exportando...' : 'Recorridos por periodo (CSV)'}
          </Button>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <Select
              label="Estado de sanción"
              options={OPCIONES_ESTADO_SANCION}
              value={estadoSancion}
              onChange={(e) => setEstadoSancion(e.target.value as EstadoSancion | '')}
            />
            <Select
              label="Sujeto de sanción"
              options={OPCIONES_SUJETO_SANCION}
              value={sujetoTipoSancion}
              onChange={(e) => setSujetoTipoSancion(e.target.value as SujetoTipo | '')}
            />
            <Button
              variant="secondary"
              disabled={exportando !== null}
              onClick={() => exportar('sanciones')}
            >
              {exportando === 'sanciones' ? 'Exportando...' : 'Sanciones (CSV)'}
            </Button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <Select
              label="Actividad por"
              options={OPCIONES_ACTIVIDAD}
              value={porActividad}
              onChange={(e) => setPorActividad(e.target.value as AgrupacionActividad)}
            />
            <Button
              variant="secondary"
              disabled={exportando !== null}
              onClick={() => exportar('actividad')}
            >
              {exportando === 'actividad' ? 'Exportando...' : 'Actividad (CSV)'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
