'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import type { Conductor } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

export default function ConductoresPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'nombre', label: 'Nombre completo', kind: 'text', required: true },
      { key: 'documentoIdentidad', label: 'Documento', kind: 'text', required: true },
      { key: 'licenciaConducir', label: 'Licencia de conducir', kind: 'text', required: true },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({ key: 'sindicatoId', label: 'Sindicato', kind: 'select', options: sindicatoOptions, required: true });
    }
    base.push({
      key: 'estado',
      label: 'Estado',
      kind: 'select',
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Conductor>>(
    () => ({
      list: () => conductoresApi.listar(token ?? ''),
      create: (values) => conductoresApi.crear(token ?? '', values as never),
      update: (id, values) => conductoresApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Conductor>
      title="Conductores"
      subtitle="RF-15..19."
      entityLabel="conductor"
      searchPlaceholder="Buscar conductor..."
      searchKeys={['nombre', 'documentoIdentidad']}
      fields={fields}
      createDefaults={{ estado: 'activo', sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'licenciaConducir', header: 'Licencia' },
        {
          key: 'sindicatoId',
          header: 'Sindicato',
          render: (row) => nombrePorId[row.sindicatoId] ?? row.sindicatoId,
        },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado === 'activo' ? 'active' : 'inactive'} />,
        },
      ]}
    />
  );
}
