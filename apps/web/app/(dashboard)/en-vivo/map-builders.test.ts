import { describe, expect, it } from 'vitest';
import type { ContextoEnVivo, PosicionEnVivo, PuntoControl, Ruta } from '@quivo/shared';
import { construirMarcadoresVehiculos, construirPuntosControl, construirMapaDeLinea, construirRutas, idMarcadorVehiculo } from './map-builders';

// Fixture mínima de `PosicionEnVivo` (`GET /reportes/en-vivo/posiciones`, Entregas 10/13):
// todos los campos que NO le importan a `map-builders.ts` quedan con un valor fijo cualquiera
// — lo que importa para estos tests es `id`, `lat`/`lng`, `lineaId` y `estadoFrescura`.
function posicion(overrides: Partial<PosicionEnVivo>): PosicionEnVivo {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    deviceId: 'android:11111111-1111-4111-8111-111111111111',
    activa: true,
    vehiculoPlaca: '9001TST',
    conductorNombre: 'Betty',
    lineaId: '00000000-0000-4000-8000-0000000000a1',
    lineaNombre: 'Zona 12',
    rutaSentido: 'ida',
    lat: -17.39,
    lng: -66.15,
    accuracy: 8,
    speed: 3.2,
    totalPuntos: 40,
    ultimoFixTs: '2026-09-10T10:00:00.000Z',
    ultimoIngresoTs: '2026-09-10T10:00:02.000Z',
    servidorTs: '2026-09-10T10:00:05.000Z',
    antiguedadFixMs: 5_000,
    antiguedadIngestaMs: 3_000,
    inactivaDesdeMs: 3_000,
    estadoFrescura: 'reportando',
    recorridoFinTs: null,
    ...overrides,
  };
}

describe('idMarcadorVehiculo', () => {
  it('namespacea el id por sesión — ENTREGA 14, reemplaza a la constante única', () => {
    expect(idMarcadorVehiculo('s1')).toBe('vehiculo:s1');
    expect(idMarcadorVehiculo('s2')).toBe('vehiculo:s2');
    expect(idMarcadorVehiculo('s1')).not.toBe(idMarcadorVehiculo('s2'));
  });
});

describe('construirMapaDeLinea', () => {
  const ruta = (id: string, estado: Ruta['estado'], sentido = 'ida'): Ruta => ({
    id,
    lineaId: 'l1',
    sentido,
    geometria: { type: 'LineString', coordinates: [[-66.15, -17.39], [-66.16, -17.4]] },
    estado,
    publicStatus: 'borrador',
    publishedAt: null,
  });
  const pc = (id: string, orden: number, estado: PuntoControl['estado'] = 'activo'): PuntoControl => ({
    id,
    rutaId: 'r1',
    orden,
    coord: { type: 'Point', coordinates: [-66.15 - orden / 100, -17.39] },
    radioToleranciaM: 40,
    obligatorio: true,
    estado,
  });

  it('dibuja las rutas con el color de la línea y numera los PC activos por orden', () => {
    const r = construirMapaDeLinea('#123456', [
      { ruta: ruta('r1', 'activo'), puntos: [pc('b', 2), pc('a', 1), pc('x', 3, 'inactivo')] },
    ]);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]).toMatchObject({ color: '#123456', points: [{ lat: -17.39, lng: -66.15 }, { lat: -17.4, lng: -66.16 }] });
    expect(r.markers.map((m) => m.label)).toEqual(['Punto de control 1', 'Punto de control 2']);
    expect(r.zones).toHaveLength(2);
  });

  it('con varias rutas prefija los PC con el sentido legible', () => {
    const r = construirMapaDeLinea('#123456', [
      { ruta: ruta('r1', 'activo', 'ida'), puntos: [pc('a', 1)] },
      { ruta: ruta('r2', 'activo', 'vuelta'), puntos: [pc('b', 1)] },
    ]);
    expect(r.routes.map((x) => x.label)).toEqual(['Ruta Ida', 'Ruta Vuelta']);
    expect(r.markers.map((m) => m.label)).toEqual(['Ida · Punto de control 1', 'Vuelta · Punto de control 1']);
  });

  it('sin rutas devuelve todo vacío', () => {
    expect(construirMapaDeLinea('#123456', [])).toEqual({ routes: [], markers: [], zones: [] });
  });
});

describe('construirMarcadoresVehiculos', () => {
  it('con N vehículos produce N features, cada uno con id namespaceado por sesión', () => {
    const posiciones = [
      posicion({ id: 's1', lat: -17.39, lng: -66.15 }),
      posicion({ id: 's2', lat: -17.40, lng: -66.16 }),
      posicion({ id: 's3', lat: -17.41, lng: -66.17 }),
    ];
    const markers = construirMarcadoresVehiculos(posiciones, () => {});
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.id)).toEqual(['vehiculo:s1', 'vehiculo:s2', 'vehiculo:s3']);
  });

  it('abre en abanico (solo para dibujar) los vehículos apilados a <= 10 m y respeta al seleccionado', () => {
    const posiciones = [
      posicion({ id: 'a', lat: -17.39, lng: -66.15 }),
      posicion({ id: 'b', lat: -17.39, lng: -66.15 }),
      posicion({ id: 'c', lat: -17.39, lng: -66.15 }),
      posicion({ id: 'lejos', lat: -17.5, lng: -66.15 }),
    ];
    const m = construirMarcadoresVehiculos(posiciones, () => {}, { seleccionadoId: 'c' });
    const dist = (x: { lat: number; lng: number }, y: { lat: number; lng: number }) =>
      Math.hypot((x.lat - y.lat) * 111_320, (x.lng - y.lng) * 111_320 * Math.cos((-17.39 * Math.PI) / 180));
    expect(m[0]).toMatchObject({ lat: -17.39, lng: -66.15 }); // ancla del grupo
    expect(dist(m[0]!, m[1]!)).toBeCloseTo(7, 1);
    expect(m[2]).toMatchObject({ lat: -17.39, lng: -66.15 }); // seleccionado: posición real
    expect(m[3]).toMatchObject({ lat: -17.5, lng: -66.15 }); // aislado: intacto
    expect(construirMarcadoresVehiculos(posiciones, () => {}, { seleccionadoId: 'c' })[1]).toMatchObject({
      lat: m[1]!.lat,
      lng: m[1]!.lng,
    }); // determinista
  });

  it('un vehículo sin primer fix (lat/lng null) NO se dibuja', () => {
    const posiciones = [
      posicion({ id: 's1', lat: -17.39, lng: -66.15 }),
      posicion({ id: 's2', lat: null, lng: null }),
      // Caso mixto real: la API puede devolver solo uno de los dos en null si el dato está
      // corrupto — igual de indibujable, tiene que quedar afuera.
      posicion({ id: 's3', lat: -17.41, lng: null }),
    ];
    const markers = construirMarcadoresVehiculos(posiciones, () => {});
    expect(markers).toHaveLength(1);
    expect(markers[0]!.id).toBe('vehiculo:s1');
  });

  it('propaga estadoFrescura y placa a las properties del MapPoint — las consume la capa symbol', () => {
    const posiciones = [
      posicion({ id: 's1', vehiculoPlaca: '9001TST', estadoFrescura: 'reportando' }),
      posicion({ id: 's2', vehiculoPlaca: '9004TST', estadoFrescura: 'perdido' }),
      posicion({ id: 's3', vehiculoPlaca: '9006TST', estadoFrescura: 'detenido' }),
    ];
    const markers = construirMarcadoresVehiculos(posiciones, () => {});
    expect(markers.map((m) => ({ estadoFrescura: m.estadoFrescura, placa: m.placa }))).toEqual([
      { estadoFrescura: 'reportando', placa: '9001TST' },
      { estadoFrescura: 'perdido', placa: '9004TST' },
      { estadoFrescura: 'detenido', placa: '9006TST' },
    ]);
  });

  it('todos los markers de vehículo salen con pinType "vehicle" — así los separa la capa symbol de los puntos de control y de los pinType "pulse" del editor de trazado', () => {
    const markers = construirMarcadoresVehiculos([posicion({ id: 's1' })], () => {});
    expect(markers[0]!.pinType).toBe('vehicle');
  });

  it('el click del marker llama a onSeleccionar con el id de LA sesión correspondiente, no la primera', () => {
    const posiciones = [posicion({ id: 's1' }), posicion({ id: 's2' })];
    const seleccionados: string[] = [];
    const markers = construirMarcadoresVehiculos(posiciones, (id) => seleccionados.push(id));
    markers[1]!.onClick?.();
    expect(seleccionados).toEqual(['s2']);
  });
});

describe('construirMarcadoresVehiculos — PR E (alertas, color de línea, selección)', () => {
  it('mapea nivel y cantidad a alerta que parpadea; sin abiertas no hay alerta', () => {
    const [con, sin, cero] = construirMarcadoresVehiculos(
      [
        posicion({ id: 'a', infraccionNivel: 'gravisima', infraccionesAbiertas: 2 }),
        posicion({ id: 'b', infraccionNivel: null, infraccionesAbiertas: 0 }),
        posicion({ id: 'c', infraccionNivel: 'grave', infraccionesAbiertas: 0 }),
      ],
      () => {},
    );
    expect(con!.alerta).toEqual({ nivel: 'gravisima', abiertas: 2, atendidas: 0, parpadea: true });
    expect(sin!.alerta).toBeUndefined();
    expect(cero!.alerta).toBeUndefined();
  });

  it('solo atendidas: ícono fijo con el nivel de las atendidas, sin parpadeo (pendiente E #1)', () => {
    const [m] = construirMarcadoresVehiculos(
      [
        posicion({
          id: 'a',
          infraccionNivel: null,
          infraccionesAbiertas: 0,
          infraccionesAtendidas: 1,
          infraccionNivelAtendida: 'grave',
        }),
      ],
      () => {},
    );
    expect(m!.alerta).toEqual({ nivel: 'grave', abiertas: 0, atendidas: 1, parpadea: false });
  });

  it('badge "M" solo con la vuelta designada a una variante', () => {
    const vuelta = (varianteId: string | null) => ({
      numero: 2,
      varianteId,
      varianteNombre: varianteId ? 'Vía Molinos' : null,
      designadaEn: null,
      acuseEn: null,
      enEspera: false,
      esperaDesdeTs: null,
      molinosProxima: false,
    });
    const [con, sin, nula] = construirMarcadoresVehiculos(
      [
        posicion({ id: 'a', vuelta: vuelta('00000000-0000-4000-8000-000000000001') }),
        posicion({ id: 'b', vuelta: vuelta(null) }),
        posicion({ id: 'c', vuelta: null }),
      ],
      () => {},
    );
    expect(con!.molinos).toBe(true);
    expect(sin!.molinos).toBeUndefined();
    expect(nula!.molinos).toBeUndefined();
  });

  it('"M2": el lugar en la cola del servidor llega como número; designado fuera de cola = true', () => {
    const designada = { numero: 1, varianteId: 'v', varianteNombre: 'Vía Molinos', designadaEn: null, acuseEn: null, enEspera: false, esperaDesdeTs: null, molinosProxima: false };
    const espera = { ...designada, enEspera: true };
    const [a, b, c, d] = construirMarcadoresVehiculos(
      [
        posicion({ id: 'a' }),
        posicion({ id: 'b', vuelta: espera }),
        posicion({ id: 'c', vuelta: espera }),
        posicion({ id: 'd', vuelta: designada }),
      ],
      () => {},
      { ordenMolinos: new Map([['a', 2], ['b', 1], ['d', 3]]) },
    );
    // `a` (sin vuelta) y `d` (ya no espera según la posición fresca): el orden viejo del resumen no gana.
    expect([a!.molinos, b!.molinos, c!.molinos, d!.molinos]).toEqual([undefined, 1, true, true]);
  });

  it('colorLinea por lineaId y seleccionado solo para la sesión abierta', () => {
    const markers = construirMarcadoresVehiculos(
      [posicion({ id: 'a', lineaId: 'L1' }), posicion({ id: 'b', lineaId: 'L2' })],
      () => {},
      { seleccionadoId: 'b', colorLineaPorId: { L1: '#ff0000' } },
    );
    expect(markers[0]!.colorLinea).toBe('#ff0000');
    expect(markers[0]!.seleccionado).toBeUndefined();
    expect(markers[1]!.colorLinea).toBeUndefined();
    expect(markers[1]!.seleccionado).toBe(true);
  });

  it('usa fotoUrl cuando la API la manda y no inventa una cuando no', () => {
    const conFoto = { ...posicion({ id: 'a' }), fotoUrl: 'https://x.test/a.jpg' };
    const [a, b] = construirMarcadoresVehiculos([conFoto, posicion({ id: 'b' })], () => {});
    expect(a!.fotoUrl).toBe('https://x.test/a.jpg');
    expect(b!.fotoUrl).toBeUndefined();
  });
});

describe('construirRutas', () => {
  const linea = (coords: number[][]) => ({ type: 'LineString' as const, coordinates: coords });
  const contexto = {
    linea: { color: '#16a34a' },
    ruta: { geometria: linea([[-66.15, -17.39], [-66.14, -17.39]]) },
    variantes: [
      { id: 'v1', nombre: 'Molinos', geometria: linea([[-66.14, -17.39], [-66.13, -17.4]]) },
      { id: 'v2', nombre: 'Vacía', geometria: linea([]) },
    ],
  } as unknown as ContextoEnVivo;

  it('dibuja la variante designada entre la base y la traza, sin desplazarla', () => {
    const rutas = construirRutas(contexto, undefined, [], 'v1');
    expect(rutas.map((r) => r.id)).toEqual(['ruta-asignada', 'ruta-variante']);
    expect(rutas[1]).toMatchObject({ sinOffset: true });
    expect(rutas[1]!.dashed).toBeUndefined();
    expect(rutas[1]!.points[1]).toEqual({ lat: -17.4, lng: -66.13 });
  });

  it.each([[null], ['desconocida'], ['v2']])('no dibuja variante con varianteId=%s', (id) => {
    expect(construirRutas(contexto, undefined, [], id).map((r) => r.id)).toEqual(['ruta-asignada']);
  });
});

describe('construirPuntosControl', () => {
  const pc = (id: string, orden: number, rol: string | null) => ({
    id,
    orden,
    rol,
    coord: { type: 'Point' as const, coordinates: [-66.15 + orden / 1000, -17.39] },
    radioToleranciaM: 30,
  });
  const contexto = {
    puntosControl: [pc('a', 1, null), pc('m', 2, 'espera'), pc('r', 3, 'retorno')],
    puntoEsperaPorVariante: { v1: 'm' },
  } as unknown as ContextoEnVivo;

  it('dibuja el PC de espera sin número cuando la vuelta no lo designa', () => {
    expect(construirPuntosControl(contexto, undefined, null).map((p) => p.label)).toEqual([
      'Punto de control 1',
      'Punto de control 2',
      'Espera Molinos',
    ]);
  });

  it('lo numera dentro del orden efectivo cuando la vuelta lo designa', () => {
    expect(construirPuntosControl(contexto, undefined, 'v1').map((p) => p.label)).toEqual([
      'Punto de control 1',
      'Punto de control 2',
      'Punto de control 3',
    ]);
  });
});
