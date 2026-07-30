'use client';

import { StatusBadge } from '@quivo/design-system';
import { ModuleTablePage, type EntityFieldConfig } from '../../../src/components/module-table-page';
import { LINEAS, RUTAS, type RutaDemo } from '../../../src/lib/demo-data';

const FIELDS: EntityFieldConfig[] = [
  { key: 'nombre', label: 'Nombre de la ruta', kind: 'text', required: true },
  {
    key: 'linea',
    label: 'Línea',
    kind: 'select',
    options: LINEAS.map((l) => ({ label: `${l.codigo} — ${l.nombre}`, value: l.codigo })),
    required: true,
  },
  { key: 'variante', label: 'Variante', kind: 'text' },
  { key: 'distanciaKm', label: 'Distancia (km)', kind: 'number' },
  {
    key: 'estado',
    label: 'Estado',
    kind: 'select',
    options: [
      { label: 'Activa', value: 'active' },
      { label: 'Sin asignar', value: 'idle' },
    ],
  },
];

export default function RutasPage() {
  return (
    <ModuleTablePage<RutaDemo>
      title="Rutas"
      subtitle="Datos de ejemplo — el editor sobre mapa (MapLibre) llega con QUI-229 (M1)."
      entityLabel="ruta"
      searchPlaceholder="Buscar ruta..."
      searchKeys={['nombre', 'linea']}
      initialRows={RUTAS}
      fields={FIELDS}
      createDefaults={{ estado: 'idle', distanciaKm: 0 }}
      columns={[
        { key: 'nombre', header: 'Ruta' },
        { key: 'linea', header: 'Línea' },
        { key: 'variante', header: 'Variante' },
        { key: 'distanciaKm', header: 'Distancia (km)', align: 'right' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={row.estado} />,
        },
      ]}
    />
  );
}
