'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import type { Sindicato } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { sindicatosApi } from '../../../src/lib/api/sindicatos';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'activo' },
      { label: 'Inactivo', value: 'inactivo' },
    ],
  },
];

export default function SindicatosPage() {
  const { token } = useAuth();

  const dataSource = useMemo<ModuleDataSource<Sindicato>>(
    () => ({
      list: () => sindicatosApi.listar(token ?? ''),
      create: (values) => sindicatosApi.crear(token ?? '', values as never),
      update: (id, values) => sindicatosApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Sindicato>
      title="Sindicatos"
      subtitle="Solo administrador QUIVO — RF-01..04."
      entityLabel="sindicato"
      searchPlaceholder="Buscar sindicato..."
      searchKeys={['nombre']}
      fields={FIELDS}
      createDefaults={{ estado: 'activo' }}
      dataSource={dataSource}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado === 'activo' ? 'active' : 'inactive'} />,
        },
      ]}
    />
  );
}
