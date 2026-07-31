'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProgressBarProps } from '@quivo/design-system';
import { Alert, ChartCard, DataPanel, Grid, KpiCard, Loader, ProgressBar } from '@quivo/design-system';
import type { Conductor, Sindicato, Socio, Vehiculo } from '@quivo/shared';
import { useAuth } from '../../src/lib/auth/auth-context';
import { ApiError } from '../../src/lib/api/client';
import { sindicatosApi } from '../../src/lib/api/sindicatos';
import { sociosApi } from '../../src/lib/api/socios';
import { vehiculosApi } from '../../src/lib/api/vehiculos';
import { conductoresApi } from '../../src/lib/api/conductores';

const VEHICULO_VARIANT: Record<Vehiculo['estado'], ProgressBarProps['variant']> = {
  activo: 'success',
  inactivo: 'danger',
  suspendido: 'warning',
  mantenimiento: 'accent',
};

const CONDUCTOR_VARIANT: Record<Conductor['estado'], ProgressBarProps['variant']> = {
  activo: 'success',
  inactivo: 'danger',
};

function contarPorEstado<E extends string>(rows: { estado: E }[]): [E, number][] {
  const counts = new Map<E, number>();
  for (const row of rows) {
    counts.set(row.estado, (counts.get(row.estado) ?? 0) + 1);
  }
  return [...counts.entries()];
}

/** RF-01..19 (KPIs reales) — reemplaza los datos de ejemplo de QUI-227: encontrado durante
 * el repaso de M1-M4 que esta página seguía en `demo-data.ts` aunque las 4 APIs que necesita
 * (sindicatos/socios/vehículos/conductores) ya son reales desde QUI-220..224. `admin_quivo`
 * ve el conteo real de sindicatos activos; `admin_sindicato`/`operador` no pueden llamar
 * `GET /v1/sindicatos` (QUI-220 es admin_quivo-only), así que esa tarjeta queda oculta para
 * ellos en vez de mostrar un 0 engañoso. */
export default function DashboardHomePage() {
  const { token, user } = useAuth();
  const [sindicatos, setSindicatos] = useState<Sindicato[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      user?.rol === 'admin_quivo' ? sindicatosApi.listar(token) : Promise.resolve<Sindicato[]>([]),
      sociosApi.listar(token),
      vehiculosApi.listar(token),
      conductoresApi.listar(token),
    ])
      .then(([s, so, v, c]) => {
        setSindicatos(s);
        setSocios(so);
        setVehiculos(v);
        setConductores(c);
      })
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, user?.rol]);

  const sindicatosActivos = sindicatos.filter((s) => s.estado === 'activo').length;
  const vehiculosSinAsignar = vehiculos.filter((v) => !v.socioId).length;
  const conductoresActivos = conductores.filter((c) => c.estado === 'activo').length;
  const sociosActivos = socios.filter((s) => s.estado === 'activo').length;

  const flotaPorEstado = useMemo(() => contarPorEstado(vehiculos), [vehiculos]);
  const conductoresPorEstado = useMemo(() => contarPorEstado(conductores), [conductores]);

  if (loading) {
    return <Loader label="Cargando panel..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <Alert variant="danger" title="Error">{error}</Alert>}
      <Grid columns={user?.rol === 'admin_quivo' ? 4 : 3} gap="md">
        {user?.rol === 'admin_quivo' && (
          <KpiCard label="Sindicatos activos" value={sindicatosActivos} tone="primary" />
        )}
        <KpiCard
          label="Vehículos registrados"
          value={vehiculos.length}
          delta={`${vehiculosSinAsignar} sin socio asignado`}
          tone="accent"
        />
        <KpiCard
          label="Conductores activos"
          value={conductoresActivos}
          delta={`de ${conductores.length} registrados`}
          tone="success"
        />
        <KpiCard
          label="Socios activos"
          value={sociosActivos}
          delta={`de ${socios.length} registrados`}
          tone="neutral"
        />
      </Grid>
      <Grid columns={2} gap="md">
        <ChartCard title="Flota por estado" subtitle={`${vehiculos.length} vehículos registrados`}>
          {flotaPorEstado.length === 0 ? (
            <span>Sin vehículos todavía.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {flotaPorEstado.map(([estado, count]) => (
                <ProgressBar
                  key={estado}
                  label={`${estado} (${count})`}
                  value={count}
                  max={vehiculos.length}
                  variant={VEHICULO_VARIANT[estado]}
                  showValue
                />
              ))}
            </div>
          )}
        </ChartCard>
        <ChartCard title="Conductores por estado" subtitle={`${conductores.length} conductores registrados`}>
          {conductoresPorEstado.length === 0 ? (
            <span>Sin conductores todavía.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {conductoresPorEstado.map(([estado, count]) => (
                <ProgressBar
                  key={estado}
                  label={`${estado} (${count})`}
                  value={count}
                  max={conductores.length}
                  variant={CONDUCTOR_VARIANT[estado]}
                  showValue
                />
              ))}
            </div>
          )}
        </ChartCard>
      </Grid>
      <DataPanel title="Bienvenido a QUIVO Control" description="Panel administrativo con datos reales.">
        <p>Usá el menú lateral para navegar entre los módulos habilitados para tu rol.</p>
      </DataPanel>
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
