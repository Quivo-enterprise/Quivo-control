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
  esCacheDesactualizado,
  esErrorAcusePermanente,
  marcarAnunciada,
  notificacionesObsoletas,
  partesAvisoDesignada,
  rearmarFila,
  respuestaConFila,
  respuestasIguales,
  MARGEN_ESPERA_MIN,
  pastillaEspera,
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

describe('salida libre (esperaMin null)', () => {
  it('el texto no menciona espera', () => {
    expect(textoAvisoDesignada(null)).toBe('Esta vuelta: vía Molinos. Después de Honduras subí por Putucu.');
    expect(textoAvisoDesignada(30)).toContain('esperá 30 minutos');
  });
});

describe('pastillaEspera', () => {
  const desde = '2026-10-14T13:00:00.000Z';
  const t = Date.parse(desde);
  it('con minutos de espera: cuenta regresiva (la posición no cambia nada)', () => {
    expect(pastillaEspera(30, desde, t, 3)).toEqual({ texto: 'Podés salir en 31 min', listo: false });
    expect(pastillaEspera(30, desde, t + 40 * 60_000, undefined)).toEqual({ texto: 'Ya podés salir', listo: true });
  });
  it('salida libre: lugar en la cola', () => {
    expect(pastillaEspera(null, desde, t, 1)).toEqual({ texto: 'Es tu turno. Podés salir', listo: true });
    expect(pastillaEspera(null, desde, t, 3)).toEqual({
      texto: 'Sos el 3.º en Molinos. Salís después del que está adelante.',
      listo: false,
    });
  });
  it('salida libre sin posición (servidor viejo): sin pastilla', () => {
    expect(pastillaEspera(null, desde, t, undefined)).toBeNull();
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

describe('vuelta cerrada localmente', () => {
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
});

describe('fila de salida en el cache', () => {
  const FILA = {
    posicion: 2,
    total: 4,
    delantePlaca: '1234ABC',
    etaTs: '2026-10-20T11:10:00.000Z',
    esperaMs: 300_000,
    habilitado: false,
    demorado: false,
    servidorTs: '2026-10-20T11:05:00.000Z',
  };
  const conFila = (servidorTs = FILA.servidorTs): VueltaActualMovil => ({
    ...vuelta(V1, null),
    fila: { ...FILA, servidorTs },
  });

  // El servidor dice explícitamente que ya no está en la fila.
  const sinFilaNull = (): VueltaActualMovil => ({ ...vuelta(V1, null), fila: null });

  it('solo cambia servidorTs: no es cambio, conserva la referencia y no reescribe', () => {
    const a = aplicarRespuesta(ESTADO_LOCAL_INICIAL, conFila(), { ahoraMs: 1_000 });
    expect(a.estado.ultimo?.fila?.posicion).toBe(2);
    // servidorTs 20 s después, recibido 20 s después: mismo desfase
    const b = aplicarRespuesta(a.estado, conFila('2026-10-20T11:05:20.000Z'), { ahoraMs: 21_000 });
    expect(b.cambio).toBe(false);
    expect(b.estado).toBe(a.estado);
    expect(respuestasIguales(a.estado.ultimo, conFila('2026-10-20T11:05:20.000Z'))).toBe(true);
  });

  it('el desfase solo se persiste de nuevo si varía más de 1 s', () => {
    const base = Date.parse(FILA.servidorTs);
    const a = aplicarRespuesta(ESTADO_LOCAL_INICIAL, conFila(), { ahoraMs: base - 90_000 });
    expect(a.estado.desfaseFilaMs).toBe(90_000);
    const poco = aplicarRespuesta(a.estado, conFila(), { ahoraMs: base - 90_500 });
    expect(poco.cambio).toBe(false);
    const mucho = aplicarRespuesta(a.estado, conFila(), { ahoraMs: base - 92_000 });
    expect(mucho.cambio).toBe(true);
    expect(mucho.estado.desfaseFilaMs).toBe(92_000);
    expect(mucho.estado.ultimo).toBe(a.estado.ultimo);
    // sin fila (null explícito) se olvida
    expect(
      aplicarRespuesta(a.estado, sinFilaNull(), { ahoraMs: 5 }).estado.desfaseFilaMs,
    ).toBeUndefined();
  });

  it('una respuesta SIN el campo fila (acuse) conserva fila y desfase y no desarma', () => {
    const enFila = aplicarRespuesta(ESTADO_LOCAL_INICIAL, conFila(), { ahoraMs: 1_000 }).estado;
    const sinFila: VueltaActualMovil = { ...conFila(), fila: undefined };
    const r = aplicarRespuesta(enFila, sinFila, { ahoraMs: 2_000 });
    expect(r.estado.ultimo?.fila).toEqual(enFila.ultimo?.fila);
    expect(r.estado.desfaseFilaMs).toBe(enFila.desfaseFilaMs);
    expect(r.estado.filaDesarmada).toBe(false);
    // y si ya estaba desarmada, sigue igual
    const desarmado = { ...ESTADO_LOCAL_INICIAL, filaDesarmada: true };
    expect(aplicarRespuesta(desarmado, sinFila, { ahoraMs: 3_000 }).estado.filaDesarmada).toBe(
      true,
    );
  });

  it('respuestaConFila: la fila de un POST se incorpora como una respuesta (null = salió)', () => {
    const enFila = aplicarRespuesta(ESTADO_LOCAL_INICIAL, conFila(), { ahoraMs: 1_000 }).estado;
    const salio = aplicarRespuesta(enFila, respuestaConFila(enFila.ultimo, null), {
      ahoraMs: 2_000,
    }).estado;
    expect(salio.ultimo?.fila).toBeNull();
    expect(salio.filaDesarmada).toBe(true);
    expect(salio.desfaseFilaMs).toBeUndefined();
    expect(salio.ultimo?.vueltaId).toBe(enFila.ultimo?.vueltaId);
    // sin vuelta conocida todavía, igual se guarda la fila
    const sola = aplicarRespuesta(
      ESTADO_LOCAL_INICIAL,
      respuestaConFila(null, conFila().fila ?? null),
      {
        ahoraMs: 3_000,
      },
    ).estado;
    expect(sola.ultimo?.fila?.posicion).toBe(2);
    expect(sola.ultimo?.vueltaId).toBeNull();
  });

  it('salir de la fila desarma la llegada automatica; tener fila otra vez la rearma', () => {
    const enFila = aplicarRespuesta(ESTADO_LOCAL_INICIAL, conFila(), { ahoraMs: 1_000 }).estado;
    expect(enFila.filaDesarmada).toBe(false);
    const salio = aplicarRespuesta(enFila, sinFilaNull(), { ahoraMs: 2_000 }).estado;
    expect(salio.filaDesarmada).toBe(true);
    expect(aplicarRespuesta(salio, sinFilaNull(), { ahoraMs: 3_000 }).estado.filaDesarmada).toBe(true);
    expect(aplicarRespuesta(salio, conFila(), { ahoraMs: 4_000 }).estado.filaDesarmada).toBe(false);
  });

  it('sin fila previa no se desarma; rearmarFila limpia la marca', () => {
    expect(aplicarRespuesta(ESTADO_LOCAL_INICIAL, sinFilaNull(), { ahoraMs: 1 }).estado.filaDesarmada).toBe(false);
    const desarmado: EstadoLocalVuelta = { ...ESTADO_LOCAL_INICIAL, filaDesarmada: true };
    expect(rearmarFila(desarmado).filaDesarmada).toBe(false);
    expect(rearmarFila(ESTADO_LOCAL_INICIAL)).toBe(ESTADO_LOCAL_INICIAL);
  });
});
