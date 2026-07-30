import type { ProgressBarProps, StatusBadgeStatus } from '@quivo/design-system';
import { ChartCard, DataPanel, Grid, KpiCard, ProgressBar } from '@quivo/design-system';
import {
  CONDUCTORES,
  SINDICATOS,
  SOCIOS,
  VEHICULOS,
} from '../../src/lib/demo-data';

const ESTADO_VARIANT: Record<StatusBadgeStatus, ProgressBarProps['variant']> = {
  active: 'success',
  warning: 'warning',
  idle: 'accent',
  pending: 'primary',
  inactive: 'danger',
  canceled: 'danger',
};

const ESTADO_LABEL: Record<StatusBadgeStatus, string> = {
  active: 'Activos',
  warning: 'En atención',
  idle: 'Sin asignar',
  pending: 'Pendientes',
  inactive: 'Inactivos',
  canceled: 'Cancelados',
};

/** Cuenta ocurrencias de `estado` y descarta los que no tienen ningún registro. */
function countByEstado<T extends { estado: StatusBadgeStatus }>(rows: T[]) {
  const counts = new Map<StatusBadgeStatus, number>();
  for (const row of rows) {
    counts.set(row.estado, (counts.get(row.estado) ?? 0) + 1);
  }
  return [...counts.entries()];
}

export default function DashboardHomePage() {
  const sindicatosActivos = SINDICATOS.filter((s) => s.estado === 'active').length;
  const vehiculosSinAsignar = VEHICULOS.filter((v) => v.estado === 'idle').length;
  const conductoresActivos = CONDUCTORES.filter((c) => c.estado === 'active').length;
  const sociosActivos = SOCIOS.filter((s) => s.estado === 'active').length;

  const flotaPorEstado = countByEstado(VEHICULOS);
  const maxSociosPorSindicato = Math.max(...SINDICATOS.map((s) => s.socios));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Grid columns={4} gap="md">
        <KpiCard label="Sindicatos activos" value={sindicatosActivos} tone="primary" />
        <KpiCard
          label="Vehículos registrados"
          value={VEHICULOS.length}
          delta={`${vehiculosSinAsignar} sin asignar`}
          tone="accent"
        />
        <KpiCard
          label="Conductores activos"
          value={conductoresActivos}
          delta={`de ${CONDUCTORES.length} registrados`}
          tone="success"
        />
        <KpiCard
          label="Socios activos"
          value={sociosActivos}
          delta={`de ${SOCIOS.length} registrados`}
          tone="neutral"
        />
      </Grid>
      <Grid columns={2} gap="md">
        <ChartCard title="Flota por estado" subtitle={`${VEHICULOS.length} vehículos registrados`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {flotaPorEstado.map(([estado, count]) => (
              <ProgressBar
                key={estado}
                label={`${ESTADO_LABEL[estado]} (${count})`}
                value={count}
                max={VEHICULOS.length}
                variant={ESTADO_VARIANT[estado]}
                showValue
              />
            ))}
          </div>
        </ChartCard>
        <ChartCard title="Socios por sindicato" subtitle="Relativo al sindicato con más socios">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {SINDICATOS.map((sindicato) => (
              <ProgressBar
                key={sindicato.id}
                label={`${sindicato.nombre} (${sindicato.socios})`}
                value={sindicato.socios}
                max={maxSociosPorSindicato}
                variant={ESTADO_VARIANT[sindicato.estado]}
                showValue
              />
            ))}
          </div>
        </ChartCard>
      </Grid>
      <DataPanel
        title="Bienvenido a QUIVO Control"
        description="Los datos reales llegan con QUI-220 en adelante (M1) — esta es una vista de ejemplo del panel administrativo."
      >
        <p>Usá el menú lateral para navegar entre los módulos habilitados para tu rol.</p>
      </DataPanel>
    </div>
  );
}
