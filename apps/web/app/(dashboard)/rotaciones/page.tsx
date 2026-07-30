'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { ROTACIONES, type RotacionDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'conductor', label: 'Conductor', kind: 'text', required: true },
  { key: 'vehiculo', label: 'Vehículo (patente)', kind: 'text', required: true },
  { key: 'linea', label: 'Línea', kind: 'text', required: true },
  {
    key: 'turno',
    label: 'Turno',
    kind: 'select',
    options: [
      { label: 'Mañana', value: 'Mañana' },
      { label: 'Tarde', value: 'Tarde' },
      { label: 'Noche', value: 'Noche' },
    ],
    required: true,
  },
  { key: 'fecha', label: 'Fecha', kind: 'text', required: true },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Pendiente', value: 'pending' },
      { label: 'Activa', value: 'active' },
    ],
  },
];

export default function RotacionesPage() {
  return (
    <ModuleTablePage<RotacionDemo>
      title="Rotaciones"
      subtitle="Datos de ejemplo — crear/editar/publicar real llega con QUI-233 (M2)."
      entityLabel="turno"
      searchPlaceholder="Buscar por conductor o línea..."
      searchKeys={['conductor', 'vehiculo', 'linea']}
      initialRows={ROTACIONES}
      fields={FIELDS}
      createDefaults={{ estado: 'pending', turno: 'Mañana' }}
      columns={[
        { key: 'fecha', header: 'Fecha' },
        { key: 'turno', header: 'Turno' },
        { key: 'conductor', header: 'Conductor' },
        { key: 'vehiculo', header: 'Vehículo' },
        { key: 'linea', header: 'Línea' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
