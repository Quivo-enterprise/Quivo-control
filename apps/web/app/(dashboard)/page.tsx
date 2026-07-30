import { DataPanel, Grid, KpiCard } from '@quivo/design-system';
import {
  CONDUCTORES,
  SINDICATOS,
  SOCIOS,
  VEHICULOS,
} from '../../src/lib/demo-data';

export default function DashboardHomePage() {
  const sindicatosActivos = SINDICATOS.filter((s) => s.estado === 'active').length;
  const vehiculosSinAsignar = VEHICULOS.filter((v) => v.estado === 'idle').length;
  const conductoresActivos = CONDUCTORES.filter((c) => c.estado === 'active').length;
  const sociosActivos = SOCIOS.filter((s) => s.estado === 'active').length;

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
      <DataPanel
        title="Bienvenido a QUIVO Control"
        description="Los datos reales llegan con QUI-220 en adelante (M1) — esta es una vista de ejemplo del panel administrativo."
      >
        <p>Usá el menú lateral para navegar entre los módulos habilitados para tu rol.</p>
      </DataPanel>
    </div>
  );
}
