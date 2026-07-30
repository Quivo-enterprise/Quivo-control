'use client';

import { Badge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { REGLAS, type ReglaDemo } from '../../../src/lib/demo-data';

type BadgeVariant = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

const SEVERIDAD_VARIANT: Record<ReglaDemo['severidad'], BadgeVariant> = {
  Leve: 'neutral',
  Grave: 'warning',
  'Muy grave': 'danger',
};

const FIELDS: EntityFieldConfig[] = [
  { key: 'codigo', label: 'Código', kind: 'text', required: true },
  { key: 'descripcion', label: 'Descripción', kind: 'text', required: true },
  {
    key: 'aplicaA',
    label: 'Aplica a',
    kind: 'select',
    options: [
      { label: 'Conductores', value: 'Conductores' },
      { label: 'Vehículos', value: 'Vehículos' },
    ],
    required: true,
  },
  {
    key: 'severidad',
    label: 'Severidad',
    kind: 'select',
    options: [
      { label: 'Leve', value: 'Leve' },
      { label: 'Grave', value: 'Grave' },
      { label: 'Muy grave', value: 'Muy grave' },
    ],
    required: true,
  },
];

export default function ReglasPage() {
  return (
    <ModuleTablePage<ReglaDemo>
      title="Reglas y sanciones"
      subtitle="Datos de ejemplo — el motor de reglas real llega en M4."
      entityLabel="regla"
      searchPlaceholder="Buscar regla..."
      searchKeys={['codigo', 'descripcion', 'aplicaA']}
      initialRows={REGLAS}
      fields={FIELDS}
      createDefaults={{ severidad: 'Leve', aplicaA: 'Conductores' }}
      columns={[
        { key: 'codigo', header: 'Código' },
        { key: 'descripcion', header: 'Descripción' },
        { key: 'aplicaA', header: 'Aplica a' },
        {
          key: 'severidad',
          header: 'Severidad',
          render: (row) => <Badge variant={SEVERIDAD_VARIANT[row.severidad]}>{row.severidad}</Badge>,
        },
      ]}
    />
  );
}
