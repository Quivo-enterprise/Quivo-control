'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import {
  DocumentoIdentidadBoliviaSchema,
  LicenciaConducirBoliviaSchema,
  NombrePersonaSchema,
  normalizarDocumentoIdentidadBolivia,
  normalizarLicenciaConducir,
  normalizarNombrePersona,
  type Conductor,
} from '@quivo/shared';
import {
  ModuleTablePage,
  type EntityFieldConfig,
  type ModuleDataSource,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

export default function ConductoresPage() {
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
      {
        key: 'licenciaConducir',
        label: 'Número de licencia de conducir',
        kind: 'text',
        required: true,
        maxLength: 50,
        autoComplete: 'off',
        placeholder: 'Ej.: 1234567',
        helperText: 'Ingresa el número tal como figura en la licencia emitida por SEGIP.',
        normalize: normalizarLicenciaConducir,
        validate: (value) => {
          const result = LicenciaConducirBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
    ];
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
        { key: 'documentoIdentidad', header: 'CI' },
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
