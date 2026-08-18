import { describe, expect, it } from 'vitest';
import {
  AUTORIZACION_DENEGADA,
  AUTORIZACION_MIENTRAS_SE_USA,
  AUTORIZACION_NO_DETERMINADA,
  AUTORIZACION_RESTRINGIDA,
  AUTORIZACION_SIEMPRE,
  decidirPermisoGps,
} from './permiso-ubicacion';

/**
 * Reescrito tras el hallazgo CRÍTICO de la revisión de QUI-338: `ProviderChangeEvent.d.ts`
 * (SDK 5.4.0 instalado) documenta que `NotDetermined`/`Restricted`/`WhenInUse` son EXCLUSIVOS
 * de iOS, y que en Android `status` solo puede ser `ALWAYS` (permiso otorgado) o `DENIED`
 * (cualquier otro caso, incluidos "nunca se pidió" y "solo mientras se usa la app"). Los
 * tests viejos que le pasaban `AUTORIZACION_NO_DETERMINADA` a secas (sin plataforma) y
 * esperaban "no bloquea" codificaban semántica de iOS aplicada sin querer a Android, que es
 * justo el bug que dejaba el botón "Iniciar recorrido" deshabilitado en una instalación
 * nueva. Cada test de acá abajo dice explícitamente si ejercita Android o iOS.
 */
describe('decidirPermisoGps', () => {
  describe('Android', () => {
    it('instalación nueva (DENIED, nunca se pidió el permiso): NO bloquea — dispara el pedido explícito', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('no_solicitado');
      expect(decision.bloqueante).toBe(false);
      expect(decision.mensaje).toBe('');
    });

    it('denegado tras un pedido explícito previo (DENIED, ya se pidió): bloquea con acción a ajustes de la app', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('permiso_denegado');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBe('ajustes_app');
      expect(decision.etiquetaAccion).toContain('Permitir todo el tiempo');
    });

    it('denegado tras pedido: el mensaje cubre tanto "nunca concedió" como "solo mientras se usa la app" (hallazgo #7 — WhenInUse no llega en Android)', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      expect(decision.mensaje).toContain('Todo el tiempo');
      expect(decision.mensaje.toLowerCase()).toContain('mientras usás la app');
    });

    it('otorgado (ALWAYS) sin haber marcado un pedido previo: listo, no bloquea', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'android',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('listo');
      expect(decision.bloqueante).toBe(false);
      expect(decision.accion).toBeNull();
    });

    it('otorgado (ALWAYS) con pedido previo: sigue listo (ALWAYS manda, independiente de permisoYaSolicitado)', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('listo');
      expect(decision.bloqueante).toBe(false);
    });

    it('servicio de ubicación del sistema apagado: bloquea con acción a ajustes de ubicación, incluso en instalación nueva', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: false,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('servicio_desactivado');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBe('ajustes_ubicacion_sistema');
    });

    it('prioridad: servicio apagado gana aunque el permiso ya esté en ALWAYS', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: false,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('servicio_desactivado');
    });

    it('error nativo (estadoPermiso null): bloquea con mensaje genérico y sin acción, incluso en instalación nueva', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: null,
        plataforma: 'android',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('error_nativo');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBeNull();
    });

    it('prioridad: error nativo (estadoPermiso null) gana aunque el servicio esté apagado', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: false,
        estadoPermiso: null,
        plataforma: 'android',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('error_nativo');
    });

    it('defensivo: un status de iOS (WhenInUse) que llegara igual en Android no cambia el resultado — Android solo mira ALWAYS vs. no-ALWAYS', () => {
      const conWhenInUse = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_MIENTRAS_SE_USA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      const conDenied = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      });
      expect(conWhenInUse.estado).toBe(conDenied.estado);
      expect(conWhenInUse.bloqueante).toBe(conDenied.bloqueante);
    });
  });

  describe('iOS', () => {
    it('NotDetermined (primera vez, nunca se pidió): no bloquea — dispara el pedido explícito', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_NO_DETERMINADA,
        plataforma: 'ios',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('no_solicitado');
      expect(decision.bloqueante).toBe(false);
    });

    it('Denied: bloquea con acción a ajustes de la app', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'ios',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('permiso_denegado');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBe('ajustes_app');
    });

    it('Restricted (perfil gestionado/parental) se trata igual que Denied', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_RESTRINGIDA,
        plataforma: 'ios',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('permiso_denegado');
      expect(decision.bloqueante).toBe(true);
    });

    it('WhenInUse ("Mientras se usa la app" otorgado): bloquea, pide el paso a "todo el tiempo" — señal real en iOS, a diferencia de Android', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_MIENTRAS_SE_USA,
        plataforma: 'ios',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('permiso_parcial');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBe('ajustes_app');
      expect(decision.etiquetaAccion).toContain('Permitir todo el tiempo');
    });

    it('Always: listo, no bloquea', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'ios',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('listo');
      expect(decision.bloqueante).toBe(false);
      expect(decision.accion).toBeNull();
    });

    it('servicio de ubicación del sistema apagado: bloquea con acción a ajustes de ubicación', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: false,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'ios',
        permisoYaSolicitado: true,
      });
      expect(decision.estado).toBe('servicio_desactivado');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBe('ajustes_ubicacion_sistema');
    });

    it('error nativo (estadoPermiso null): bloquea con mensaje genérico y sin acción', () => {
      const decision = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: null,
        plataforma: 'ios',
        permisoYaSolicitado: false,
      });
      expect(decision.estado).toBe('error_nativo');
      expect(decision.bloqueante).toBe(true);
      expect(decision.accion).toBeNull();
    });

    it('el mensaje de denegado en iOS es distinto del mensaje fusionado de Android (no menciona el caso "solo mientras se usa la app")', () => {
      const iosMensaje = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'ios',
        permisoYaSolicitado: true,
      }).mensaje;
      const androidMensaje = decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      }).mensaje;
      expect(iosMensaje).not.toBe(androidMensaje);
    });
  });

  it('los cuatro mensajes bloqueantes de Android son todos distintos entre sí', () => {
    const mensajes = [
      decidirPermisoGps({
        servicioUbicacionActivo: false,
        estadoPermiso: AUTORIZACION_SIEMPRE,
        plataforma: 'android',
        permisoYaSolicitado: true,
      }).mensaje,
      decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: AUTORIZACION_DENEGADA,
        plataforma: 'android',
        permisoYaSolicitado: true,
      }).mensaje,
      decidirPermisoGps({
        servicioUbicacionActivo: true,
        estadoPermiso: null,
        plataforma: 'android',
        permisoYaSolicitado: true,
      }).mensaje,
    ];
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});
