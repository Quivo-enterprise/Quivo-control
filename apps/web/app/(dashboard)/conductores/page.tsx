'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '@quivo/design-system';
import { CreditCard, FileBadge, Phone, UserCheck } from 'lucide-react';
import {
  DocumentoIdentidadBoliviaSchema,
  LicenciaConducirBoliviaSchema,
  NombrePersonaSchema,
  TelefonoBoliviaSchema,
  formatearTelefonoBolivia,
  normalizarDocumentoIdentidadBolivia,
  normalizarLicenciaConducir,
  normalizarNombrePersona,
  normalizarTelefonoBolivia,
  type Conductor,
} from '@quivo/shared';
import {
  ModuleTablePage,
  type EntityFieldConfig,
  type ModuleDataSource,
  type TableFilterConfig,
} from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';
import { ConductorPreviewCard } from './conductor-preview';

export default function ConductoresPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();
  const queryClient = useQueryClient();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      {
        key: 'nombre',
        label: 'Nombre completo del Conductor',
        kind: 'text',
        required: true,
        maxLength: 200,
        autoComplete: 'name',
        placeholder: 'Ej.: Juan Carlos Mamani Flores',
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
        placeholder: 'Ej.: 5678910-1B LP',
        helperText:
          'Número de CI, complemento y expedición si corresponden. Códigos válidos: LP, CB, SC, OR, PT, TJ, CH, BE o PD.',
        normalize: normalizarDocumentoIdentidadBolivia,
        validate: (value) => {
          const result = DocumentoIdentidadBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
      {
        key: 'licenciaConducir',
        label: 'Número de Licencia de Conducir',
        kind: 'text',
        required: true,
        maxLength: 50,
        autoComplete: 'off',
        placeholder: 'Ej.: 5678910',
        helperText: 'Ingresa el número tal como figura en la licencia emitida por SEGIP.',
        normalize: normalizarLicenciaConducir,
        validate: (value) => {
          const result = LicenciaConducirBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
      {
        key: 'telefono',
        label: 'Teléfono (WhatsApp)',
        kind: 'text',
        inputType: 'tel',
        inputMode: 'tel',
        autoComplete: 'tel',
        maxLength: 20,
        placeholder: '7XXXXXXX o +591 7XXXXXXX',
        helperText: 'Opcional. Celular boliviano para contactar al conductor por WhatsApp o llamada.',
        normalize: (value) => normalizarTelefonoBolivia(value) ?? value,
        validate: (value) => {
          const result = TelefonoBoliviaSchema.safeParse(value);
          return result.success ? undefined : result.error.issues[0]?.message;
        },
      },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({
        key: 'sindicatoId',
        label: 'Sindicato asignado',
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

  const filters = useMemo<TableFilterConfig<Conductor>[]>(() => {
    const list: TableFilterConfig<Conductor>[] = [];
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

  const dataSource = useMemo<ModuleDataSource<Conductor>>(
    () => ({
      list: () => conductoresApi.listar(token ?? ''),
      // El contexto de /en-vivo se cachea con staleTime Infinity y trae el teléfono del
      // conductor: tras crear/editar hay que invalidarlo para que el panel no muestre uno viejo.
      create: async (values) => {
        const creado = await conductoresApi.crear(token ?? '', values as never);
        void queryClient.invalidateQueries({ queryKey: ['en-vivo', 'contexto'] });
        return creado;
      },
      update: async (id, values) => {
        const actualizado = await conductoresApi.actualizar(token ?? '', id, values as never);
        void queryClient.invalidateQueries({ queryKey: ['en-vivo', 'contexto'] });
        return actualizado;
      },
    }),
    [token, queryClient],
  );

  return (
    <ModuleTablePage<Conductor>
      title="Padrón de Conductores"
      subtitle="Registro, habilitación y control del personal conductor asignado a las unidades de transporte."
      entityLabel="conductor"
      searchPlaceholder="Buscar conductor por nombre, CI o licencia..."
      searchKeys={['nombre', 'documentoIdentidad', 'licenciaConducir']}
      filters={filters}
      fields={fields}
      formPresentation="inline"
      renderFormPreview={(values) => (
        <ConductorPreviewCard values={values} sindicatoOptions={sindicatoOptions} />
      )}
      createDefaults={{ estado: 'activo', sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        {
          key: 'nombre',
          header: 'Conductor',
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
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                  color: 'var(--qv-color-primary)',
                  flexShrink: 0,
                }}
              >
                <UserCheck size={15} />
              </span>
              <strong style={{ color: 'var(--qv-text-primary)', fontSize: '0.875rem' }}>
                {row.nombre}
              </strong>
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
          key: 'licenciaConducir',
          header: 'Licencia SEGIP',
          render: (row) => (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <FileBadge size={13} style={{ color: 'var(--qv-color-accent)' }} />
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
                {row.licenciaConducir}
              </span>
            </div>
          ),
        },
        {
          key: 'telefono',
          header: 'Teléfono',
          render: (row) =>
            row.telefono ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                <Phone size={13} style={{ color: 'var(--qv-text-muted)' }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>
                  {formatearTelefonoBolivia(row.telefono)}
                </span>
              </div>
            ) : (
              <span style={{ color: 'var(--qv-text-muted)' }}>—</span>
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
