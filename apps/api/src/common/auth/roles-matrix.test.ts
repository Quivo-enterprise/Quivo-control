import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import { AuthController } from '../../modules/auth/auth.controller.js';
import { JornadasController } from '../../modules/reportes/jornadas.controller.js';
import { SalidasPanelController } from '../../modules/salidas/salidas-panel.controller.js';
import { GruposVehiculoController } from '../../modules/salidas/grupos-vehiculo.controller.js';
import { SindicatosController } from '../../modules/sindicatos/sindicatos.controller.js';
import { SociosController } from '../../modules/socios/socios.controller.js';
import { VehiculosController } from '../../modules/vehiculos/vehiculos.controller.js';
import { ConductoresController } from '../../modules/conductores/conductores.controller.js';
import { LineasController } from '../../modules/lineas/lineas.controller.js';
import { LineaRutasController, RutasController } from '../../modules/rutas/rutas.controller.js';
import {
  RutaVariantesController,
  VariantesController,
} from '../../modules/rutas/variantes.controller.js';
import {
  RutaParadasController,
  ParadasController,
} from '../../modules/rutas/paradas.controller.js';
import {
  RutaControlPointsController,
  ControlPointsController,
} from '../../modules/control-points/control-points.controller.js';
import { ReglasController } from '../../modules/reglas/reglas.controller.js';
import { SancionesController } from '../../modules/reglas/sanciones.controller.js';
import { RotacionesController } from '../../modules/rotaciones/rotaciones.controller.js';
import { AuditoriaController } from '../../modules/auditoria/auditoria.controller.js';
import { CredencialesMovilesController } from '../../modules/auth-movil/credenciales-moviles.controller.js';
import { SyncErroresController } from '../../modules/sync/sync-errores.controller.js';
import { CumplimientoController } from '../../modules/reportes/cumplimiento.controller.js';
import { RecorridosController } from '../../modules/reportes/recorridos.controller.js';
import { ExportesController } from '../../modules/reportes/exportes.controller.js';
import { EnVivoController } from '../../modules/reportes/en-vivo.controller.js';
import { InfraccionesController } from '../../modules/infracciones/infracciones.controller.js';

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
    ['CredencialesMovilesController', CredencialesMovilesController, PLANIFICACION],
    ['SyncErroresController', SyncErroresController, PLANIFICACION],
    ['CumplimientoController', CumplimientoController, PLANIFICACION],
    ['RecorridosController', RecorridosController, PLANIFICACION],
    ['ExportesController', ExportesController, PLANIFICACION],
    // El control (`operador`) ve el mapa en vivo y designa a Molinos (F1), pero NO opera infracciones.
    // `delegado` (celular): el mapa en vivo entero y las acciones sobre infracciones.
    ['EnVivoController', EnVivoController, [...CRUD_NUCLEO, 'delegado']],
    ['InfraccionesController', InfraccionesController, [...PLANIFICACION, 'delegado']],
  ];

  it.each(casos)('%s exige exactamente %j', (_nombre, controller, rolesEsperados) => {
    const rolesReales = Reflect.getMetadata(ROLES_KEY, controller as object) as
      string[] | undefined;
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

/**
 * `delegado` (celular): solo Hoy, En vivo, Alertas y Salidas. Corre el `RolesGuard` real contra la
 * metadata real de cada handler (el `@Roles` de método pisa al de clase): lo que no está acá, no lo tiene.
 */
describe('Rol delegado: permitido solo en lo que usan sus cuatro pantallas', () => {
  const guard = new RolesGuard(new Reflector());
  const contexto = (controller: { prototype: object }, metodo: string, rol: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
      getHandler: () => (controller.prototype as Record<string, unknown>)[metodo],
      getClass: () => controller,
    }) as unknown as ExecutionContext;
  const permitido = (c: { prototype: object }, m: string, rol = 'delegado') => guard.canActivate(contexto(c, m, rol));

  it.each([
    ['LineasController', LineasController, 'listar'],
    ['LineaRutasController', LineaRutasController, 'listar'],
    ['RutaVariantesController', RutaVariantesController, 'listar'],
    ['RutaControlPointsController', RutaControlPointsController, 'listar'],
    ['VehiculosController', VehiculosController, 'listar'],
    ['ConductoresController', ConductoresController, 'listar'],
    ['ReglasController', ReglasController, 'listar'],
    ['SancionesController', SancionesController, 'listar'],
    ['JornadasController', JornadasController, 'listar'],
    ['EnVivoController', EnVivoController, 'listar'],
    ['EnVivoController', EnVivoController, 'designar'],
    ['InfraccionesController', InfraccionesController, 'actualizar'],
    ['InfraccionesController', InfraccionesController, 'sancionar'],
    ['SalidasPanelController', SalidasPanelController, 'fila'],
    ['SalidasPanelController', SalidasPanelController, 'despachar'],
    ['SalidasPanelController', SalidasPanelController, 'moverAlFinal'],
    ['SalidasPanelController', SalidasPanelController, 'retirar'],
    ['SalidasPanelController', SalidasPanelController, 'fijarBase'],
    ['SalidasPanelController', SalidasPanelController, 'crearRegla'],
    ['SalidasPanelController', SalidasPanelController, 'anularRegla'],
  ])('%s.%s: lo deja pasar', (_n, controller, metodo) => {
    expect(permitido(controller, metodo)).toBe(true);
  });

  it.each([
    ['VehiculosController', VehiculosController, 'crear'],
    ['VehiculosController', VehiculosController, 'actualizar'],
    ['VehiculosController', VehiculosController, 'cambiarEstado'],
    ['VehiculosController', VehiculosController, 'obtener'],
    ['ConductoresController', ConductoresController, 'crear'],
    ['ConductoresController', ConductoresController, 'actualizar'],
    ['SociosController', SociosController, 'listar'],
    ['SociosController', SociosController, 'crear'],
    ['LineasController', LineasController, 'crear'],
    ['LineasController', LineasController, 'actualizar'],
    ['LineaRutasController', LineaRutasController, 'crear'],
    ['RutasController', RutasController, 'actualizar'],
    ['RutaControlPointsController', RutaControlPointsController, 'crear'],
    ['ReglasController', ReglasController, 'crear'],
    ['ReglasController', ReglasController, 'actualizar'],
    ['SancionesController', SancionesController, 'crear'],
    ['SancionesController', SancionesController, 'aplicar'],
    ['RotacionesController', RotacionesController, 'listar'],
    ['RotacionesController', RotacionesController, 'generar'],
    ['AuditoriaController', AuditoriaController, 'listar'],
    ['ExportesController', ExportesController, 'exportarRecorridos'],
    ['CumplimientoController', CumplimientoController, 'obtener'],
    ['RecorridosController', RecorridosController, 'listar'],
    ['SindicatosController', SindicatosController, 'listar'],
    ['SyncErroresController', SyncErroresController, 'listar'],
    ['CredencialesMovilesController', CredencialesMovilesController, 'generarPinVehiculo'],
    // Grupos: SOLO admins (decisión del CTO, 20/10).
    ['GruposVehiculoController', GruposVehiculoController, 'listar'],
    ['GruposVehiculoController', GruposVehiculoController, 'crear'],
    ['AuthController', AuthController, 'listarUsuarios'],
    ['AuthController', AuthController, 'crearUsuario'],
    ['AuthController', AuthController, 'resetPasswordComoAdmin'],
  ])('%s.%s: 403', (_n, controller, metodo) => {
    expect(() => permitido(controller, metodo)).toThrow(ForbiddenException);
  });

  // El `@Roles` de método pisa al de clase (copia literal): si cambia el de clase, el listado no lo sigue solo.
  it.each([
    LineasController, VehiculosController, ConductoresController, LineaRutasController,
    RutaVariantesController, RutaControlPointsController, ReglasController, SancionesController,
  ].map((c) => [c.name, c] as const))('%s.listar: roles de clase + delegado', (_n, controller) => {
    const deClase = Reflect.getMetadata(ROLES_KEY, controller) as string[];
    const deMetodo = Reflect.getMetadata(ROLES_KEY, controller.prototype.listar) as string[];
    expect([...deMetodo].sort()).toEqual([...deClase, 'delegado'].sort());
  });

  it('el operador sigue sin leer reglas ni sanciones, y sin atender infracciones', () => {
    expect(() => permitido(ReglasController, 'listar', 'operador')).toThrow(ForbiddenException);
    expect(() => permitido(SancionesController, 'listar', 'operador')).toThrow(ForbiddenException);
    expect(() => permitido(InfraccionesController, 'actualizar', 'operador')).toThrow(ForbiddenException);
    expect(permitido(VehiculosController, 'crear', 'operador')).toBe(true);
  });

  it('crear usuarios del panel es solo de admin_quivo', () => {
    expect(permitido(AuthController, 'crearUsuario', 'admin_quivo')).toBe(true);
    expect(() => permitido(AuthController, 'crearUsuario', 'admin_sindicato')).toThrow(ForbiddenException);
  });
});
