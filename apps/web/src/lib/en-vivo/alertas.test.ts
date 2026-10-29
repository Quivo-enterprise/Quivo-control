import { describe, expect, it } from 'vitest';
import { reglaInicialSancion, type Infraccion } from '@quivo/shared';
import {
  actualizarPrimeraVez,
  alertaMarcador,
  puedeActuarEnInfracciones,
  contarPorNivel,
  duracionInfraccion,
  filtrarPorNivel,
  ordenarAlertas,
  ordenarInfracciones,
  puedeAtender,
  puedeDescartar,
  puedeSancionar,
  reglasSancionables,
  resumenContadores,
  siguienteAlertaId,
  telefonoParaWhatsapp,
  urlLlamada,
  urlWhatsapp,
  velocidadKmh,
} from './alertas';
import { etiquetaAlerta } from '../../../../../packages/design-system/src/ui/route-map-vehiculo';

const pos = (id: string, nivel: 'leve' | 'grave' | 'gravisima' | null, abiertas = nivel ? 1 : 0, placa = id) => ({
  id,
  vehiculoPlaca: placa,
  infraccionNivel: nivel,
  infraccionesAbiertas: abiertas,
});

describe('contadores y filtro', () => {
  const lista = [pos('a', 'gravisima'), pos('b', 'grave'), pos('c', 'grave'), pos('d', 'leve'), pos('e', null), pos('f', 'leve', 0)];
  it('cuenta vehículos por su nivel máximo y omite abiertas = 0', () => {
    expect(contarPorNivel(lista)).toEqual({ gravisima: 1, grave: 2, leve: 1 });
  });
  it('resumen en español con singular/plural y sin niveles vacíos', () => {
    expect(resumenContadores({ gravisima: 1, grave: 2, leve: 3 })).toBe('1 gravísima · 2 graves · 3 leves');
    expect(resumenContadores({ gravisima: 0, grave: 1, leve: 0 })).toBe('1 grave');
    expect(resumenContadores({ gravisima: 0, grave: 0, leve: 0 })).toBe('');
  });
  it('filtra por nivel o no filtra', () => {
    expect(filtrarPorNivel(lista, 'grave').map((p) => p.id)).toEqual(['b', 'c']);
    expect(filtrarPorNivel(lista, null)).toHaveLength(lista.length);
  });
});

describe('Siguiente alerta', () => {
  const lista = [pos('l1', 'leve', 1, 'AAA'), pos('g1', 'grave', 1, 'BBB'), pos('x', null), pos('s1', 'gravisima', 1, 'CCC'), pos('g2', 'grave', 1, 'DDD')];
  it('ordena por severidad desc y, a igual nivel, la que se vio primero', () => {
    const vistas = new Map([
      ['g1', 2000],
      ['g2', 1000],
    ]);
    expect(ordenarAlertas(lista, vistas).map((p) => p.id)).toEqual(['s1', 'g2', 'g1', 'l1']);
  });
  it('sin dato de antigüedad desempata por placa', () => {
    expect(ordenarAlertas(lista).map((p) => p.id)).toEqual(['s1', 'g1', 'g2', 'l1']);
  });
  it('cicla y arranca por la primera si nada está seleccionado', () => {
    const o = ordenarAlertas(lista);
    expect(siguienteAlertaId(o, null)).toBe('s1');
    expect(siguienteAlertaId(o, 's1')).toBe('g1');
    expect(siguienteAlertaId(o, 'l1')).toBe('s1');
    expect(siguienteAlertaId(o, 'x')).toBe('s1');
    expect(siguienteAlertaId([], null)).toBeNull();
  });
});

describe('infracciones del panel', () => {
  const base = {
    id: '1',
    estado: 'abierta',
    tipo: 'desvio_ruta',
    detalle: { distanciaMaxM: 180.4 },
    inicioTs: new Date('2026-10-13T14:00:00Z'),
    finTs: null,
  } as unknown as Infraccion;
  it('duración solo si cerró', () => {
    expect(duracionInfraccion(base)).toBeNull();
    expect(duracionInfraccion({ ...base, finTs: new Date('2026-10-13T14:12:00Z') })).toBe('12 min');
    expect(duracionInfraccion({ ...base, finTs: new Date('2026-10-13T14:00:45Z') })).toBe('45 s');
  });
  it('desvío, Molinos omitido y PC omitido se pueden sancionar; espera corta es solo alerta', () => {
    expect(puedeSancionar(base)).toBe(true);
    expect(puedeSancionar({ ...base, estado: 'sancionada' })).toBe(false);
    expect(puedeSancionar({ ...base, tipo: 'pc_omitido' })).toBe(true);
    expect(puedeSancionar({ ...base, tipo: 'espera_corta' })).toBe(false);
    expect(puedeSancionar({ ...base, tipo: 'molinos_omitido' })).toBe(true);
  });
  it('atender solo abiertas; descartar abiertas y atendidas', () => {
    expect(puedeAtender({ estado: 'abierta' })).toBe(true);
    expect(puedeAtender({ estado: 'atendida' })).toBe(false);
    expect(puedeDescartar({ estado: 'abierta' })).toBe(true);
    expect(puedeDescartar({ estado: 'atendida' })).toBe(true);
    expect(puedeDescartar({ estado: 'sancionada' })).toBe(false);
    expect(puedeDescartar({ estado: 'descartada' })).toBe(false);
  });
  it('abiertas primero, luego por fecha descendente', () => {
    const a = { ...base, id: 'a', estado: 'atendida', inicioTs: new Date('2026-10-13T15:00:00Z') } as Infraccion;
    const b = { ...base, id: 'b' } as Infraccion;
    const c = { ...base, id: 'c', inicioTs: new Date('2026-10-13T16:00:00Z') } as Infraccion;
    expect(ordenarInfracciones([a, b, c]).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('actualizarPrimeraVez', () => {
  const pos = (id: string, nivel: 'leve' | 'grave' | 'gravisima' | null) => ({
    id,
    infraccionNivel: nivel,
    infraccionesAbiertas: nivel ? 1 : 0,
  });
  it('anota el primer instante, no lo pisa y olvida las alertas cerradas', () => {
    const a = actualizarPrimeraVez(new Map(), [pos('a', 'leve'), pos('b', null)], 100);
    expect([...a]).toEqual([['a', 100]]);
    const b = actualizarPrimeraVez(a, [pos('a', 'leve'), pos('c', 'grave')], 200);
    expect(b.get('a')).toBe(100);
    expect(b.get('c')).toBe(200);
    const c = actualizarPrimeraVez(b, [pos('c', 'grave')], 300);
    expect([...c]).toEqual([['c', 200]]);
  });
  it('devuelve la misma referencia si no cambió nada', () => {
    const a = actualizarPrimeraVez(new Map(), [pos('a', 'leve')], 100);
    expect(actualizarPrimeraVez(a, [pos('a', 'leve')], 999)).toBe(a);
  });
  it('alimenta ordenarAlertas: severidad desc y, a igual nivel, la vista primero', () => {
    const vehiculos = [
      { ...pos('x', 'grave'), vehiculoPlaca: 'XXX' },
      { ...pos('y', 'grave'), vehiculoPlaca: 'AAA' },
      { ...pos('z', 'gravisima'), vehiculoPlaca: 'ZZZ' },
    ];
    // `x` se vio antes que `y` (aunque su placa sea posterior).
    let mapa = actualizarPrimeraVez(new Map(), [vehiculos[0]!], 100);
    mapa = actualizarPrimeraVez(mapa, vehiculos, 200);
    expect(ordenarAlertas(vehiculos, mapa).map((v) => v.id)).toEqual(['z', 'x', 'y']);
  });
});

describe('reglasSancionables (sindicato de la infracción)', () => {
  const ajena = { id: 'rx', tipo: 'desvio_ruta', sindicatoId: 'S2', estado: 'activo' };
  const propia = { id: 'r2', tipo: 'desvio_ruta', sindicatoId: 'S1', estado: 'activo' };
  const inactiva = { id: 'r3', tipo: 'desvio_ruta', sindicatoId: 'S1', estado: 'inactivo' };
  it('descarta reglas de otro sindicato y las inactivas', () => {
    expect(reglasSancionables([ajena, inactiva, propia], 'S1').map((r) => r.id)).toEqual(['r2']);
  });
  it('con una regla de desvío ajena primero, la preselección es la del sindicato propio', () => {
    const reglas = reglasSancionables([ajena, propia], 'S1');
    expect(reglaInicialSancion({ reglaId: null, tipo: 'desvio_ruta' }, reglas)).toBe('r2');
    expect(reglaInicialSancion({ reglaId: 'rx', tipo: 'desvio_ruta' }, reglas)).toBe('r2');
  });
  it('sin regla de desvío propia no hay preselección (nunca la ajena)', () => {
    expect(reglaInicialSancion({ reglaId: null, tipo: 'desvio_ruta' }, reglasSancionables([ajena], 'S1'))).toBeUndefined();
  });
});

describe('velocidad y contacto', () => {
  it('m/s a km/h', () => {
    expect(velocidadKmh(10)).toBe(36);
    expect(velocidadKmh(null)).toBeNull();
    expect(velocidadKmh(-1)).toBeNull();
  });
  it('teléfono boliviano a wa.me y tel:', () => {
    expect(telefonoParaWhatsapp('7123 4567')).toBe('59171234567');
    expect(telefonoParaWhatsapp('+591 71234567')).toBe('59171234567');
    expect(telefonoParaWhatsapp('123')).toBeNull();
    expect(telefonoParaWhatsapp('44123456')).toBeNull();
    expect(telefonoParaWhatsapp('+5491123456789')).toBeNull();
    expect(telefonoParaWhatsapp(null)).toBeNull();
    const url = urlWhatsapp('71234567', { placa: 'ABC123', lineaNombre: 'L16', infraccion: 'Alteración de ruta' });
    expect(url).toContain('https://wa.me/59171234567?text=');
    expect(decodeURIComponent(url!)).toContain('ABC123');
    expect(urlWhatsapp(null, { placa: 'A', lineaNombre: 'B' })).toBeNull();
    expect(urlLlamada('+591 71234567')).toBe('tel:+59171234567');
    expect(urlLlamada('')).toBeNull();
    expect(urlLlamada('44123456')).toBeNull();
    expect(urlLlamada('+5491123456789')).toBeNull();
  });
});

describe('alertaMarcador (pendiente E #1)', () => {
  const base = { infraccionNivel: null, infraccionesAbiertas: 0, infraccionNivelAtendida: null, infraccionesAtendidas: 0 } as const;

  it('sin abiertas ni atendidas no hay ícono', () => {
    expect(alertaMarcador(base)).toBeNull();
    expect(alertaMarcador({})).toBeNull();
  });
  it('solo abiertas: parpadea con su nivel', () => {
    expect(alertaMarcador({ ...base, infraccionNivel: 'grave', infraccionesAbiertas: 2 })).toEqual({
      nivel: 'grave',
      abiertas: 2,
      atendidas: 0,
      parpadea: true,
    });
  });
  it('solo atendidas: ícono fijo (no parpadea) con el nivel de las atendidas', () => {
    expect(alertaMarcador({ ...base, infraccionNivelAtendida: 'gravisima', infraccionesAtendidas: 1 })).toEqual({
      nivel: 'gravisima',
      abiertas: 0,
      atendidas: 1,
      parpadea: false,
    });
  });
  it('abiertas y atendidas: el nivel sale solo de las abiertas y parpadea', () => {
    expect(
      alertaMarcador({
        infraccionNivel: 'leve',
        infraccionesAbiertas: 1,
        infraccionNivelAtendida: 'grave',
        infraccionesAtendidas: 1,
      }),
    ).toEqual({ nivel: 'leve', abiertas: 1, atendidas: 1, parpadea: true });
  });
  it('1 abierta leve + 1 atendida gravísima: marcador leve que parpadea (la atendida no infla el nivel)', () => {
    const a = alertaMarcador({
      infraccionNivel: 'leve',
      infraccionesAbiertas: 1,
      infraccionNivelAtendida: 'gravisima',
      infraccionesAtendidas: 1,
    });
    expect(a).toEqual({ nivel: 'leve', abiertas: 1, atendidas: 1, parpadea: true });
    // El nombre accesible del marcador se arma de este nivel (`etiquetaAlerta` del design-system).
    expect(etiquetaAlerta(a!)).toContain('leve');
  });
  it('un nivel sin cantidad (dato inconsistente) se ignora', () => {
    expect(alertaMarcador({ ...base, infraccionNivel: 'grave', infraccionesAbiertas: 0 })).toBeNull();
    expect(alertaMarcador({ ...base, infraccionNivelAtendida: 'leve', infraccionesAtendidas: 0 })).toBeNull();
  });
});

describe('puedeActuarEnInfracciones', () => {
  it('admins sí; operador y roles desconocidos no', () => {
    expect(puedeActuarEnInfracciones('admin_quivo')).toBe(true);
    expect(puedeActuarEnInfracciones('admin_sindicato')).toBe(true);
    expect(puedeActuarEnInfracciones('operador')).toBe(false);
    expect(puedeActuarEnInfracciones('conductor')).toBe(false);
    expect(puedeActuarEnInfracciones(undefined)).toBe(false);
  });
});
