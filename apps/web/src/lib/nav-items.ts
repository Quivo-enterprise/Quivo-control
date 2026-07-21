/**
 * Ítems de navegación del panel admin, agrupados por área de producto (no 1:1 con los
 * módulos internos de apps/api/src/modules). `roles` define quién ve cada ítem —
 * `admin_sindicato` no ve "Sindicatos" (RNF-16, doc técnico §5: un sindicato no gestiona
 * otros sindicatos).
 */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  roles: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/', roles: ['admin_quivo', 'admin_sindicato'] },
  { id: 'sindicatos', label: 'Sindicatos', href: '/sindicatos', roles: ['admin_quivo'] },
  { id: 'socios', label: 'Socios', href: '/socios', roles: ['admin_quivo', 'admin_sindicato'] },
  {
    id: 'vehiculos',
    label: 'Vehículos',
    href: '/vehiculos',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
  {
    id: 'conductores',
    label: 'Conductores',
    href: '/conductores',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
  { id: 'lineas', label: 'Líneas', href: '/lineas', roles: ['admin_quivo', 'admin_sindicato'] },
  { id: 'rutas', label: 'Rutas', href: '/rutas', roles: ['admin_quivo', 'admin_sindicato'] },
  {
    id: 'rotaciones',
    label: 'Rotaciones',
    href: '/rotaciones',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
  {
    id: 'reglas',
    label: 'Reglas y sanciones',
    href: '/reglas',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
  {
    id: 'reportes',
    label: 'Reportes',
    href: '/reportes',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
  {
    id: 'auditoria',
    label: 'Auditoría',
    href: '/auditoria',
    roles: ['admin_quivo', 'admin_sindicato'],
  },
];

export function filterNavItemsByRole(items: NavItem[], rol: string): NavItem[] {
  return items.filter((item) => item.roles.includes(rol));
}
