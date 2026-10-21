import { describe, expect, it } from 'vitest';
import type { PuntoTrazaGps, TrazaEnVivo } from '@quivo/shared';
import {
  antiguedadViva,
  clavePunto,
  COOLDOWN_RECARGA_MS,
  debeRecargar,
  desdeConSolape,
  formatearAntiguedad,
  fusionarTraza,
  intervaloPoll,
  necesitaRecargaCompleta,
  offsetRelojServidorMs,
  presentacionFrescura,
  PRESENTACION_FRESCURA,
  SOLAPE_CURSOR_CORTO_MS,
  SOLAPE_CURSOR_MS,
  UMBRAL_CORTE_POLL_MS,
  INTERVALO_POLL_FINALIZADO_MS,
  INTERVALO_POLL_MS,
  INTERVALO_POLL_RAPIDO_MS,
  type TrazaAcumulada,
} from './traza.js';

/** Instante fijo de referencia para las comparaciones de cooldown (arbitrario, coherente con
 * los `ts` de los puntos usados en el resto del archivo). */
const AHORA_BASE_MS = Date.parse('2026-08-18T13:00:00.000Z');

function punto(ts: string, lat = -17.38, lng = -66.15): PuntoTrazaGps {
  return { ts, lat, lng, accuracy: 8, speed: 5 };
}

function respuesta(overrides: Partial<TrazaEnVivo> = {}): TrazaEnVivo {
  return {
    puntos: [],
    cursor: null,
    hayMas: false,
    totalPuntos: 0,
    cumplimientos: [],
    sesionFin: null,
    sesionEstado: 'activa',
    ultimoFixTs: null,
    ultimoIngresoTs: null,
    servidorTs: '2026-08-18T14:00:00.000Z',
    antiguedadFixMs: null,
    antiguedadIngestaMs: null,
    inactivaDesdeMs: 0,
    estadoFrescura: 'sin_datos',
    // Fase A (docs/plan-ubicacion-fluida.md) — solo no-null cuando `estadoFrescura ===
    // 'finalizado'` (contrato de `derivarFrescura`); el default acá es consistente con el
    // default de `estadoFrescura` de arriba (`sin_datos`, no `finalizado`).
    recorridoFinTs: null,
    ...overrides,
  };
}

describe('fusionarTraza (merge del delta contra la cache)', () => {
  it('sin puntos nuevos conserva la referencia del array de puntos (y refresca el resto)', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    const fusionada = fusionarTraza(
      previa,
      respuesta({
        puntos: [punto('2026-08-18T13:00:00.000Z')],
        totalPuntos: 1,
        estadoFrescura: 'reportando',
      }),
    );
    expect(fusionada.puntos).toBe(previa.puntos);
    expect(fusionada.estadoFrescura).toBe('reportando');
    const conNuevo = fusionarTraza(
      previa,
      respuesta({ puntos: [punto('2026-08-18T13:01:00.000Z')], totalPuntos: 2 }),
    );
    expect(conNuevo.puntos).not.toBe(previa.puntos);
    expect(conNuevo.puntos).toHaveLength(2);
  });

  it('acumula el delta sobre lo que ya había', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    const fusionada = fusionarTraza(
      previa,
      respuesta({ puntos: [punto('2026-08-18T13:00:20.000Z')], totalPuntos: 2 }),
    );

    expect(fusionada.puntos.map((p) => p.ts)).toEqual([
      '2026-08-18T13:00:00.000Z',
      '2026-08-18T13:00:20.000Z',
    ]);
    expect(fusionada.cursor).toBe('2026-08-18T13:00:20.000Z');
  });

  it('deduplica por ts|lat|lng: reaplicar el mismo delta no cambia nada (idempotente)', () => {
    const delta = respuesta({
      puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:00:20.000Z')],
      totalPuntos: 2,
    });
    const unaVez = fusionarTraza(undefined, delta);
    const dosVeces = fusionarTraza(unaVez, delta);

    expect(dosVeces.puntos).toHaveLength(2);
    expect(dosVeces.cursor).toBe(unaVez.cursor);
  });

  it('distingue dos fixes con el mismo ts pero coordenadas distintas', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [
          punto('2026-08-18T13:00:00.000Z', -17.38, -66.15),
          punto('2026-08-18T13:00:00.000Z', -17.39, -66.16),
        ],
        totalPuntos: 2,
      }),
    );

    expect(fusionada.puntos).toHaveLength(2);
    expect(clavePunto(fusionada.puntos[0] as PuntoTrazaGps)).not.toBe(
      clavePunto(fusionada.puntos[1] as PuntoTrazaGps),
    );
  });

  it('reordena las ráfagas post-Doze: un punto con ts viejo entra en su lugar cronológico', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({
        puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:02:00.000Z')],
        totalPuntos: 2,
      }),
    );
    // El solape de 2 min hace que el server devuelva un fix capturado ANTES del último
    // dibujado (llegó tarde al servidor). Sin el sort, la polilínea saltaría hacia atrás.
    const fusionada = fusionarTraza(
      previa,
      respuesta({ puntos: [punto('2026-08-18T13:01:00.000Z', -17.385)], totalPuntos: 3 }),
    );

    expect(fusionada.puntos.map((p) => p.ts)).toEqual([
      '2026-08-18T13:00:00.000Z',
      '2026-08-18T13:01:00.000Z',
      '2026-08-18T13:02:00.000Z',
    ]);
    expect(fusionada.cursor).toBe('2026-08-18T13:02:00.000Z');
  });

  it('reemplaza (no acumula) los campos de estado y frescura del delta', () => {
    const previa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    const fusionada = fusionarTraza(
      previa,
      respuesta({
        totalPuntos: 1,
        estadoFrescura: 'detenido',
        sesionFin: '2026-08-18T14:00:00.000Z',
      }),
    );

    expect(fusionada.estadoFrescura).toBe('detenido');
    expect(fusionada.sesionFin).toBe('2026-08-18T14:00:00.000Z');
    expect(fusionada.puntos).toHaveLength(1);
  });

  it('deja `cursor` en null mientras no haya ningún punto', () => {
    expect(fusionarTraza(undefined, respuesta()).cursor).toBeNull();
  });
});

describe('desdeConSolape (cursor con solape)', () => {
  it('resta el solape al cursor', () => {
    const desde = desdeConSolape('2026-08-18T13:05:00.000Z');
    expect(desde?.toISOString()).toBe(
      new Date(Date.parse('2026-08-18T13:05:00.000Z') - SOLAPE_CURSOR_MS).toISOString(),
    );
  });

  it('solape corto (polls intermedios) resta 15 min', () => {
    const desde = desdeConSolape('2026-08-18T13:05:00.000Z', false);
    expect(desde?.toISOString()).toBe(
      new Date(Date.parse('2026-08-18T13:05:00.000Z') - SOLAPE_CURSOR_CORTO_MS).toISOString(),
    );
  });

  it('sin cursor pide la ventana completa', () => {
    expect(desdeConSolape(null)).toBeUndefined();
    expect(desdeConSolape(undefined)).toBeUndefined();
  });
});

describe('necesitaRecargaCompleta (auto-heal)', () => {
  it('dispara la recarga cuando lo acumulado quedó por debajo de totalPuntos', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 40 }),
    );

    expect(fusionada.completa).toBe(false);
    expect(necesitaRecargaCompleta(fusionada)).toBe(true);
  });

  it('NO dispara cuando el delta vino truncado por `limite` (hayMas)', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 40, hayMas: true }),
    );

    expect(necesitaRecargaCompleta(fusionada)).toBe(false);
  });

  it('NO dispara cuando la traza está completa', () => {
    const fusionada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [punto('2026-08-18T13:00:00.000Z'), punto('2026-08-18T13:00:20.000Z')],
        totalPuntos: 2,
      }),
    );

    expect(fusionada.completa).toBe(true);
    expect(necesitaRecargaCompleta(fusionada)).toBe(false);
  });

  it('una recarga completa cura el hueco', () => {
    const conHueco = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:40.000Z')], totalPuntos: 3 }),
    );
    expect(necesitaRecargaCompleta(conHueco)).toBe(true);

    // La recarga descarta lo acumulado (`previa` = undefined) a propósito.
    const curada = fusionarTraza(
      undefined,
      respuesta({
        puntos: [
          punto('2026-08-18T13:00:00.000Z'),
          punto('2026-08-18T13:00:20.000Z'),
          punto('2026-08-18T13:00:40.000Z'),
        ],
        totalPuntos: 3,
      }),
    );
    expect(curada.completa).toBe(true);
    expect(necesitaRecargaCompleta(curada)).toBe(false);
  });
});

describe('debeRecargar (guarda contra el bucle de recargas)', () => {
  function puntosDe(cantidad: number): PuntoTrazaGps[] {
    return Array.from({ length: cantidad }, (_, i) =>
      punto(`2026-08-18T13:${String(i).padStart(2, '0')}:00.000Z`),
    );
  }

  // `totalPuntos` sube en casi cada poll de una sesión viva (es un `count(*)` vivo sobre la
  // ventana de la sesión) — por eso el helper deja variar `totalPuntos` y la cantidad de
  // puntos acumulados por separado, para poder mantener el DÉFICIT fijo mientras el total
  // cambia (el escenario real de A2). `ultimoIntentoRecargaMs` default `null` (= sin cooldown
  // activo) para no afectar los casos que no lo ejercitan.
  const incompleta = (
    recargaFallida: boolean,
    deficitFallido: number | null,
    totalPuntos = 40,
    puntosAcumulados = 1,
    ultimoIntentoRecargaMs: number | null = null,
  ): TrazaAcumulada => ({
    ...fusionarTraza(undefined, respuesta({ puntos: puntosDe(puntosAcumulados), totalPuntos })),
    recargaFallida,
    deficitFallido,
    ultimoIntentoRecargaMs,
  });

  it('recarga la primera vez que detecta el hueco', () => {
    expect(debeRecargar(undefined, incompleta(false, null), AHORA_BASE_MS)).toBe(true);
  });

  it('NO vuelve a recargar si el déficit no creció respecto de la recarga fallida anterior', () => {
    // Dos filas distintas en la base con el mismo ts/lat/lng (reingesta del mismo fix): el
    // dedupe las colapsa y el acumulado se queda un punto por debajo de `totalPuntos` para
    // siempre. Déficit: 40 - 1 = 39, igual en ambos lados.
    const previa = incompleta(true, 39, 40, 1);
    const fusionada = incompleta(false, null, 40, 1);
    expect(debeRecargar(previa, fusionada, AHORA_BASE_MS)).toBe(false);
  });

  it('sigue SIN recargar aunque `totalPuntos` suba, mientras el déficit no crezca (A2)', () => {
    // Escenario real de A2: la sesión sigue viva y `totalPuntos` sube de 40 a 42 entre polls,
    // pero el hueco permanente sigue siendo el mismo (déficit 39 en ambos lados) — la guarda
    // vieja, que comparaba `totalPuntos`, jamás frenaba esto.
    const previa = incompleta(true, 39, 40, 1);
    const fusionada = incompleta(false, null, 42, 3); // déficit: 42 - 3 = 39
    expect(debeRecargar(previa, fusionada, AHORA_BASE_MS)).toBe(false);
  });

  it('vuelve a intentar cuando aparece un hueco nuevo y real (el déficit creció), fuera de cooldown', () => {
    const previa = incompleta(true, 39, 40, 1);
    const fusionada = incompleta(false, null, 42, 2); // déficit: 42 - 2 = 40, > 39
    // Sin `ultimoIntentoRecargaMs` en `previa` no hay cooldown activo, así que este caso por sí
    // solo no prueba el cooldown — eso lo cubre el describe de abajo. Acá solo se confirma que
    // la guarda por déficit sigue funcionando con la firma nueva.
    expect(debeRecargar(previa, fusionada, AHORA_BASE_MS)).toBe(true);
  });

  it('nunca recarga si la traza está completa', () => {
    const completa = fusionarTraza(
      undefined,
      respuesta({ puntos: [punto('2026-08-18T13:00:00.000Z')], totalPuntos: 1 }),
    );
    expect(debeRecargar(incompleta(true, 39), completa, AHORA_BASE_MS)).toBe(false);
  });

  describe('cooldown temporal (COOLDOWN_RECARGA_MS) — techo duro, independiente del déficit', () => {
    // Escenario real: una sesión que quedó abierta (Finalizar recorrido no cierra la
    // `sesion_operativa`) cruza `TRAZA_EN_VIVO_LIMITE_MAX` (5000 puntos). Ahí la recarga
    // completa NUNCA puede completar (`recargada.completa` da siempre `false`) y el déficit
    // (`totalPuntos - 5000`) crece en cada poll porque `totalPuntos` sigue subiendo — la guarda
    // por déficit sola dejaría pasar una recarga completa cada 10 s para siempre.
    const LIMITE = 5000;

    it('NO dispara dentro del cooldown aunque el déficit haya crecido de verdad (sesión > TRAZA_EN_VIVO_LIMITE_MAX)', () => {
      const previa = incompleta(true, 500, LIMITE + 500, LIMITE, AHORA_BASE_MS);
      // `totalPuntos` sigue el `count(*)` vivo subiendo entre polls; el acumulado sigue topado
      // en `LIMITE` porque la recarga completa nunca puede traer más de eso.
      const fusionada = incompleta(false, null, LIMITE + 520, LIMITE); // déficit 520 > 500
      const ahora = AHORA_BASE_MS + COOLDOWN_RECARGA_MS - 1; // todavía dentro del cooldown
      expect(debeRecargar(previa, fusionada, ahora)).toBe(false);
    });

    it('vuelve a intentar una vez pasado el cooldown', () => {
      const previa = incompleta(true, 500, LIMITE + 500, LIMITE, AHORA_BASE_MS);
      const fusionada = incompleta(false, null, LIMITE + 520, LIMITE); // déficit 520 > 500
      const ahora = AHORA_BASE_MS + COOLDOWN_RECARGA_MS; // cooldown recién cumplido
      expect(debeRecargar(previa, fusionada, ahora)).toBe(true);
    });

    it('el cooldown también corta el caso de déficit fijo (no es un mecanismo nuevo y separado)', () => {
      const previa = incompleta(true, 39, 40, 1, AHORA_BASE_MS);
      const fusionada = incompleta(false, null, 40, 1); // déficit igual, ya frenaría sin cooldown
      const ahora = AHORA_BASE_MS + 1_000;
      expect(debeRecargar(previa, fusionada, ahora)).toBe(false);
    });

    it('sin un intento previo registrado (`ultimoIntentoRecargaMs: null`) no hay cooldown que aplicar', () => {
      const previa = incompleta(true, 39, 40, 1, null);
      const fusionada = incompleta(false, null, 42, 2); // déficit 40 > 39
      expect(debeRecargar(previa, fusionada, AHORA_BASE_MS)).toBe(true);
    });
  });
});

describe('antigüedad medida contra el reloj del servidor', () => {
  const servidorTs = '2026-08-18T14:00:00.000Z';
  const ultimoFixTs = '2026-08-18T13:58:00.000Z'; // 2 min antes según el server

  it('con el reloj del navegador en hora da la antigüedad real', () => {
    const recibidoEn = Date.parse(servidorTs);
    expect(offsetRelojServidorMs(servidorTs, recibidoEn)).toBe(0);
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('con el navegador 3 h adelantado da EXACTAMENTE lo mismo', () => {
    const desfase = 3 * 60 * 60_000;
    const recibidoEn = Date.parse(servidorTs) + desfase;
    expect(offsetRelojServidorMs(servidorTs, recibidoEn)).toBe(-desfase);
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('con el navegador 3 h atrasado da EXACTAMENTE lo mismo', () => {
    const recibidoEn = Date.parse(servidorTs) - 3 * 60 * 60_000;
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn)).toBe(120_000);
  });

  it('sigue corriendo entre polls: 30 s de reloj del cliente suman 30 s de antigüedad', () => {
    const recibidoEn = Date.parse(servidorTs) + 5 * 60 * 60_000; // reloj cualquiera
    expect(antiguedadViva(ultimoFixTs, servidorTs, recibidoEn, recibidoEn + 30_000)).toBe(150_000);
  });

  it('nunca devuelve negativo (skew de milisegundos entre relojes)', () => {
    const recibidoEn = Date.parse(servidorTs);
    expect(antiguedadViva('2026-08-18T14:00:05.000Z', servidorTs, recibidoEn, recibidoEn)).toBe(0);
  });

  it('sin timestamp devuelve null (se pinta como "—", no como "hace 56 años")', () => {
    expect(
      antiguedadViva(null, servidorTs, Date.parse(servidorTs), Date.parse(servidorTs)),
    ).toBeNull();
  });
});

describe('intervaloPoll', () => {
  it('sin datos todavía usa la cadencia normal', () => {
    expect(intervaloPoll(undefined)).toBe(INTERVALO_POLL_MS);
  });

  it('en_pausa nunca corta el poll, ni con >30 min de inactividad', () => {
    expect(intervaloPoll({ hayMas: false, inactivaDesdeMs: UMBRAL_CORTE_POLL_MS * 4, estadoFrescura: 'en_pausa' })).toBe(INTERVALO_POLL_MS);
  });

  it('acelera mientras el server avisa hayMas', () => {
    expect(intervaloPoll({ hayMas: true, inactivaDesdeMs: 0, estadoFrescura: 'reportando' })).toBe(
      INTERVALO_POLL_RAPIDO_MS,
    );
  });

  it('corta por inactividad real (`inactivaDesdeMs`), no por `fin`', () => {
    expect(
      intervaloPoll({
        hayMas: false,
        inactivaDesdeMs: UMBRAL_CORTE_POLL_MS + 1,
        estadoFrescura: 'perdido',
      }),
    ).toBe(false);
  });

  it('el corte por inactividad gana aunque el server siga avisando `hayMas` (A6)', () => {
    // Una sesión zombi cuya traza excede `limite` sigue trayendo `hayMas: true` para siempre;
    // sin este orden el poll quedaría a 1 s en vez de cortar.
    expect(
      intervaloPoll({
        hayMas: true,
        inactivaDesdeMs: UMBRAL_CORTE_POLL_MS + 1,
        estadoFrescura: 'perdido',
      }),
    ).toBe(false);
  });

  it('NO corta a un teléfono solo atrasado: el p95 del lag de ingesta (~814 s) sigue polleando', () => {
    expect(
      intervaloPoll({ hayMas: false, inactivaDesdeMs: 814_000, estadoFrescura: 'detenido' }),
    ).toBe(INTERVALO_POLL_MS);
  });

  it('tampoco corta con el máximo de lag medido en campo si el vehículo sigue vivo', () => {
    expect(UMBRAL_CORTE_POLL_MS).toBeGreaterThan(15 * 60_000);
  });

  /**
   * Fase A (docs/plan-ubicacion-fluida.md) — decisión del chairman sobre un hallazgo de
   * Codex: `finalizado` NO corta el poll del todo (la sesión de LOGIN sigue viva y el
   * conductor puede iniciar un recorrido nuevo sin volver a loguearse), pasa a una cadencia
   * lenta propia. `hayMas` sigue mandando primero (catch-up de la carga inicial truncada).
   */
  describe('estado "finalizado" — cadencia propia, no corte total', () => {
    it('sin hayMas: cadencia LENTA (INTERVALO_POLL_FINALIZADO_MS), no `false`', () => {
      expect(
        intervaloPoll({ hayMas: false, inactivaDesdeMs: 0, estadoFrescura: 'finalizado' }),
      ).toBe(INTERVALO_POLL_FINALIZADO_MS);
    });

    it('con hayMas: sigue el catch-up normal a INTERVALO_POLL_RAPIDO_MS', () => {
      expect(
        intervaloPoll({ hayMas: true, inactivaDesdeMs: 0, estadoFrescura: 'finalizado' }),
      ).toBe(INTERVALO_POLL_RAPIDO_MS);
    });

    it('gana aunque `inactivaDesdeMs` ya supere el umbral de corte de 30 min', () => {
      expect(
        intervaloPoll({
          hayMas: false,
          inactivaDesdeMs: UMBRAL_CORTE_POLL_MS + 1,
          estadoFrescura: 'finalizado',
        }),
      ).toBe(INTERVALO_POLL_FINALIZADO_MS);
    });
  });
});

describe('presentación de estadoFrescura', () => {
  it('`detenido` NO es una falla (vehículo esperando en terminal)', () => {
    expect(PRESENTACION_FRESCURA.detenido.esFalla).toBe(false);
  });

  it('la única falla es `perdido`', () => {
    expect(PRESENTACION_FRESCURA.perdido.esFalla).toBe(true);
    expect(PRESENTACION_FRESCURA.reportando.esFalla).toBe(false);
    expect(PRESENTACION_FRESCURA.sin_datos.esFalla).toBe(false);
  });

  it('cada estado tiene un color propio', () => {
    const colores = Object.values(PRESENTACION_FRESCURA).map((p) => p.color);
    expect(new Set(colores).size).toBe(colores.length);
  });

  /** Fase A (docs/plan-ubicacion-fluida.md) — "Recorrido finalizado" es informativo, NO una
   * falla (mismo criterio que `detenido`). */
  it('"finalizado" no es una falla', () => {
    expect(PRESENTACION_FRESCURA.finalizado.esFalla).toBe(false);
    expect(PRESENTACION_FRESCURA.finalizado.etiqueta).toBe('Recorrido finalizado');
  });

  /**
   * Trampa de deploy (plan §Fase A): `apiFetch` no valida con zod en runtime, así que un
   * panel viejo (o cualquier estado futuro que este código todavía no conozca) puede recibir
   * un `estadoFrescura` fuera del dominio conocido. `presentacionFrescura` es el fallback:
   * nunca debe tirar, cae a `sin_datos`.
   */
  describe('presentacionFrescura (fallback tolerante a estados desconocidos)', () => {
    it('devuelve la presentación real para cada estado conocido', () => {
      expect(presentacionFrescura('finalizado')).toBe(PRESENTACION_FRESCURA.finalizado);
      expect(presentacionFrescura('reportando')).toBe(PRESENTACION_FRESCURA.reportando);
    });

    it('un estado desconocido cae a "sin_datos" sin tirar', () => {
      expect(presentacionFrescura('estado-futuro-inexistente')).toBe(
        PRESENTACION_FRESCURA.sin_datos,
      );
      expect(() => presentacionFrescura('')).not.toThrow();
    });
  });
});

describe('formatearAntiguedad', () => {
  it('formatea segundos, minutos y horas', () => {
    expect(formatearAntiguedad(null)).toBe('—');
    expect(formatearAntiguedad(12_000)).toBe('12 s');
    expect(formatearAntiguedad(200_000)).toBe('3 min 20 s');
    expect(formatearAntiguedad(3_900_000)).toBe('1 h 05 min');
  });
});

describe('tipos acumulados', () => {
  it('TrazaAcumulada conserva todo el payload del server', () => {
    const acumulada: TrazaAcumulada = fusionarTraza(
      undefined,
      respuesta({ estadoFrescura: 'reportando', inactivaDesdeMs: 1_000 }),
    );
    expect(acumulada.inactivaDesdeMs).toBe(1_000);
    expect(acumulada.estadoFrescura).toBe('reportando');
  });
});
