'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import {
  DocumentoIdentidadBoliviaSchema,
  NombrePersonaSchema,
  normalizarDocumentoIdentidadBolivia,
  normalizarNombrePersona,
  type Socio,
} from '@quivo/shared';
import {
  ModuleTablePage,
  type EntityFieldConfig,
  type ModuleDataSource,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { sociosApi } from '../../../src/lib/api/socios';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

export default function SociosPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      {
        key: 'nombre',
        label: 'Nombre completo',
        kind: 'text',
        required: true,
        maxLength: 200,
        autoComplete: 'name',
        placeholder: 'Ej.: María Quispe Mamani',
        normalize: normalizarNombrePersona,
        validate: (value) => {
          const result = NombrePersonaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
      {
        key: 'documentoIdentidad',
        label: 'CI boliviano',
        kind: 'text',
        required: true,
        maxLength: 29,
        inputMode: 'text',
        autoComplete: 'off',
        placeholder: 'Ej.: 1234567-1A LP',
        helperText:
          'Número de CI, complemento y expedición si corresponden. Códigos: LP, CB, SC, OR, PT, TJ, CH, BE o PD.',
        normalize: normalizarDocumentoIdentidadBolivia,
        validate: (value) => {
          const result = DocumentoIdentidadBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
    ];
    // admin_sindicato/operador quedan forzados a su propio tenant en el service (ver
    // apps/api) — no tiene sentido mostrarles un selector que la API va a ignorar.
    if (user?.rol === 'admin_quivo') {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        kind: 'select',
        options: sindicatoOptions,
        required: true,
      });
    }
    base.push({
      key: 'estado',
      label: 'Estado',
      kind: 'select',
      required: true,
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Socio>>(
    () => ({
      list: () => sociosApi.listar(token ?? ''),
      create: (values) => sociosApi.crear(token ?? '', values as never),
      update: (id, values) => sociosApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Socio>
      title="Socios"
      subtitle="RF-05..09."
      entityLabel="socio"
      searchPlaceholder="Buscar socio..."
      searchKeys={['nombre', 'documentoIdentidad']}
      fields={fields}
      createDefaults={{ estado: 'activo', sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'documentoIdentidad', header: 'CI' },
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
