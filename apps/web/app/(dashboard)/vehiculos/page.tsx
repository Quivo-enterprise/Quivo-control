'use client';

import { useMemo } from 'react';
import { PlateBadge, StatusBadge } from '@quivo/design-system';
import type { StatusBadgeStatus } from '@quivo/design-system';
import type { Vehiculo } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

const ESTADO_BADGE: Record<Vehiculo['estado'], StatusBadgeStatus> = {
  activo: 'active',
  inactivo: 'inactive',
  suspendido: 'warning',
  mantenimiento: 'idle',
};

export default function VehiculosPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'placa', label: 'Placa', kind: 'text', required: true },
      { key: 'tipo', label: 'Tipo', kind: 'text', required: true },
      { key: 'marca', label: 'Marca', kind: 'text', required: true },
      { key: 'modelo', label: 'Modelo', kind: 'text', required: true },
      { key: 'color', label: 'Color', kind: 'text', required: true },
      { key: 'capacidad', label: 'Capacidad', kind: 'number', required: true },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({ key: 'sindicatoId', label: 'Sindicato', kind: 'select', options: sindicatoOptions, required: true });
    }
    base.push({
      key: 'estado',
      label: 'Estado',
      kind: 'select',
      // Transiciones válidas (activo <-> cualquiera; el resto solo vuelve a activo) las
      // valida apps/api — acá el select no las restringe, un intento inválido devuelve 400.
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
        { label: 'Suspendido', value: 'suspendido' },
        { label: 'Mantenimiento', value: 'mantenimiento' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions]);

  const dataSource = useMemo<ModuleDataSource<Vehiculo>>(
    () => ({
      list: () => vehiculosApi.listar(token ?? ''),
      create: (values) => vehiculosApi.crear(token ?? '', { ...values, socioId: null } as never),
      update: (id, values) => vehiculosApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Vehiculo>
      title="Vehículos"
      subtitle="RF-10..14."
      entityLabel="vehículo"
      searchPlaceholder="Buscar por placa..."
      searchKeys={['placa', 'marca', 'modelo']}
      fields={fields}
      createDefaults={{ estado: 'activo', capacidad: 1, sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        { key: 'placa', header: 'Placa', render: (row) => <PlateBadge plate={row.placa} /> },
        { key: 'marca', header: 'Marca / modelo', render: (row) => `${row.marca} ${row.modelo}` },
        {
          key: 'sindicatoId',
          header: 'Sindicato',
          render: (row) => nombrePorId[row.sindicatoId] ?? row.sindicatoId,
        },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={ESTADO_BADGE[row.estado]} />,
        },
      ]}
    />
  );
}
