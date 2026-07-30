'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { SINDICATOS, SOCIOS, type SocioDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre completo', kind: 'text', required: true },
  { key: 'documento', label: 'Documento', kind: 'text', required: true },
  {
    key: 'sindicato',
    label: 'Sindicato',
    kind: 'select',
    options: SINDICATOS.map((s) => ({ label: s.nombre, value: s.nombre })),
    required: true,
  },
  { key: 'fechaAlta', label: 'Fecha de alta', kind: 'text' },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'active' },
      { label: 'Sin asignar', value: 'idle' },
      { label: 'Inactivo', value: 'inactive' },
    ],
  },
];

export default function SociosPage() {
  return (
    <ModuleTablePage<SocioDemo>
      title="Socios"
      subtitle="Datos de ejemplo — el CRUD real llega con QUI-221 (M1)."
      entityLabel="socio"
      searchPlaceholder="Buscar socio..."
      searchKeys={['nombre', 'documento', 'sindicato']}
      initialRows={SOCIOS}
      fields={FIELDS}
      createDefaults={{ estado: 'pending', fechaAlta: new Date().toISOString().slice(0, 10) }}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'documento', header: 'Documento' },
        { key: 'sindicato', header: 'Sindicato' },
        { key: 'fechaAlta', header: 'Alta' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
