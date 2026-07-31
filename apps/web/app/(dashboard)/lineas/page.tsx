'use client';

import { useMemo } from 'react';
import type { Linea } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { lineasApi } from '../../../src/lib/api/lineas';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

export default function LineasPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'codigo', label: 'Código', kind: 'text', required: true },
      { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
      { key: 'color', label: 'Color (hex, opcional)', kind: 'text' },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({ key: 'sindicatoId', label: 'Sindicato', kind: 'select', options: sindicatoOptions, required: true });
    }
    return base;
  }, [user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Linea>>(
    () => ({
      list: () => lineasApi.listar(token ?? ''),
      create: (values) => lineasApi.crear(token ?? '', values as never),
      update: (id, values) => lineasApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Linea>
      title="Líneas"
      subtitle="RF-20..23."
      entityLabel="línea"
      searchPlaceholder="Buscar línea..."
      searchKeys={['codigo', 'nombre']}
      fields={fields}
      createDefaults={{ sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        { key: 'codigo', header: 'Código' },
        { key: 'nombre', header: 'Nombre' },
        {
          key: 'sindicatoId',
          header: 'Sindicato',
          render: (row) => nombrePorId[row.sindicatoId] ?? row.sindicatoId,
        },
      ]}
    />
  );
}
