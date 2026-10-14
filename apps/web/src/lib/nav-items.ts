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
  section?: string;
  iconName?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Operación',
    iconName: 'LayoutDashboard',
  },
  {
    id: 'en-vivo',
    label: 'En vivo',
    href: '/en-vivo',
    // `operador` (el control): mapa en vivo + designar a Molinos; infracciones en solo lectura.
    roles: ['admin_quivo', 'admin_sindicato', 'operador'],
    section: 'Operación',
    iconName: 'Radio',
  },
  {
    id: 'sindicatos',
    label: 'Sindicatos',
    href: '/sindicatos',
    roles: ['admin_quivo'],
    section: 'Gestión',
    iconName: 'Building2',
  },
  {
    id: 'socios',
    label: 'Socios',
    href: '/socios',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Gestión',
    iconName: 'Users',
  },
  {
    id: 'vehiculos',
    label: 'Vehículos',
    href: '/vehiculos',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Gestión',
    iconName: 'Bus',
  },
  {
    id: 'conductores',
    label: 'Conductores',
    href: '/conductores',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Gestión',
    iconName: 'UserCheck',
  },
  {
    id: 'lineas',
    label: 'Líneas',
    href: '/lineas',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Planificación',
    iconName: 'GitBranch',
  },
  {
    id: 'rutas',
    label: 'Rutas',
    href: '/rutas',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Planificación',
    iconName: 'MapPin',
  },
  {
    id: 'rotaciones',
    label: 'Rotaciones',
    href: '/rotaciones',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Planificación',
    iconName: 'RotateCw',
  },
  {
    id: 'reglas',
    label: 'Reglas y sanciones',
    href: '/reglas',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Control y Auditoría',
    iconName: 'Scale',
  },
  {
    id: 'reportes',
    label: 'Reportes',
    href: '/reportes',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Control y Auditoría',
    iconName: 'FileBarChart',
  },
  {
    id: 'auditoria',
    label: 'Auditoría',
    href: '/auditoria',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Control y Auditoría',
    iconName: 'ShieldAlert',
  },
  {
    id: 'sync-errores',
    label: 'Errores de sync',
    href: '/sync-errores',
    roles: ['admin_quivo', 'admin_sindicato'],
    section: 'Control y Auditoría',
    iconName: 'AlertTriangle',
  },
  {
    id: 'usuarios',
    label: 'Usuarios',
    href: '/usuarios',
    roles: ['admin_quivo'],
    section: 'Configuración',
    iconName: 'UserCog',
  },
];

export function filterNavItemsByRole(items: NavItem[], rol: string): NavItem[] {
  return items.filter((item) => item.roles.includes(rol));
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export function groupNavItemsBySection(items: NavItem[]): NavSection[] {
  const sectionsMap = new Map<string, NavItem[]>();

  for (const item of items) {
    const sec = item.section || '';
    if (!sectionsMap.has(sec)) {
      sectionsMap.set(sec, []);
    }
    sectionsMap.get(sec)!.push(item);
  }

  return Array.from(sectionsMap.entries()).map(([title, sectionItems]) => ({
    title: title || undefined,
    items: sectionItems,
  }));
}

/**
 * Ítem cuyo `href` es la ruta actual o un ancestro de ella (ej. `/vehiculos/123` matchea
 * `/vehiculos`). Usado por el guard de rutas — no filtra por rol, solo ubica el ítem.
 */
export function findNavItemForPath(items: NavItem[], pathname: string): NavItem | undefined {
  return items.find(
    (item) => item.href === pathname || (item.href !== '/' && pathname.startsWith(`${item.href}/`)),
  );
}

/**
 * `true` si no hay ítem de navegación para la ruta (aún no existe en M1+, no se bloquea
 * acá) o si el rol está en la lista de roles del ítem encontrado.
 */
export function isRouteAllowedForRole(items: NavItem[], pathname: string, rol: string): boolean {
  const item = findNavItemForPath(items, pathname);
  return !item || item.roles.includes(rol);
}

/**
 * Primera ruta a la que el rol puede entrar (el orden de `items` es el del menú): a donde se
 * manda a quien cae en una ruta que no le corresponde. El `operador` no tiene dashboard (`/`):
 * su casa es `/en-vivo`. Sin ninguna ruta permitida devuelve `/` (comportamiento previo).
 */
export function rutaInicialParaRol(items: NavItem[], rol: string): string {
  return items.find((item) => item.roles.includes(rol))?.href ?? '/';
}
