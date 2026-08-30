'use client';

import { useMemo } from 'react';
import { StatusBadge } from '@quivo/design-system';
import { Building2 } from 'lucide-react';
import type { Sindicato } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { sindicatosApi } from '../../../src/lib/api/sindicatos';
import { SindicatoPreviewCard } from './sindicato-preview';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre del Sindicato', kind: 'text', required: true, placeholder: 'Ej. Sindicato 14 de Septiembre' },
  {
    key: 'estado',
    label: 'Estado de Operación',
    kind: 'select',
    options: [
      { label: 'Activo', value: 'activo' },
      { label: 'Inactivo', value: 'inactivo' },
    ],
  },
];

const FILTERS = [
  {
    key: 'estado' as const,
    label: 'Estado',
    placeholder: 'Todos los estados',
    options: [
      { label: 'Activos', value: 'activo' },
      { label: 'Inactivos', value: 'inactivo' },
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
      title="Sindicatos y Organizaciones"
      subtitle="Padrón centralizado de sindicatos y operadores de transporte urbano."
      entityLabel="sindicato"
      searchPlaceholder="Buscar sindicato por nombre..."
      searchKeys={['nombre']}
      filters={FILTERS}
      fields={FIELDS}
      formPresentation="inline"
      renderFormPreview={(values) => <SindicatoPreviewCard values={values} />}
      createDefaults={{ estado: 'activo' }}
      dataSource={dataSource}
      columns={[
        {
          key: 'nombre',
          header: 'Organización / Sindicato',
          render: (row) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--qv-radius-md)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                  color: 'var(--qv-color-primary)',
                  flexShrink: 0,
                }}
              >
                <Building2 size={16} />
              </span>
              <strong style={{ color: 'var(--qv-text-primary)', fontSize: '0.875rem' }}>
                {row.nombre}
              </strong>
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
