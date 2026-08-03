'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, DataTable, DatePicker, Grid, KpiCard, PageHeader, Select } from '@quivo/design-system';
import type { AgrupacionActividad, AgrupacionCumplimiento, CumplimientoFila } from '@quivo/shared';
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

/** RF-74..77 (QUI-246) — % de puntos de control cumplidos y recorridos completados vs
 * asignados, agrupado por línea/vehículo/ruta. Fuente de verdad: `validadoPor = 'worker'`
 * (RF-39), calculado en `apps/api/src/modules/reportes/cumplimiento.service.ts`. */
export default function ReportesPage() {
  const { token } = useAuth();
  const router = useRouter();

  const [por, setPor] = useState<AgrupacionCumplimiento>('linea');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [filas, setFilas] = useState<CumplimientoFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [porActividad, setPorActividad] = useState<AgrupacionActividad>('vehiculo');
  const [exportando, setExportando] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    reportesApi
      .cumplimiento(token, {
        por,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
      })
      .then(setFilas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, por, desde, hasta]);

  const puntosTotales = filas.reduce((acc, f) => acc + f.puntosTotales, 0);
  const puntosCumplidos = filas.reduce((acc, f) => acc + f.puntosCumplidos, 0);
  const porcentajeGeneral = puntosTotales > 0 ? (puntosCumplidos / puntosTotales) * 100 : 0;
  const recorridosAsignados = filas.reduce((acc, f) => acc + f.recorridosAsignados, 0);
  const recorridosCompletados = filas.reduce((acc, f) => acc + f.recorridosCompletados, 0);

  async function exportar(reporte: 'recorridos' | 'sanciones' | 'actividad') {
    if (!token) return;
    setExportando(reporte);
    setError(null);
    try {
      const rango = { desde: desde || undefined, hasta: hasta || undefined };
      if (reporte === 'recorridos') await exportesApi.recorridos(token, rango);
      else if (reporte === 'sanciones') await exportesApi.sanciones(token, rango);
      else await exportesApi.actividad(token, { ...rango, por: porActividad });
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
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      <Grid columns={3} gap="md">
        <KpiCard label="Cumplimiento de puntos de control" value={`${porcentajeGeneral.toFixed(1)}%`} tone="primary" />
        <KpiCard label="Puntos cumplidos" value={`${puntosCumplidos} / ${puntosTotales}`} tone="accent" />
        <KpiCard label="Recorridos completados" value={`${recorridosCompletados} / ${recorridosAsignados}`} tone="success" />
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
            onClick={() => exportar('recorridos')}
          >
            {exportando === 'recorridos' ? 'Exportando...' : 'Recorridos por periodo (CSV)'}
          </Button>
          <Button
            variant="secondary"
            disabled={exportando !== null}
            onClick={() => exportar('sanciones')}
          >
            {exportando === 'sanciones' ? 'Exportando...' : 'Sanciones (CSV)'}
          </Button>
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
