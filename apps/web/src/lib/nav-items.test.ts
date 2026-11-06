import { describe, expect, it } from 'vitest';
import {
  filterNavItemsByRole,
  findNavItemForPath,
  isNavActive,
  isRouteAllowedForRole,
  itemsParaMas,
  masActivo,
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

describe('isNavActive', () => {
  it('"/" solo coincide exacto; un ancestro coincide, un prefijo parcial no', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/salidas', '/')).toBe(false);
    expect(isNavActive('/salidas/x', '/salidas')).toBe(true);
    expect(isNavActive('/salidas', '/sal')).toBe(false);
  });
});

describe('itemsParaMas (página Más del celular)', () => {
  it('admin_quivo: 12 ítems en orden de NAV_ITEMS, con Sindicatos, Errores de sync y Usuarios', () => {
    const ids = itemsParaMas('admin_quivo').map((i) => i.id);
    expect(ids).toEqual(['sindicatos', 'socios', 'vehiculos', 'conductores', 'lineas', 'rutas', 'rotaciones', 'reglas', 'reportes', 'auditoria', 'sync-errores', 'usuarios']);
  });

  it('admin_sindicato: 10 ítems, sin Sindicatos ni Usuarios', () => {
    const ids = itemsParaMas('admin_sindicato').map((i) => i.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain('sync-errores');
    expect(ids).not.toContain('sindicatos');
    expect(ids).not.toContain('usuarios');
  });

  it('operador y roles desconocidos: ninguno (En vivo y Salidas son pestañas)', () => {
    expect(itemsParaMas('operador')).toEqual([]);
    expect(itemsParaMas('rol_inexistente')).toEqual([]);
  });

  it('nunca repite una pestaña ni el Dashboard', () => {
    for (const rol of ['admin_quivo', 'admin_sindicato']) {
      const hrefs = itemsParaMas(rol).map((i) => i.href);
      for (const h of ['/', '/en-vivo', '/salidas', '/alertas']) expect(hrefs).not.toContain(h);
    }
  });

  it('/mas no es el aterrizaje de ningún rol', () => {
    for (const rol of ['admin_quivo', 'admin_sindicato', 'operador']) {
      expect(rutaInicialParaRol(NAV_ITEMS, rol)).not.toBe('/mas');
    }
  });
});

describe('masActivo', () => {
  it('activa en /mas y en rutas que no son pestañas', () => {
    expect(masActivo('/mas', 'admin_quivo')).toBe(true);
    expect(masActivo('/vehiculos', 'admin_quivo')).toBe(true);
    expect(masActivo('/vehiculos/123', 'admin_sindicato')).toBe(true);
  });

  it('inactiva en las pestañas visibles', () => {
    for (const p of ['/', '/en-vivo', '/salidas', '/alertas']) expect(masActivo(p, 'admin_quivo')).toBe(false);
    expect(masActivo('/salidas', 'operador')).toBe(false);
  });
});
