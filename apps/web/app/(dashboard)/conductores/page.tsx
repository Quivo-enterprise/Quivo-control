'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { CONDUCTORES, SINDICATOS, type ConductorDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre completo', kind: 'text', required: true },
  { key: 'licencia', label: 'Licencia', kind: 'text', required: true },
  { key: 'licenciaVence', label: 'Licencia vence', kind: 'text' },
  {
    key: 'sindicato',
    label: 'Sindicato',
    kind: 'select',
    options: SINDICATOS.map((s) => ({ label: s.nombre, value: s.nombre })),
    required: true,
  },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'active' },
      { label: 'Atención', value: 'warning' },
      { label: 'Inactivo', value: 'inactive' },
    ],
  },
];

export default function ConductoresPage() {
  return (
    <ModuleTablePage<ConductorDemo>
      title="Conductores"
      subtitle="Datos de ejemplo — el CRUD real llega con QUI-223 (M1)."
      entityLabel="conductor"
      searchPlaceholder="Buscar conductor..."
      searchKeys={['nombre', 'sindicato']}
      initialRows={CONDUCTORES}
      fields={FIELDS}
      createDefaults={{ estado: 'active' }}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'licencia', header: 'Licencia' },
        { key: 'licenciaVence', header: 'Vence' },
        { key: 'sindicato', header: 'Sindicato' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
