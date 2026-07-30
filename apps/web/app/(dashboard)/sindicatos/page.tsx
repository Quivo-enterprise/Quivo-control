'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { SINDICATOS, type SindicatoDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
  { key: 'ciudad', label: 'Ciudad', kind: 'text', required: true },
  { key: 'socios', label: 'Socios', kind: 'number' },
  { key: 'vehiculos', label: 'Vehículos', kind: 'number' },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'active' },
      { label: 'Pendiente', value: 'pending' },
      { label: 'Inactivo', value: 'inactive' },
    ],
  },
];

export default function SindicatosPage() {
  return (
    <ModuleTablePage<SindicatoDemo>
      title="Sindicatos"
      subtitle="Datos de ejemplo — el CRUD real llega con QUI-220 (M1)."
      entityLabel="sindicato"
      searchPlaceholder="Buscar sindicato..."
      searchKeys={['nombre', 'ciudad']}
      initialRows={SINDICATOS}
      fields={FIELDS}
      createDefaults={{ estado: 'pending', socios: 0, vehiculos: 0 }}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'ciudad', header: 'Ciudad' },
        { key: 'socios', header: 'Socios', align: 'right' },
        { key: 'vehiculos', header: 'Vehículos', align: 'right' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
