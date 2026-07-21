import { describe, expect, it } from 'vitest';
import { filterNavItemsByRole, NAV_ITEMS } from './nav-items.js';

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
