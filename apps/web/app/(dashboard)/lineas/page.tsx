'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { LINEAS, SINDICATOS, type LineaDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'codigo', label: 'Código', kind: 'text', required: true },
  { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
  {
    key: 'sindicato',
    label: 'Sindicato',
    kind: 'select',
    options: SINDICATOS.map((s) => ({ label: s.nombre, value: s.nombre })),
    required: true,
  },
  { key: 'paradas', label: 'Paradas', kind: 'number' },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activa', value: 'active' },
      { label: 'Pendiente', value: 'pending' },
    ],
  },
];

export default function LineasPage() {
  return (
    <ModuleTablePage<LineaDemo>
      title="Líneas"
      subtitle="Datos de ejemplo — el CRUD real llega con QUI-224 (M1)."
      entityLabel="línea"
      searchPlaceholder="Buscar línea..."
      searchKeys={['codigo', 'nombre', 'sindicato']}
      initialRows={LINEAS}
      fields={FIELDS}
      createDefaults={{ estado: 'pending', paradas: 0 }}
      columns={[
        { key: 'codigo', header: 'Código' },
        { key: 'nombre', header: 'Nombre' },
        { key: 'sindicato', header: 'Sindicato' },
        { key: 'paradas', header: 'Paradas', align: 'right' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
