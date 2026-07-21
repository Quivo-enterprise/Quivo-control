import { DataPanel, Grid, KpiCard } from '@quivo/design-system';

export default function DashboardHomePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Grid columns={3} gap="md">
        <KpiCard label="Sindicatos activos" value="2" tone="primary" />
        <KpiCard label="Vehículos registrados" value="—" tone="accent" />
        <KpiCard label="Conductores activos" value="—" tone="success" />
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
