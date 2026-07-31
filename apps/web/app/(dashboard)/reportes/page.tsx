'use client';

import { Button, DataTable, Grid, KpiCard, PageHeader } from '@quivo/design-system';

interface ReporteDisponible extends Record<string, unknown> {
  id: string;
  nombre: string;
  periodo: string;
  formato: string;
}

const REPORTES_DISPONIBLES: ReporteDisponible[] = [
  { id: 'rep-1', nombre: 'Cumplimiento de rotaciones', periodo: 'Semanal', formato: 'PDF' },
  { id: 'rep-2', nombre: 'Incidencias por línea', periodo: 'Mensual', formato: 'CSV' },
  { id: 'rep-3', nombre: 'Sanciones aplicadas', periodo: 'Mensual', formato: 'PDF' },
];

export default function ReportesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Reportes"
        subtitle="Datos de ejemplo — QUI-246 (dashboard de cumplimiento) y QUI-249 (reportes operativos) necesitan datos reales de tracking (gps_points/sesiones), bloqueados hasta que exista M3."
      />
      <Grid columns={3} gap="md">
        <KpiCard label="Cumplimiento de recorridos" value="—" tone="primary" />
        <KpiCard label="Incidencias abiertas" value="—" tone="accent" />
        <KpiCard label="Sanciones del mes" value="—" tone="danger" />
      </Grid>
      <DataTable<ReporteDisponible>
        columns={[
          { key: 'nombre', header: 'Reporte' },
          { key: 'periodo', header: 'Período' },
          { key: 'formato', header: 'Formato' },
        ]}
        rows={REPORTES_DISPONIBLES}
        actions={() => (
          <Button variant="ghost" size="sm" disabled>
            Generar (M3+M4)
          </Button>
        )}
      />
    </div>
  );
}
