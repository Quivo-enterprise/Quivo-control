import { describe, expect, it } from 'vitest';
import {
  filterNavItemsByRole,
  findNavItemForPath,
  isRouteAllowedForRole,
  NAV_ITEMS,
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
