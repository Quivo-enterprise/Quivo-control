import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from './roles.decorator.js';
import { SindicatosController } from '../../modules/sindicatos/sindicatos.controller.js';
import { SociosController } from '../../modules/socios/socios.controller.js';
import { VehiculosController } from '../../modules/vehiculos/vehiculos.controller.js';
import { ConductoresController } from '../../modules/conductores/conductores.controller.js';
import { LineasController } from '../../modules/lineas/lineas.controller.js';
import { LineaRutasController, RutasController } from '../../modules/rutas/rutas.controller.js';
import { RutaVariantesController, VariantesController } from '../../modules/rutas/variantes.controller.js';
import { RutaParadasController, ParadasController } from '../../modules/rutas/paradas.controller.js';
import {
  RutaControlPointsController,
  ControlPointsController,
} from '../../modules/control-points/control-points.controller.js';
import { ReglasController } from '../../modules/reglas/reglas.controller.js';
import { SancionesController } from '../../modules/reglas/sanciones.controller.js';
import { RotacionesController } from '../../modules/rotaciones/rotaciones.controller.js';
import { AuditoriaController } from '../../modules/auditoria/auditoria.controller.js';

const ADMIN_QUIVO_ONLY = ['admin_quivo'];
const CRUD_NUCLEO = ['admin_quivo', 'admin_sindicato', 'operador'];
const PLANIFICACION = ['admin_quivo', 'admin_sindicato'];

/**
 * QUI-251 — hasta ahora la matriz de roles por controller (quién puede tocar qué) solo se
 * había verificado a mano con curl (documentado en docs/handoff.md, QUI-220..226) — nunca
 * quedó como test automático, así que un cambio accidental en un `@Roles(...)` (ej. alguien
 * agrega `operador` a `SindicatosController` sin querer) pasaría lint/typecheck sin que
 * nada lo note. Este test lee la metadata REAL que `@Roles` graba en cada controller (no un
 * mock) — si la matriz documentada cambia, este test es el que tiene que romper primero.
 */
describe('Matriz de roles por controller (QUI-251)', () => {
  const casos: [string, unknown, string[]][] = [
    ['SindicatosController', SindicatosController, ADMIN_QUIVO_ONLY],
    ['SociosController', SociosController, CRUD_NUCLEO],
    ['VehiculosController', VehiculosController, CRUD_NUCLEO],
    ['ConductoresController', ConductoresController, CRUD_NUCLEO],
    ['LineasController', LineasController, CRUD_NUCLEO],
    ['LineaRutasController', LineaRutasController, CRUD_NUCLEO],
    ['RutasController', RutasController, CRUD_NUCLEO],
    ['RutaVariantesController', RutaVariantesController, CRUD_NUCLEO],
    ['VariantesController', VariantesController, CRUD_NUCLEO],
    ['RutaParadasController', RutaParadasController, CRUD_NUCLEO],
    ['ParadasController', ParadasController, CRUD_NUCLEO],
    ['RutaControlPointsController', RutaControlPointsController, CRUD_NUCLEO],
    ['ControlPointsController', ControlPointsController, CRUD_NUCLEO],
    ['ReglasController', ReglasController, PLANIFICACION],
    ['SancionesController', SancionesController, PLANIFICACION],
    ['RotacionesController', RotacionesController, PLANIFICACION],
    ['AuditoriaController', AuditoriaController, PLANIFICACION],
  ];

  it.each(casos)('%s exige exactamente %j', (_nombre, controller, rolesEsperados) => {
    const rolesReales = Reflect.getMetadata(ROLES_KEY, controller as object) as string[] | undefined;
    expect(rolesReales).toBeDefined();
    expect([...(rolesReales ?? [])].sort()).toEqual([...rolesEsperados].sort());
  });

  it('admin_quivo nunca queda afuera de ningún controller (es el super-admin)', () => {
    for (const [, controller] of casos) {
      const roles = Reflect.getMetadata(ROLES_KEY, controller as object) as string[] | undefined;
      expect(roles).toContain('admin_quivo');
    }
  });
});
