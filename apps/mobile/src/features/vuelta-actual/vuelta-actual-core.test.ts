import { describe, expect, it } from 'vitest';
import type { VueltaActualMovil } from '@quivo/shared';
import {
  ESTADO_LOCAL_INICIAL,
  MAX_INTENTOS_ANUNCIO,
  abandonarAcuse,
  acusePendiente,
  aplicarRespuesta,
  cerrarCancelacion,
  cerrarDesignacion,
  claveDesignacion,
  coordenadasTramo,
  decidirAvisos,
  designacionPendienteDeAviso,
  designacionVigente,
  resolverEstadoParaRecorrido,
  esCacheDesactualizado,
  esErrorAcusePermanente,
  marcarAnunciada,
  notificacionesObsoletas,
  partesAvisoDesignada,
  reiniciarEstadoRecorrido,
  respuestasIguales,
  MARGEN_ESPERA_MIN,
  restanteEsperaMin,
  textoAvisoDesignada,
  textoContadorEspera,
  type EstadoLocalVuelta,
} from './vuelta-actual-core';

const V1 = '3f8d3c1e-7a52-4f0b-9a3e-1c2d4e5f6a7b';
const V2 = '4a9e4d2f-8b63-4a1c-8b4f-2d3e5f6a7b8c';
const DESIGNADA_EN = '2026-10-14T13:05:00.000Z';

function vuelta(
  vueltaId: string | null,
  designacion: { designadaEn: string; acuseEn?: string | null } | null,
  enEspera: { desdeTs: string } | null = null,
): VueltaActualMovil {
  return {
    vueltaId,
    numero: vueltaId ? 1 : null,
    designacion: designacion
      ? {
          varianteId: '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d',
          nombre: 'Vía Molinos',
          designadaEn: designacion.designadaEn,
          acuseEn: designacion.acuseEn ?? null,
          tramo: null,
          puntoEspera: {
            id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
            coord: { type: 'Point', coordinates: [-66.15, -17.38] },
            esperaMin: 30,
          },
        }
      : null,
    enEspera,
  };
}

describe('claveDesignacion', () => {
  it('une vuelta e instante; null sin alguno', () => {
    expect(claveDesignacion(V1, { designadaEn: DESIGNADA_EN })).toBe(`${V1}|${DESIGNADA_EN}`);
    expect(claveDesignacion(null, { designadaEn: DESIGNADA_EN })).toBeNull();
    expect(claveDesignacion(V1, null)).toBeNull();
  });
});

describe('decidirAvisos', () => {
  it('designación nueva sin acuse -> "designada" con la espera', () => {
    const avisos = decidirAvisos(vuelta(V1, null), vuelta(V1, { designadaEn: DESIGNADA_EN }), []);
    expect(avisos).toEqual([{ tipo: 'designada', clave: `${V1}|${DESIGNADA_EN}`, esperaMin: 30 }]);
  });

  it('primera respuesta (sin estado anterior) también avisa', () => {
    const avisos = decidirAvisos(null, vuelta(V1, { designadaEn: DESIGNADA_EN }), []);
    expect(avisos).toHaveLength(1);
  });

  it('designación cambiada (otro designadaEn) vuelve a avisar', () => {
    const otra = '2026-10-14T13:20:00.000Z';
    const avisos = decidirAvisos(
      vuelta(V1, { designadaEn: DESIGNADA_EN }),
      vuelta(V1, { designadaEn: otra }),
      [`${V1}|${DESIGNADA_EN}`],
    );
    expect(avisos).toEqual([{ tipo: 'designada', clave: `${V1}|${otra}`, esperaMin: 30 }]);
  });

  it('no repite un aviso ya anunciado', () => {
    const nuevo = vuelta(V1, { designadaEn: DESIGNADA_EN });
    expect(decidirAvisos(nuevo, nuevo, [`${V1}|${DESIGNADA_EN}`])).toEqual([]);
  });

  it('no avisa si el servidor ya tiene el acuse', () => {
    const nuevo = vuelta(V1, { designadaEn: DESIGNADA_EN, acuseEn: '2026-10-14T13:06:00.000Z' });
    expect(decidirAvisos(null, nuevo, [])).toEqual([]);
  });

  it('misma vuelta: con designación antes y null ahora -> "cancelada"', () => {
    const clave = `${V1}|${DESIGNADA_EN}`;
    const avisos = decidirAvisos(
      vuelta(V1, { designadaEn: DESIGNADA_EN }),
      vuelta(V1, null),
      [clave],
    );
    expect(avisos).toEqual([{ tipo: 'cancelada', clave: `cancelada|${clave}` }]);
  });

  it('cambió la vuelta (cierre natural en SR): NO es cancelación', () => {
    const avisos = decidirAvisos(
      vuelta(V1, { designadaEn: DESIGNADA_EN }),
      vuelta(V2, null),
      [`${V1}|${DESIGNADA_EN}`],
    );
    expect(avisos).toEqual([]);
  });

  it('no repite la cancelación ya anunciada', () => {
    const clave = `${V1}|${DESIGNADA_EN}`;
    const avisos = decidirAvisos(
      vuelta(V1, { designadaEn: DESIGNADA_EN }),
      vuelta(V1, null),
      [clave, `cancelada|${clave}`],
    );
    expect(avisos).toEqual([]);
  });

  it('no cancela lo que el chofer nunca vio anunciado', () => {
    const avisos = decidirAvisos(vuelta(V1, { designadaEn: DESIGNADA_EN }), vuelta(V1, null), []);
    expect(avisos).toEqual([]);
  });

  it('sin vuelta todavía: sin avisos', () => {
    expect(decidirAvisos(null, vuelta(null, null), [])).toEqual([]);
  });
});

const T0 = Date.parse('2026-10-14T13:10:00.000Z');
const CLAVE = `${V1}|${DESIGNADA_EN}`;

/** Aplica la respuesta y, si el anuncio "salió bien", marca las claves anunciadas. */
function aplicarYAnunciar(estado: EstadoLocalVuelta, nuevo: VueltaActualMovil, ahoraMs = T0) {
  const r = aplicarRespuesta(estado, nuevo, { ahoraMs });
  let e = r.estado;
  for (const a of r.avisos) e = marcarAnunciada(e, a.clave);
  return { ...r, estado: e };
}

describe('aplicarRespuesta + persistencia lógica', () => {
  it('marcarAnunciada: la segunda respuesta igual no avisa', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN }));
    expect(r1.avisos).toHaveLength(1);
    expect(r1.estado.anunciadas).toEqual([CLAVE]);
    const r2 = aplicarRespuesta(r1.estado, vuelta(V1, { designadaEn: DESIGNADA_EN }), { ahoraMs: T0 + 1000 });
    expect(r2.avisos).toEqual([]);
  });

  it('sobrevive a un reinicio: el estado serializado no repite el aviso', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN }));
    const restaurado = JSON.parse(JSON.stringify(r1.estado)) as EstadoLocalVuelta;
    expect(aplicarRespuesta(restaurado, vuelta(V1, { designadaEn: DESIGNADA_EN }), { ahoraMs: T0 }).avisos).toEqual([]);
  });

  it('la cancelación queda pendiente hasta "Entendido"', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN }));
    const r2 = aplicarRespuesta(r1.estado, vuelta(V1, null), { ahoraMs: T0 });
    expect(r2.estado.cancelacionPendiente).toBe(`cancelada|${CLAVE}`);
    expect(cerrarCancelacion(r2.estado).cancelacionPendiente).toBeNull();
  });

  it('una designación NUEVA (clave distinta) limpia la cancelación pendiente', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN }));
    const r2 = aplicarYAnunciar(r1.estado, vuelta(V1, null));
    expect(r2.estado.cancelacionPendiente).not.toBeNull();
    const r3 = aplicarRespuesta(r2.estado, vuelta(V1, { designadaEn: '2026-10-14T13:30:00.000Z' }), {
      ahoraMs: T0,
    });
    expect(r3.estado.cancelacionPendiente).toBeNull();
    expect(r3.avisos).toEqual([
      { tipo: 'designada', clave: `${V1}|2026-10-14T13:30:00.000Z`, esperaMin: 30 },
    ]);
  });

  it('recorta las claves a un tope', () => {
    let estado = ESTADO_LOCAL_INICIAL;
    for (let i = 0; i < 50; i += 1) {
      estado = aplicarYAnunciar(
        estado,
        vuelta(V1, { designadaEn: `2026-10-14T13:${String(i).padStart(2, '0')}:00.000Z` }),
      ).estado;
    }
    expect(estado.anunciadas.length).toBeLessThanOrEqual(30);
  });
});

describe('anuncio fallido: reintento con tope', () => {
  const designada = () => vuelta(V1, { designadaEn: DESIGNADA_EN });

  it('si el anuncio falla (no se marca), las consultas siguientes lo reintentan hasta el tope', () => {
    let estado = ESTADO_LOCAL_INICIAL;
    let emitidos = 0;
    for (let i = 0; i < MAX_INTENTOS_ANUNCIO + 3; i += 1) {
      const r = aplicarRespuesta(estado, designada(), { ahoraMs: T0 + i * 20_000 });
      emitidos += r.avisos.length;
      estado = r.estado; // el anuncio falló: nunca se llama a marcarAnunciada
    }
    expect(emitidos).toBe(MAX_INTENTOS_ANUNCIO);
    expect(estado.anunciadas).toEqual([]);
  });

  it('un reintento exitoso deja de reintentar y limpia el contador', () => {
    const r1 = aplicarRespuesta(ESTADO_LOCAL_INICIAL, designada(), { ahoraMs: T0 }); // falla
    const r2 = aplicarRespuesta(r1.estado, designada(), { ahoraMs: T0 + 20_000 });
    expect(r2.avisos).toHaveLength(1);
    const ok = marcarAnunciada(r2.estado, CLAVE);
    expect(ok.anunciadas).toEqual([CLAVE]);
    expect(ok.intentosAnuncio).toEqual({});
    expect(aplicarRespuesta(ok, designada(), { ahoraMs: T0 + 40_000 }).avisos).toEqual([]);
  });

  it('la cancelación cuyo anuncio falló también se reintenta', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, designada());
    const r2 = aplicarRespuesta(r1.estado, vuelta(V1, null), { ahoraMs: T0 }); // falla el anuncio
    expect(r2.avisos).toEqual([{ tipo: 'cancelada', clave: `cancelada|${CLAVE}` }]);
    const r3 = aplicarRespuesta(r2.estado, vuelta(V1, null), { ahoraMs: T0 + 20_000 });
    expect(r3.avisos).toEqual([{ tipo: 'cancelada', clave: `cancelada|${CLAVE}` }]);
  });
});

describe('respuesta idéntica: sin cambio', () => {
  const designada = () => vuelta(V1, { designadaEn: DESIGNADA_EN });

  it('no cambia ni reescribe: devuelve el mismo estado', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, designada());
    const r2 = aplicarRespuesta(r1.estado, designada(), { ahoraMs: T0 + 20_000 });
    expect(r2.cambio).toBe(false);
    expect(r2.estado).toBe(r1.estado);
  });

  it('la marca actualizadoEn se refresca pasados 2 min y conserva la referencia de "ultimo"', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, designada());
    const r2 = aplicarRespuesta(r1.estado, designada(), { ahoraMs: T0 + 3 * 60_000 });
    expect(r2.cambio).toBe(true);
    expect(r2.estado.actualizadoEn).toBe(T0 + 3 * 60_000);
    expect(r2.estado.ultimo).toBe(r1.estado.ultimo);
  });

  it('un cambio de contenido sí cambia (acuse, espera, tramo)', () => {
    const r1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, designada());
    expect(
      aplicarRespuesta(r1.estado, vuelta(V1, { designadaEn: DESIGNADA_EN, acuseEn: '2026-10-14T13:06:00.000Z' }), {
        ahoraMs: T0,
      }).cambio,
    ).toBe(true);
    expect(
      aplicarRespuesta(r1.estado, vuelta(V1, { designadaEn: DESIGNADA_EN }, { desdeTs: '2026-10-14T13:08:00.000Z' }), {
        ahoraMs: T0,
      }).cambio,
    ).toBe(true);
  });

  it('respuestasIguales compara el tramo por contenido', () => {
    const conTramo = (coords: [number, number][]): VueltaActualMovil => {
      const v = vuelta(V1, { designadaEn: DESIGNADA_EN });
      return { ...v, designacion: v.designacion && { ...v.designacion, tramo: { type: 'LineString', coordinates: coords } } };
    };
    expect(respuestasIguales(conTramo([[1, 2], [3, 4]]), conTramo([[1, 2], [3, 4]]))).toBe(true);
    expect(respuestasIguales(conTramo([[1, 2], [3, 4]]), conTramo([[1, 2], [3, 5]]))).toBe(false);
    expect(respuestasIguales(conTramo([[1, 2], [3, 4]]), conTramo([[1, 2]]))).toBe(false);
    expect(respuestasIguales(null, vuelta(V1, null))).toBe(false);
  });
});

describe('cache desactualizado', () => {
  const base = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN })).estado;

  it('fresco hasta 15 min; pasado ese tope, desactualizado', () => {
    expect(esCacheDesactualizado(base, T0 + 15 * 60_000)).toBe(false);
    expect(esCacheDesactualizado(base, T0 + 15 * 60_000 + 1)).toBe(true);
  });
  it('sin respuesta guardada no hay nada que envejecer; marca ausente (cache viejo) = desactualizado', () => {
    expect(esCacheDesactualizado(ESTADO_LOCAL_INICIAL, T0)).toBe(false);
    expect(esCacheDesactualizado({ ...base, actualizadoEn: null }, T0)).toBe(true);
  });
  it('reiniciarEstadoRecorrido descarta la respuesta y conserva las claves ya vistas', () => {
    const cerrado = cerrarDesignacion(base);
    const r = reiniciarEstadoRecorrido(cerrado);
    expect(r.ultimo).toBeNull();
    expect(r.actualizadoEn).toBeNull();
    expect(r.anunciadas).toEqual([CLAVE]);
    expect(r.cerradas).toEqual([CLAVE]);
  });
});

describe('acuse: errores permanentes y notificaciones obsoletas', () => {
  const http = (status: number) => ({ kind: 'http', status });
  it('4xx permanente corta; 401/408/429, 5xx y red reintentan', () => {
    expect(esErrorAcusePermanente(http(400))).toBe(true);
    expect(esErrorAcusePermanente(http(403))).toBe(true);
    expect(esErrorAcusePermanente(http(404))).toBe(true);
    expect(esErrorAcusePermanente(http(401))).toBe(false);
    expect(esErrorAcusePermanente(http(408))).toBe(false);
    expect(esErrorAcusePermanente(http(429))).toBe(false);
    expect(esErrorAcusePermanente(http(500))).toBe(false);
    expect(esErrorAcusePermanente({ kind: 'network' })).toBe(false);
    expect(esErrorAcusePermanente(null)).toBe(false);
  });
  it('un acuse abandonado deja de ser pendiente', () => {
    const cerrado = cerrarDesignacion(
      aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN })).estado,
    );
    expect(acusePendiente(cerrado)).not.toBeNull();
    expect(acusePendiente(abandonarAcuse(cerrado, CLAVE))).toBeNull();
  });
  it('notificacionesObsoletas: acuse desde otro lado, cancelación y re-designación', () => {
    const e1 = aplicarYAnunciar(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN })).estado;
    const acusada = aplicarRespuesta(
      e1,
      vuelta(V1, { designadaEn: DESIGNADA_EN, acuseEn: '2026-10-14T13:06:00.000Z' }),
      { ahoraMs: T0 },
    ).estado;
    expect(notificacionesObsoletas(e1, acusada)).toEqual([`designacion|${CLAVE}`]);
    const cancelada = aplicarYAnunciar(e1, vuelta(V1, null)).estado;
    expect(notificacionesObsoletas(e1, cancelada)).toEqual([`designacion|${CLAVE}`]);
    const nueva = aplicarRespuesta(cancelada, vuelta(V1, { designadaEn: '2026-10-14T13:30:00.000Z' }), {
      ahoraMs: T0,
    }).estado;
    expect(notificacionesObsoletas(cancelada, nueva)).toEqual([`cancelada|${CLAVE}`]);
    expect(notificacionesObsoletas(e1, e1)).toEqual([]);
  });
});

describe('tarjeta pendiente y acuse', () => {
  const base = aplicarRespuesta(ESTADO_LOCAL_INICIAL, vuelta(V1, { designadaEn: DESIGNADA_EN }), { ahoraMs: T0 }).estado;

  it('la tarjeta persiste mientras no haya acuse ni cierre local', () => {
    expect(designacionPendienteDeAviso(base)?.nombre).toBe('Vía Molinos');
    expect(acusePendiente(base)).toBeNull();
  });

  it('"Entendido" cierra la tarjeta y deja el acuse pendiente hasta que el servidor lo confirme', () => {
    const cerrado = cerrarDesignacion(base);
    expect(designacionPendienteDeAviso(cerrado)).toBeNull();
    expect(acusePendiente(cerrado)).toEqual({ vueltaId: V1, designadaEn: DESIGNADA_EN });
    // El servidor devuelve acuseEn: ya no hay nada que reintentar.
    const confirmado = aplicarRespuesta(
      cerrado,
      vuelta(V1, { designadaEn: DESIGNADA_EN, acuseEn: '2026-10-14T13:06:00.000Z' }),
      { ahoraMs: T0 },
    ).estado;
    expect(acusePendiente(confirmado)).toBeNull();
    expect(designacionPendienteDeAviso(confirmado)).toBeNull();
  });

  it('una designación NUEVA reabre la tarjeta aunque la anterior se cerró', () => {
    const cerrado = cerrarDesignacion(base);
    const otra = aplicarRespuesta(cerrado, vuelta(V1, { designadaEn: '2026-10-14T14:00:00.000Z' }), { ahoraMs: T0 }).estado;
    expect(designacionPendienteDeAviso(otra)).not.toBeNull();
  });

  it('sin designación no hay nada que cerrar', () => {
    expect(cerrarDesignacion(ESTADO_LOCAL_INICIAL)).toBe(ESTADO_LOCAL_INICIAL);
  });
});

describe('restanteEsperaMin', () => {
  const desde = '2026-10-14T13:00:00.000Z';
  const t = Date.parse(desde);
  it('espera completa más el margen de 1 min al llegar', () => {
    expect(restanteEsperaMin(30, desde, t)).toBe(30 + MARGEN_ESPERA_MIN);
  });
  it('redondea hacia arriba', () => {
    expect(restanteEsperaMin(30, desde, t + 11 * 60_000 + 1_000)).toBe(20);
    expect(restanteEsperaMin(30, desde, t + 30 * 60_000 + 59_000)).toBe(1);
  });
  it('a los 30 min todavía falta el margen; piso 0 a los 31 y después', () => {
    expect(restanteEsperaMin(30, desde, t + 30 * 60_000)).toBe(1);
    expect(restanteEsperaMin(30, desde, t + 31 * 60_000)).toBe(0);
    expect(restanteEsperaMin(30, desde, t + 90 * 60_000)).toBe(0);
  });
  it('reloj atrasado respecto de desdeTs: no pasa de la espera + margen', () => {
    expect(restanteEsperaMin(30, desde, t - 5 * 60_000)).toBe(31);
  });
  it('desdeTs inválido: espera completa + margen', () => {
    expect(restanteEsperaMin(30, 'basura', t)).toBe(31);
  });
});

describe('textos y tramo', () => {
  it('el aviso sale de una sola fuente: voz con "minutos", tarjeta con "min"', () => {
    expect(textoAvisoDesignada(30)).toBe(
      'Esta vuelta: vía Molinos. Después de Honduras subí por Putucu y esperá 30 minutos.',
    );
    const p = partesAvisoDesignada(30, 'min');
    expect(`${p.antes}${p.destacado}${p.despues}`).toBe(
      'Esta vuelta: vía Molinos. Después de Honduras subí por Putucu y esperá 30 min.',
    );
  });
  it('contador', () => {
    expect(textoContadorEspera(18)).toBe('Podés salir en 18 min');
    expect(textoContadorEspera(0)).toBe('Ya podés salir');
  });
  it('coordenadasTramo invierte [lng,lat] y exige 2 puntos', () => {
    expect(coordenadasTramo(null)).toEqual([]);
    expect(coordenadasTramo({ type: 'LineString', coordinates: [[-66, -17]] })).toEqual([]);
    expect(
      coordenadasTramo({ type: 'LineString', coordinates: [[-66.1, -17.1], [-66.2, -17.2]] }),
    ).toEqual([
      { latitude: -17.1, longitude: -66.1 },
      { latitude: -17.2, longitude: -66.2 },
    ]);
  });
});

describe('vuelta cerrada localmente y lectura por recorrido', () => {
  const V = '3f8d3c1e-7a52-4f0b-9a3e-1c2d4e5f6a7b';
  const conDesignacion = (vueltaId: string): VueltaActualMovil => ({
    vueltaId,
    numero: 1,
    enEspera: null,
    designacion: {
      varianteId: '9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d',
      nombre: 'Vía Molinos',
      designadaEn: '2026-10-14T13:05:00.000Z',
      acuseEn: null,
      tramo: null,
      puntoEspera: {
        id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
        coord: { type: 'Point', coordinates: [-66.15, -17.38] },
        esperaMin: 30,
      },
    },
  });

  it('designacionVigente = designación del cache, sin supresión local', () => {
    expect(designacionVigente({ ...ESTADO_LOCAL_INICIAL, ultimo: conDesignacion(V) })).not.toBeNull();
    expect(designacionVigente(ESTADO_LOCAL_INICIAL)).toBeNull();
  });

  it('resolverEstadoParaRecorrido: otro recorrido o ninguno = vacío; sin id viejo = adopta', () => {
    const e = { ...ESTADO_LOCAL_INICIAL, ultimo: conDesignacion(V), anunciadas: ['x'], recorridoId: 'r1' };
    expect(resolverEstadoParaRecorrido(e, 'r1')).toBe(e);
    expect(resolverEstadoParaRecorrido(e, 'r2').ultimo).toBeNull();
    expect(resolverEstadoParaRecorrido(e, 'r2').anunciadas).toEqual(['x']);
    expect(resolverEstadoParaRecorrido(e, null).ultimo).toBeNull();
    const vieja = { ...e, recorridoId: null };
    expect(resolverEstadoParaRecorrido(vieja, 'r2')).toEqual({ ...vieja, recorridoId: 'r2' });
  });
});
