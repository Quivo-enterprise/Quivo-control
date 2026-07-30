'use client';

import { PlateBadge, StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { SINDICATOS, VEHICULOS, type VehiculoDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'patente', label: 'Patente', kind: 'text', required: true },
  { key: 'marcaModelo', label: 'Marca / modelo', kind: 'text', required: true },
  {
    key: 'sindicato',
    label: 'Sindicato',
    kind: 'select',
    options: SINDICATOS.map((s) => ({ label: s.nombre, value: s.nombre })),
    required: true,
  },
  { key: 'conductor', label: 'Conductor asignado (opcional)', kind: 'text' },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'active' },
      { label: 'Sin asignar', value: 'idle' },
      { label: 'Atención', value: 'warning' },
    ],
  },
];

export default function VehiculosPage() {
  return (
    <ModuleTablePage<VehiculoDemo>
      title="Vehículos"
      subtitle="Datos de ejemplo — el CRUD real llega con QUI-222 (M1)."
      entityLabel="vehículo"
      searchPlaceholder="Buscar por patente o sindicato..."
      searchKeys={['patente', 'marcaModelo', 'sindicato']}
      initialRows={VEHICULOS}
      fields={FIELDS}
      createDefaults={{ estado: 'idle', conductor: null }}
      columns={[
        { key: 'patente', header: 'Patente', render: (row) => <PlateBadge plate={row.patente} /> },
        { key: 'marcaModelo', header: 'Marca / modelo' },
        { key: 'sindicato', header: 'Sindicato' },
        {
          key: 'conductor',
          header: 'Conductor asignado',
          render: (row) => row.conductor || '— sin asignar —',
        },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
