'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import { CreditCard, User } from 'lucide-react';
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
  type TableFilterConfig,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { sociosApi } from '../../../src/lib/api/socios';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { SocioPreviewCard } from './socio-preview';

export default function SociosPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

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
        label: 'Cédula de Identidad (CI)',
        kind: 'text',
        required: true,
        maxLength: 29,
        inputMode: 'text',
        autoComplete: 'off',
        placeholder: 'Ej.: 1234567-1A LP',
        helperText:
          'Número de CI, complemento y expedición si corresponden. Códigos válidos: LP, CB, SC, OR, PT, TJ, CH, BE o PD.',
        normalize: normalizarDocumentoIdentidadBolivia,
        validate: (value) => {
          const result = DocumentoIdentidadBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato perteneciente',
        kind: 'select',
        options: sindicatoOptions,
        required: true,
      });
    }
    base.push({
      key: 'estado',
      label: 'Estado de Habilitación',
      kind: 'select',
      required: true,
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions]);

  const filters = useMemo<TableFilterConfig<Socio>[]>(() => {
    const list: TableFilterConfig<Socio>[] = [];
    if (user?.rol === 'admin_quivo' && sindicatoOptions.length > 0) {
      list.push({
        key: 'sindicatoId',
        label: 'Sindicato',
        placeholder: 'Todos los sindicatos',
        options: sindicatoOptions,
      });
    }
    list.push({
      key: 'estado',
      label: 'Estado',
      placeholder: 'Todos los estados',
      options: [
        { label: 'Activos', value: 'activo' },
        { label: 'Inactivos', value: 'inactivo' },
      ],
    });
    return list;
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
      title="Padrón de Socios"
      subtitle="Registro y control de socios propietarios afiliados a los sindicatos de transporte."
      entityLabel="socio"
      searchPlaceholder="Buscar socio por nombre o documento de identidad..."
      searchKeys={['nombre', 'documentoIdentidad']}
      filters={filters}
      fields={fields}
      formPresentation="inline"
      renderFormPreview={(values) => (
        <SocioPreviewCard values={values} sindicatoOptions={sindicatoOptions} />
      )}
      createDefaults={{ estado: 'activo', sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        {
          key: 'nombre',
          header: 'Socio Propietario',
          render: (row) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--qv-radius-full)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-success) 14%, var(--qv-surface-card))',
                  color: 'var(--qv-color-success)',
                  flexShrink: 0,
                }}
              >
                <User size={15} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ color: 'var(--qv-text-primary)', fontSize: '0.875rem' }}>
                  {row.nombre}
                </strong>
              </div>
            </div>
          ),
        },
        {
          key: 'documentoIdentidad',
          header: 'Documento (CI)',
          render: (row) => (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <CreditCard size={13} style={{ color: 'var(--qv-text-muted)' }} />
              <span
                style={{
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  color: 'var(--qv-text-primary)',
                  padding: '0.15rem 0.45rem',
                  borderRadius: 'var(--qv-radius-sm)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 80%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                {row.documentoIdentidad}
              </span>
            </div>
          ),
        },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => (
            <StatusBadge
              circle
              status={row.estado === 'activo' ? 'active' : 'inactive'}
              label={`Estado: ${row.estado === 'activo' ? 'Activo' : 'Inactivo'}`}
            />
          ),
        },
      ]}
    />
  );
}
