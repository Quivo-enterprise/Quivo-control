import { describe, expect, it } from 'vitest';
import type { Location } from 'react-native-background-geolocation';
import type { PuntoControlPaquete } from '@quivo/shared';
import { claveCumplimiento, PASADA_MIN_MS, type EstadoPuntoControl } from './geofence';
import {
  clavesCumplimientoDesdePayloads,
  construirEventosDeUbicacion,
  type ContextoUbicacion,
} from './location-task';

function ubicacion(
  lat: number,
  lng: number,
  timestamp: Location['timestamp'] = '2026-08-14T12:00:00.000Z',
): Location {
  return {
    timestamp,
    // Transistorsoft v5: `recorded_at`/`odometer_error` son campos nuevos y obligatorios del
    // tipo `Location` (antes no existían). El código de producción no los usa — sólo se
    // agregan acá para satisfacer el tipo del mock.
    recorded_at: timestamp,
    age: 0,
    odometer: 0,
    odometer_error: 0,
    is_moving: true,
    uuid: 'loc-uuid-1',
    coords: { latitude: lat, longitude: lng, accuracy: 5, speed: 0 },
    battery: { level: 0.8, is_charging: false },
    activity: { type: 'in_vehicle', confidence: 90 },
  };
}

function puntoControl(
  id: string,
  coord: [number, number],
  radioToleranciaM = 30,
): PuntoControlPaquete {
  return {
    id,
    orden: 0,
    coord: { type: 'Point', coordinates: coord },
    radioToleranciaM,
    obligatorio: true,
  };
}

function contexto(
  puntosControl: PuntoControlPaquete[] = [],
  sesionId = 'sesion-1',
): ContextoUbicacion {
  return { deviceId: 'android:device-1', sesionId, puntosControl };
}

/** Aplica las transiciones devueltas a un Map NUEVO — simula lo que hace el caller real
 * (`registrarPuntoGps`, `headless-task.ts`) DESPUÉS de confirmar `encolarEvento`, sin mutar el
 * Map que el test todavía tiene en la mano (para poder aserirlo tal cual quedó ANTES). */
function conTransicionesAplicadas(
  estados: ReadonlyMap<string, EstadoPuntoControl>,
  transiciones: ReadonlyMap<string, EstadoPuntoControl>,
): Map<string, EstadoPuntoControl> {
  const nuevo = new Map(estados);
  for (const [clave, estado] of transiciones) nuevo.set(clave, estado);
  return nuevo;
}

describe('construirEventosDeUbicacion', () => {
  it('siempre construye el evento gps_point con el payload de la ubicación (evidencia RF-67..73)', () => {
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto(),
      new Map(),
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toEqual({
      tipo: 'gps_point',
      payload: {
        sesionId: 'sesion-1',
        lat: -17.78,
        lng: -63.18,
        accuracy: 5,
        speed: 0,
        tsFix: '2026-08-14T12:00:00.000Z',
      },
    });
    expect(deteccion).toBeNull();
  });

  it('propaga el timestamp del FIX GPS al payload, no el momento de encolado', () => {
    // Camino headless: el SDK entrega la ubicación bufferada mucho después del fix real, y
    // `encolarEvento` sella el sobre con `new Date()` — sin `tsFix`, un tramo entero de
    // manejo aterrizaría en `gps_points` con timestamps casi idénticos.
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, '2026-08-14T11:42:07.500Z'),
      contexto(),
      new Map(),
    );
    expect(eventos[0]?.payload['tsFix']).toBe('2026-08-14T11:42:07.500Z');
  });

  it('normaliza un timestamp numérico (epoch ms, Transistorsoft v5) a ISO-8601 en tsFix', () => {
    // v4 tipaba `Location.timestamp` como `string`; v5 lo ensanchó a `string | number` (epoch
    // ms en el caso numérico). Sin normalizar, `tsFix` pasaba el número tal cual y perdía el
    // `.datetime()` de Zod en `resolverTsFix` (`@quivo/shared`), que caía en silencio al `ts`
    // de encolado — la deformación del recorrido que `tsFix` existe para evitar.
    const epochMs = Date.parse('2026-08-14T11:42:07.500Z');
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, epochMs),
      contexto(),
      new Map(),
    );
    expect(eventos[0]?.payload['tsFix']).toBe('2026-08-14T11:42:07.500Z');
  });

  it('cae a tsFix undefined (nunca "Invalid Date") ante un timestamp ilegible', () => {
    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, 'no-es-una-fecha'),
      contexto(),
      new Map(),
    );
    expect(eventos[0]?.payload['tsFix']).toBeUndefined();
  });

  it('agrega cumplimiento_punto_control con pasada:1 tras el mínimo local, cuando el punto cae dentro del radio de un punto de control nuevo', () => {
    // ENTREGA 6 (plan post-piloto 2026-09-09): la ENTRADA ya no emite en el mismo tick — solo
    // arranca el seguimiento del "mínimo local". Hace falta un segundo fix que muestre que la
    // distancia volvió a crecer para que la confirmación salga (ver el comentario largo de
    // `filtrarNuevosCumplimientos`, `geofence.ts`).
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map<string, EstadoPuntoControl>();

    // Paso 1: entra exactamente sobre el punto (distancia 0) — solo el `gps_point`, sin
    // confirmar todavía.
    const paso1 = construirEventosDeUbicacion(ubicacion(-17.78, -63.18, t0), contexto([pc]), estados);
    expect(paso1.eventos).toHaveLength(1);
    expect(paso1.eventos[0]?.tipo).toBe('gps_point');
    expect(paso1.deteccion).toBeNull();
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    // Paso 2: se aleja ~33 m (sigue dentro de los 45 m de re-armado) — la distancia CRECE
    // respecto del mínimo (0) ⇒ confirma con pasada 1.
    const { eventos, deteccion, transicionesEstado } = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, t0 + 10_000),
      contexto([pc]),
      estados,
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[1]?.tipo).toBe('cumplimiento_punto_control');
    expect(eventos[1]?.payload).toMatchObject({
      sesionId: 'sesion-1',
      puntoControlId: 'pc-1',
      pasada: 1,
    });
    expect(deteccion?.puntoControlId).toBe('pc-1');
    // Es PURA: no muta ningún Map que el caller le haya pasado — a diferencia de la versión
    // anterior (mutaba un Set in-place). Las transiciones viajan aparte, para que el caller
    // las aplique SOLO tras confirmar la escritura (ver el comentario de
    // `ResultadoConstruirEventos` en `location-task.ts` y el hallazgo de revisión del plan
    // §2.4, "el Set se muta antes de confirmar la escritura").
    const clave = claveCumplimiento('sesion-1', 'pc-1');
    expect(transicionesEstado.get(clave)).toMatchObject({ dentro: true, pasadas: 1, confirmado: true });
  });

  it('NO muta el Map de estados recibido (la mutación es responsabilidad del caller, tras confirmar la escritura)', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const estados = new Map<string, EstadoPuntoControl>();
    construirEventosDeUbicacion(ubicacion(-17.78, -63.18), contexto([pc]), estados);
    expect(estados.size).toBe(0);
  });

  it('propaga el timestamp del FIX GPS que confirma (no el de entrada) al payload de cumplimiento_punto_control (evidencia RF-64..66)', () => {
    // ENTREGA 6: el evento de cumplimiento se arma con la MISMA `location` que dispara la
    // CONFIRMACIÓN (mínimo local) — el fix de entrada solo arranca el seguimiento, no genera
    // evidencia por sí mismo. Sin esto la hora de paso por el punto de control (el hecho que
    // sustenta una sanción) quedaría corrida al momento del encolado bajo el camino headless.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    let estados = new Map<string, EstadoPuntoControl>();
    const paso1 = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, '2026-08-14T11:42:07.500Z'),
      contexto([pc]),
      estados,
    );
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    const { eventos } = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, '2026-08-14T11:42:17.500Z'),
      contexto([pc]),
      estados,
    );
    expect(eventos[1]?.payload['tsFix']).toBe('2026-08-14T11:42:17.500Z');
  });

  it('no re-emite DENTRO DE LA MISMA PASADA si el punto de control ya estaba "dentro"', () => {
    // Reemplaza al viejo "no repite si ya estaba detectado": la propiedad que se sigue
    // garantizando es "no hay una segunda emisión mientras sigue siendo la misma pasada".
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: true, ultimoEmitidoMs: 0, pasadas: 1 }],
    ]);
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([pc]),
      estados,
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe('gps_point');
    expect(deteccion).toBeNull();
  });

  it('emite el cumplimiento de una sesión NUEVA aunque el punto de control ya se haya registrado en la anterior', () => {
    // El estado del headless task vive todo el contexto JS y nadie lo resetea al cambiar de
    // sesión: ruta A terminada con pc-1 "dentro", y ahora arranca la ruta B (o el turno del
    // día siguiente sobre la misma ruta recurrente) con el mismo contexto vivo. La clave de
    // sesión-2 es una entrada nueva para la máquina de estados — ENTREGA 6: dos ticks.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map([
      [claveCumplimiento('sesion-1', 'pc-1'), { dentro: true, ultimoEmitidoMs: 0, pasadas: 1 }],
    ]);
    const paso1 = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, t0),
      contexto([pc], 'sesion-2'),
      estados,
    );
    expect(paso1.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    const { eventos, deteccion, transicionesEstado } = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, t0 + 10_000),
      contexto([pc], 'sesion-2'),
      estados,
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[1]?.tipo).toBe('cumplimiento_punto_control');
    expect(eventos[1]?.payload).toMatchObject({
      sesionId: 'sesion-2',
      puntoControlId: 'pc-1',
      pasada: 1,
    });
    expect(deteccion?.puntoControlId).toBe('pc-1');
    expect(transicionesEstado.get(claveCumplimiento('sesion-2', 'pc-1'))).toMatchObject({
      dentro: true,
      pasadas: 1,
    });
    // La sesión-1 no se tocó — la clave vieja sigue intacta en el Map que el caller mantiene.
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))).toMatchObject({ pasadas: 1 });
  });

  it('no evalúa puntos de control cuando el paquete del día no trae ninguno', () => {
    const { eventos, deteccion } = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18),
      contexto([]),
      new Map(),
    );
    expect(eventos).toHaveLength(1);
    expect(deteccion).toBeNull();
  });

  it('M3: un fix con accuracy PEOR que el radio SÍ emite la pasada (antes se descartaba entera) y deja aviso de precisión', () => {
    // Reemplaza al gate de A2, que filtraba la detección cuando `accuracy > radioToleranciaM`:
    // con los radios de 100 m de la Z12 y una Android que reporta 100-500 m de rutina en calles
    // encajonadas, una pasada genuina desaparecía por completo — sin evento y sin telemetría.
    // Ahora se emite y queda marcada como degradada (breadcrumb en `registrarPuntoGps`).
    // ENTREGA 6: el aviso de precisión se evalúa con la accuracy del fix que CONFIRMA (el que
    // dispara el "mínimo local"), no el de entrada — ver el comentario de `avisosPrecision` en
    // `filtrarNuevosCumplimientos`.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map<string, EstadoPuntoControl>();
    const paso1 = construirEventosDeUbicacion(ubicacion(-17.78, -63.18, t0), contexto([pc]), estados);
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    const loc = ubicacion(-17.7797, -63.18, t0 + 10_000);
    const ubicacionPocoPrecisa: Location = { ...loc, coords: { ...loc.coords, accuracy: 50 } };
    const { eventos, deteccion, avisosPrecision } = construirEventosDeUbicacion(
      ubicacionPocoPrecisa,
      contexto([pc]),
      estados,
    );
    expect(eventos).toHaveLength(2);
    expect(eventos[1]?.tipo).toBe('cumplimiento_punto_control');
    expect(eventos[1]?.payload).toMatchObject({ puntoControlId: 'pc-1', pasada: 1 });
    expect(deteccion?.puntoControlId).toBe('pc-1');
    expect(avisosPrecision).toHaveLength(1);
    expect(avisosPrecision[0]).toMatchObject({
      motivo: 'emision-con-precision-degradada',
      puntoControlId: 'pc-1',
      accuracyM: 50,
    });
  });

  it('M3: un accuracy mejor que el radio emite sin ningún aviso de precisión', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map<string, EstadoPuntoControl>();
    const paso1 = construirEventosDeUbicacion(ubicacion(-17.78, -63.18, t0), contexto([pc]), estados);
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    const loc = ubicacion(-17.7797, -63.18, t0 + 10_000);
    const ubicacionPrecisa: Location = { ...loc, coords: { ...loc.coords, accuracy: 30 } };
    const { eventos, deteccion, avisosPrecision } = construirEventosDeUbicacion(
      ubicacionPrecisa,
      contexto([pc]),
      estados,
    );
    expect(eventos).toHaveLength(2);
    expect(deteccion?.puntoControlId).toBe('pc-1');
    expect(avisosPrecision).toHaveLength(0);
  });

  it('M3: accuracy ausente/no finito se trata como margen 0 (comportamiento previo al campo)', () => {
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map<string, EstadoPuntoControl>();
    const paso1 = construirEventosDeUbicacion(ubicacion(-17.78, -63.18, t0), contexto([pc]), estados);
    estados = conTransicionesAplicadas(estados, paso1.transicionesEstado);

    const loc = ubicacion(-17.7797, -63.18, t0 + 10_000);
    const ubicacionSinAccuracy: Location = { ...loc, coords: { ...loc.coords, accuracy: NaN } };
    const { eventos, deteccion, avisosPrecision } = construirEventosDeUbicacion(
      ubicacionSinAccuracy,
      contexto([pc]),
      estados,
    );
    expect(eventos).toHaveLength(2);
    expect(deteccion?.puntoControlId).toBe('pc-1');
    expect(avisosPrecision).toHaveLength(0);
  });

  it('M3: un fix impreciso NO re-arma la histéresis, así que no habilita una pasada fantasma', () => {
    // La contracara del test de arriba: la accuracy sí se descuenta en el RE-ARMADO, que es el
    // único camino por el que un fix impreciso puede inventar evidencia (re-armado espurio +
    // piso de tiempo ⇒ pasada fantasma con el vehículo quieto).
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30); // radio de re-armado: 45 m
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    let estados = new Map<string, EstadoPuntoControl>();

    // Entra y confirma pasada 1 (ENTREGA 6, dos ticks — ver el primer test de este describe).
    const entrada = construirEventosDeUbicacion(ubicacion(-17.78, -63.18, t0), contexto([pc]), estados);
    expect(entrada.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, entrada.transicionesEstado);
    const confirmacion = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, t0 + 10_000),
      contexto([pc]),
      estados,
    );
    expect(confirmacion.eventos[1]?.payload).toMatchObject({ pasada: 1 });
    estados = conTransicionesAplicadas(estados, confirmacion.transicionesEstado);

    // ~111 m al norte (fuera de los 45 m de re-armado) pero con accuracy 300: no concluyente.
    const loc = ubicacion(-17.779, -63.18, t0 + 20_000);
    const impreciso: Location = { ...loc, coords: { ...loc.coords, accuracy: 300 } };
    for (const desfase of [20_000, 30_000, 40_000]) {
      const paso = construirEventosDeUbicacion(
        { ...impreciso, timestamp: t0 + desfase },
        contexto([pc]),
        estados,
      );
      expect(paso.avisosPrecision[0]?.motivo).toBe('rearme-postergado-por-precision');
      estados = conTransicionesAplicadas(estados, paso.transicionesEstado);
      expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);
    }

    // Y con el vehículo de vuelta en el punto, pasado el piso, sigue siendo la MISMA pasada —
    // ya estaba `confirmado: true` desde la confirmación de arriba, así que no vuelve a
    // disparar el seguimiento del mínimo local.
    const pasoRegreso = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, t0 + PASADA_MIN_MS + 50_000),
      contexto([pc]),
      estados,
    );
    expect(pasoRegreso.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
  });

  it('multi-vuelta: dos pasadas separadas por una salida real del radio incrementan el contador de pasadas', () => {
    // Simula lo que hace el caller real tick a tick: aplica las `transicionesEstado` recién
    // DESPUÉS de "confirmar" el encolado (acá, simplemente tras leer el resultado).
    const pc = puntoControl('pc-1', [-63.18, -17.78], 150);
    let estados = new Map<string, EstadoPuntoControl>();

    // Pasada 1: entra y confirma (ENTREGA 6, dos ticks — la entrada sola no emite).
    const t0 = Date.parse('2026-08-14T12:00:00.000Z');
    const entrada1 = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, t0),
      contexto([pc]),
      estados,
    );
    expect(entrada1.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, entrada1.transicionesEstado);

    const confirma1 = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, t0 + 10_000), // se aleja un poco: dentro de los 225 m de re-armado, confirma
      contexto([pc]),
      estados,
    );
    expect(confirma1.eventos[1]?.payload).toMatchObject({ pasada: 1 });
    estados = conTransicionesAplicadas(estados, confirma1.transicionesEstado);

    // Se aleja 0.01° de latitud (~1.1 km, bien por encima de radio*1.5=225m). A2: hace falta un
    // SEGUNDO fix consecutivo fuera del radio de re-armado para re-armar de verdad — un solo
    // outlier no alcanza.
    const paso2a = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, t0 + 60_000),
      contexto([pc]),
      estados,
    );
    expect(paso2a.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, paso2a.transicionesEstado);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);

    const paso2b = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, t0 + 70_000),
      contexto([pc]),
      estados,
    );
    expect(paso2b.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, paso2b.transicionesEstado);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Vuelve bien pasado el piso de 2 min: entra (sin confirmar todavía) y confirma pasada 2 en
    // el tick siguiente, mismo patrón que la pasada 1.
    const entrada2 = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, t0 + PASADA_MIN_MS + 71_000),
      contexto([pc]),
      estados,
    );
    expect(entrada2.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estados = conTransicionesAplicadas(estados, entrada2.transicionesEstado);

    const confirma2 = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, t0 + PASADA_MIN_MS + 81_000),
      contexto([pc]),
      estados,
    );
    expect(confirma2.eventos[1]?.payload).toMatchObject({ pasada: 2 });
  });
});

describe('clavesCumplimientoDesdePayloads', () => {
  it('reconstruye el estado (dentro/pasadas) de los cumplimientos que siguen en el outbox', () => {
    const estados = clavesCumplimientoDesdePayloads([
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 'sesion-1', puntoControlId: 'pc-2' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 'sesion-2', puntoControlId: 'pc-1' } },
    ]);
    expect([...estados.keys()].sort()).toEqual([
      claveCumplimiento('sesion-1', 'pc-1'),
      claveCumplimiento('sesion-1', 'pc-2'),
      claveCumplimiento('sesion-2', 'pc-1'),
    ]);
  });

  it('ignora eventos sin sesionId o sin puntoControlId en vez de fabricar claves basura', () => {
    const estados = clavesCumplimientoDesdePayloads([
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 'sesion-1' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: { puntoControlId: 'pc-1' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 1, puntoControlId: 'pc-1' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: {} },
    ]);
    expect(estados.size).toBe(0);
  });

  it('A1: `dentro` es SIEMPRE true cuando hay al menos una emisión previa, sin importar cuánto tiempo pasó desde tsFix', () => {
    // La versión anterior derivaba `dentro` como función del tiempo transcurrido (>PASADA_MIN_MS
    // ⇒ false) — eso causaba una pasada FANTASMA con el vehículo parado y la app reabierta (o el
    // contexto headless reciclado) más de 2 min después. Ahora `dentro` no depende del reloj:
    // tanto una emisión de hace 40s como una de hace 3h siembran `dentro:true` por igual.
    const ahoraMs = Date.parse('2026-08-14T12:00:00.000Z');
    const tsFixReciente = new Date(ahoraMs - 40_000).toISOString();
    const tsFixViejo = new Date(ahoraMs - 3 * 60 * 60 * 1000).toISOString();
    const estados = clavesCumplimientoDesdePayloads([
      { ts: tsFixReciente, payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1', tsFix: tsFixReciente } },
      { ts: tsFixViejo, payload: { sesionId: 'sesion-1', puntoControlId: 'pc-2', tsFix: tsFixViejo } },
    ]);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-2'))?.dentro).toBe(true);
  });

  it('usa el ts del SOBRE como fallback cuando el payload no trae tsFix (app anterior a este cambio), y también deriva dentro:true', () => {
    const ahoraMs = Date.parse('2026-08-14T12:00:00.000Z');
    const tsSobreViejo = new Date(ahoraMs - (PASADA_MIN_MS + 1_000)).toISOString();
    const estados = clavesCumplimientoDesdePayloads([
      { ts: tsSobreViejo, payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1' } },
    ]);
    const estado = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estado?.dentro).toBe(true);
    expect(estado?.ultimoEmitidoMs).toBe(Date.parse(tsSobreViejo));
  });

  it('siembra con tsFix viejo (caso obligatorio §2.6): NO suprime evidencia — evita la pasada fantasma inmediata, pero una salida y regreso reales igual incrementan el contador', () => {
    // Caso obligatorio del plan §2.6: "siembra desde outbox con tsFix viejo ⇒ no suprime". Con
    // A1, la semilla vieja YA NO permite una reemisión inmediata con el vehículo parado (eso era
    // justo el bug que A1 corrigió) — pero tampoco bloquea para siempre una pasada nueva de
    // verdad: en cuanto el vehículo se aleja (2 fixes seguidos fuera de radio*1.5, A2) y vuelve
    // pasado el piso, la pasada 2 se emite igual.
    const tsFixViejo = '2026-08-14T09:00:00.000Z'; // horas antes de cualquier fix de este test
    const estados = clavesCumplimientoDesdePayloads([
      { ts: tsFixViejo, payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1', tsFix: tsFixViejo } },
    ]);
    expect(estados.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(true);

    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const ahoraMs = Date.parse('2026-08-14T12:00:00.000Z'); // 3h después del tsFix sembrado

    // El vehículo sigue (o volvió a estar) parado en el punto: NO reemite solo porque el tsFix
    // sembrado es viejo — hay que re-armar por distancia primero.
    const pasoInmediato = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, ahoraMs),
      contexto([pc]),
      estados,
    );
    expect(pasoInmediato.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    let estadosVivos = conTransicionesAplicadas(estados, pasoInmediato.transicionesEstado);

    // Se aleja de verdad: dos fixes seguidos bien fuera de radio*1.5 (30*1.5=45m) re-arman (A2).
    const pasoLejos1 = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, ahoraMs + 60_000), // ~1.1km, mucho más que 45m
      contexto([pc]),
      estadosVivos,
    );
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoLejos1.transicionesEstado);
    const pasoLejos2 = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, ahoraMs + 70_000),
      contexto([pc]),
      estadosVivos,
    );
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoLejos2.transicionesEstado);
    expect(estadosVivos.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // Vuelve, bien pasado el piso de 2 min desde la última EMISIÓN (tsFixViejo, hace horas):
    // la evidencia NO quedó suprimida. ENTREGA 6: entra (sin confirmar todavía) y confirma
    // pasada 2 en el tick siguiente, mismo patrón de dos ticks que el resto del archivo.
    const pasoRegreso = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, ahoraMs + PASADA_MIN_MS + 80_000),
      contexto([pc]),
      estadosVivos,
    );
    expect(pasoRegreso.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoRegreso.transicionesEstado);

    const pasoConfirma = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, ahoraMs + PASADA_MIN_MS + 90_000),
      contexto([pc]),
      estadosVivos,
    );
    expect(pasoConfirma.eventos[1]?.payload).toMatchObject({ pasada: 2 });
  });

  it('el contador de pasadas CONTINÚA desde la semilla (cuenta las filas ya en el outbox), no reinicia en 1', () => {
    const estados = clavesCumplimientoDesdePayloads([
      { ts: '2026-08-14T09:00:00.000Z', payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1' } },
      { ts: '2026-08-14T10:00:00.000Z', payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1' } },
      { ts: '2026-08-14T11:00:00.000Z', payload: { sesionId: 'sesion-1', puntoControlId: 'pc-1' } },
    ]);
    const estado = estados.get(claveCumplimiento('sesion-1', 'pc-1'));
    expect(estado?.pasadas).toBe(3);
    expect(estado?.dentro).toBe(true);

    // Con A1, la pasada 4 ya no sale "gratis" por sembrado viejo: hay que re-armar por distancia
    // primero (misma mecánica que el test anterior) — y, al hacerlo, continúa en 4, no en 1.
    const pc = puntoControl('pc-1', [-63.18, -17.78], 30);
    const ahoraMs = Date.parse('2026-08-14T12:00:00.000Z');
    let estadosVivos = new Map(estados);

    const pasoLejos1 = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, ahoraMs),
      contexto([pc]),
      estadosVivos,
    );
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoLejos1.transicionesEstado);
    const pasoLejos2 = construirEventosDeUbicacion(
      ubicacion(-17.79, -63.18, ahoraMs + 10_000),
      contexto([pc]),
      estadosVivos,
    );
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoLejos2.transicionesEstado);
    expect(estadosVivos.get(claveCumplimiento('sesion-1', 'pc-1'))?.dentro).toBe(false);

    // ENTREGA 6: entra (sin confirmar todavía) y confirma pasada 4 en el tick siguiente — el
    // contador sigue continuando desde la semilla (3), no desde 0.
    const pasoRegreso = construirEventosDeUbicacion(
      ubicacion(-17.78, -63.18, ahoraMs + PASADA_MIN_MS + 20_000),
      contexto([pc]),
      estadosVivos,
    );
    expect(pasoRegreso.eventos.some((e) => e.tipo === 'cumplimiento_punto_control')).toBe(false);
    estadosVivos = conTransicionesAplicadas(estadosVivos, pasoRegreso.transicionesEstado);

    const pasoConfirma = construirEventosDeUbicacion(
      ubicacion(-17.7797, -63.18, ahoraMs + PASADA_MIN_MS + 30_000),
      contexto([pc]),
      estadosVivos,
    );
    expect(pasoConfirma.eventos[1]?.payload).toMatchObject({ pasada: 4 });
  });
});
