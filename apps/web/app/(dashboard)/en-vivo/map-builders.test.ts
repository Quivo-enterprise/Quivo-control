import { describe, expect, it } from 'vitest';
import type { PosicionEnVivo } from '@quivo/shared';
import { construirMarcadoresVehiculos, filtrarPorLinea, idMarcadorVehiculo } from './map-builders';

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

describe('filtrarPorLinea', () => {
  const z12 = posicion({ id: 's1', lineaId: 'z12' });
  const l120 = posicion({ id: 's2', lineaId: 'l120' });
  const todas = [z12, l120];

  it('con lineaId vacío ("Todas las líneas") devuelve la lista completa sin filtrar', () => {
    expect(filtrarPorLinea(todas, '')).toEqual(todas);
  });

  it('filtra solo los vehículos de la línea pedida', () => {
    expect(filtrarPorLinea(todas, 'z12')).toEqual([z12]);
    expect(filtrarPorLinea(todas, 'l120')).toEqual([l120]);
  });

  it('una línea sin vehículos activos devuelve un array vacío, no undefined/null', () => {
    expect(filtrarPorLinea(todas, 'linea-inexistente')).toEqual([]);
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
