import { describe, expect, it } from 'vitest';
import {
  filterNavItemsByRole,
  findNavItemForPath,
  isRouteAllowedForRole,
  NAV_ITEMS,
  rutaInicialParaRol,
} from './nav-items.js';

describe('filterNavItemsByRole', () => {
  it('admin_quivo ve todos los ítems, incluyendo Sindicatos', () => {
    const items = filterNavItemsByRole(NAV_ITEMS, 'admin_quivo');
    expect(items.some((i) => i.id === 'sindicatos')).toBe(true);
    expect(items).toHaveLength(NAV_ITEMS.length);
  });

  it('admin_sindicato no ve Sindicatos (RNF-16)', () => {
    const items = filterNavItemsByRole(NAV_ITEMS, 'admin_sindicato');
    expect(items.some((i) => i.id === 'sindicatos')).toBe(false);
    expect(items.some((i) => i.id === 'vehiculos')).toBe(true);
  });

  it('un rol desconocido no ve ningún ítem', () => {
    const items = filterNavItemsByRole(NAV_ITEMS, 'rol_inexistente');
    expect(items).toHaveLength(0);
  });
});

describe('NAV_ITEMS (orden y permisos de "En vivo")', () => {
  it('"En vivo" es el segundo ítem, después del dashboard', () => {
    expect(NAV_ITEMS[1]?.id).toBe('en-vivo');
    expect(NAV_ITEMS[1]?.href).toBe('/en-vivo');
  });

  it('los dos roles administrativos ven "En vivo"', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/en-vivo', 'admin_quivo')).toBe(true);
    expect(isRouteAllowedForRole(NAV_ITEMS, '/en-vivo', 'admin_sindicato')).toBe(true);
  });

  it('el operador (control) entra a /en-vivo pero no al dashboard ni a gestión', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/en-vivo', 'operador')).toBe(true);
    expect(isRouteAllowedForRole(NAV_ITEMS, '/', 'operador')).toBe(false);
    expect(isRouteAllowedForRole(NAV_ITEMS, '/vehiculos', 'operador')).toBe(false);
    expect(isRouteAllowedForRole(NAV_ITEMS, '/usuarios', 'operador')).toBe(false);
  });

  it('un rol fuera de la lista no puede entrar a /en-vivo', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/en-vivo', 'conductor')).toBe(false);
  });
});

describe('findNavItemForPath', () => {
  it('matchea la ruta exacta', () => {
    expect(findNavItemForPath(NAV_ITEMS, '/sindicatos')?.id).toBe('sindicatos');
  });

  it('matchea sub-rutas (ej. detalle de un recurso)', () => {
    expect(findNavItemForPath(NAV_ITEMS, '/vehiculos/123')?.id).toBe('vehiculos');
  });

  it('no matchea rutas sin ítem asociado', () => {
    expect(findNavItemForPath(NAV_ITEMS, '/no-existe')).toBeUndefined();
  });
});

describe('isRouteAllowedForRole (guard por rol en rutas)', () => {
  it('admin_quivo puede entrar a /sindicatos', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/sindicatos', 'admin_quivo')).toBe(true);
  });

  it('admin_sindicato NO puede entrar a /sindicatos', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/sindicatos', 'admin_sindicato')).toBe(false);
  });

  it('admin_sindicato sí puede entrar a su propio tenant (ej. /vehiculos)', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/vehiculos', 'admin_sindicato')).toBe(true);
  });

  it('rutas sin ítem de navegación (aún no existen) no se bloquean', () => {
    expect(isRouteAllowedForRole(NAV_ITEMS, '/algo-futuro', 'admin_sindicato')).toBe(true);
  });
});

describe('rutaInicialParaRol', () => {
  it('admins arrancan en el dashboard; el operador en /en-vivo', () => {
    expect(rutaInicialParaRol(NAV_ITEMS, 'admin_quivo')).toBe('/');
    expect(rutaInicialParaRol(NAV_ITEMS, 'admin_sindicato')).toBe('/');
    expect(rutaInicialParaRol(NAV_ITEMS, 'operador')).toBe('/en-vivo');
  });
  it('un rol sin rutas cae en /', () => {
    expect(rutaInicialParaRol(NAV_ITEMS, 'conductor')).toBe('/');
  });
});

describe('NAV_ITEMS ("Salidas")', () => {
  it('va justo después de "En vivo", en la misma sección', () => {
    expect(NAV_ITEMS[2]?.id).toBe('salidas');
    expect(NAV_ITEMS[2]?.section).toBe(NAV_ITEMS[1]?.section);
  });

  it('los tres roles operativos entran a /salidas; un rol desconocido no', () => {
    for (const rol of ['admin_quivo', 'admin_sindicato', 'operador']) {
      expect(isRouteAllowedForRole(NAV_ITEMS, '/salidas', rol)).toBe(true);
    }
    expect(isRouteAllowedForRole(NAV_ITEMS, '/salidas', 'conductor')).toBe(false);
  });
});
