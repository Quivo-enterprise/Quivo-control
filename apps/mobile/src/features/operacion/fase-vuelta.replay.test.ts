import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distanciaAPolilineaM, segmentoMasCercano, type PuntoControlPaquete } from '@quivo/shared';
import {
  detectarPuntosControlCercanos,
  filtrarNuevosCumplimientos,
  type EstadoPuntoControl,
} from '../../gps/geofence';
import {
  evaluarFixFase,
  faseDe,
  filtrarPorSentido,
  puntosDeFase,
  retornoBloqueaIda,
  rutasDelCircuito,
} from './fase-vuelta';
import { ESTADO_RUMBO_INICIAL, rumboDeMovimiento } from './movimiento/rumbo';
import { estadoInicialVuelta, ordenEfectivoPuntos, pasoPunto } from './progreso-vuelta';

/**
 * Regresión con datos REALES del piloto L16 (21 y 22/10/2026): reproduce cada traza GPS por las
 * mismas funciones puras que corren en la app por fix (`puntosDeLaFaseActual` → fase + compuerta de
 * sentido → `detectarPuntosControlCercanos` → `filtrarNuevosCumplimientos` → `pasoPunto`) con el
 * trazado vigente (#233). No emula la cola SQLite ni `confirmarVisitasVencidasEnCola`.
 * Fixture: `fixtures/l16-piloto-trazas.json` (fix = [msDesdeInicio, lat, lng, accuracy, speed]).
 */
interface Fixture {
  ruta: [number, number][];
  pcs: { id: string; orden: number; rol: PuntoControlPaquete['rol']; coord: [number, number]; radio: number }[];
  sesiones: Record<string, { etiqueta: string; t0: string; fixes: [number, number, number, number, number][] }>;
}
const fx = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/l16-piloto-trazas.json'), 'utf8'),
) as Fixture;

const pcs: PuntoControlPaquete[] = fx.pcs.map((p) => ({
  id: p.id,
  orden: p.orden,
  coord: { type: 'Point', coordinates: p.coord },
  radioToleranciaM: p.radio,
  obligatorio: true,
  rol: p.rol,
}));
const retorno = pcs.find((p) => p.rol === 'retorno')!;
const ordenDe = new Map(pcs.map((p) => [p.id, p.orden]));
const rutas = rutasDelCircuito(fx.ruta, pcs);
const idsEfectivos = ordenEfectivoPuntos(pcs, null).map((p) => p.id); // sin designación: Molinos fuera
const idsEspera = pcs.filter((p) => p.rol === 'espera').map((p) => p.id);
const roles = { retornoId: retorno.id, terminalId: pcs.find((p) => p.rol === 'terminal')!.id };

/**
 * `legado: true` reproduce la lógica previa al fix (cualquier fix cuenta en el fallback, sin
 * compuerta de sentido y sin el candado "retorno ya pasado") para demostrar que estas trazas la rompían.
 */
function reproducir(sesionId: string, legado = false) {
  const ses = fx.sesiones[sesionId]!;
  const t0 = Date.parse(ses.t0);
  let estado = estadoInicialVuelta('s', '2026-10-22');
  let rumboEstado = ESTADO_RUMBO_INICIAL;
  const estadosPc = new Map<string, EstadoPuntoControl>();
  const emitidos: number[] = [];
  const violaciones: string[] = [];
  let cambiosDeFase = 0;
  for (const [ms, lat, lng, accuracy, speed] of ses.fixes) {
    const r = rumboDeMovimiento(
      { lat, lng, ts: t0 + ms, speed, heading: -1, accuracy },
      rumboEstado,
    );
    rumboEstado = r.estado;
    const posicion: [number, number] = [lng, lat];
    const sentido = legado
      ? { rumbo: 0, rumboIda: 0, rumboRegreso: 0 }
      : {
          rumbo: r.rumbo,
          rumboIda: segmentoMasCercano(rutas.rutaIda!, lat, lng)?.rumbo ?? null,
          rumboRegreso: segmentoMasCercano(rutas.rutaRegreso!, lat, lng)?.rumbo ?? null,
        };
    const antes = faseDe(estado);
    estado = evaluarFixFase(
      estado,
      distanciaAPolilineaM(posicion, rutas.mitades!.ida),
      distanciaAPolilineaM(posicion, rutas.mitades!.regreso),
      accuracy,
      sentido,
      !legado && retornoBloqueaIda(estado.pasados.includes(retorno.id), posicion, retorno),
    );
    let puntos = puntosDeFase(pcs, faseDe(estado));
    if (!legado) puntos = filtrarPorSentido(puntos, rutas.rumboPc, r.rumbo);
    const res = filtrarNuevosCumplimientos(
      estadosPc,
      detectarPuntosControlCercanos(posicion, puntos, accuracy),
      's',
      t0 + ms,
      { lat, lng },
    );
    for (const [clave, e] of res.transiciones) estadosPc.set(clave, e);
    for (const e of res.emitir) {
      const puntoId = e.deteccion.puntoControlId;
      emitidos.push(ordenDe.get(puntoId)!);
      estado = pasoPunto(estado, { puntoId, clave: e.clave }, idsEfectivos, idsEspera, roles);
    }
    if (faseDe(estado) !== antes) cambiosDeFase += 1;
    // Invariante (con la vuelta anclada en la terminal; antes la traza puede arrancar a mitad de
    // vuelta y el fallback legítimamente recupera la fase): regreso <=> retorno pasado.
    const regreso = faseDe(estado) === 'regreso';
    if (estado.inicioId !== null && regreso !== estado.pasados.includes(retorno.id)) {
      violaciones.push(`ms=${ms} fase=${faseDe(estado)} pasados=${estado.pasados.map((i) => ordenDe.get(i)).join(',')}`);
    }
  }
  return { emitidos, violaciones, cambiosDeFase };
}

/** Parte la secuencia emitida en vueltas (cierra al emitir el 16), sin los 0 de la terminal. */
function vueltas(emitidos: number[]): number[][] {
  const resultado: number[][] = [[]];
  for (const o of emitidos.filter((n) => n !== 0)) {
    resultado[resultado.length - 1]!.push(o);
    if (o === 16) resultado.push([]);
  }
  return resultado.filter((v) => v.length > 0);
}
const COMPLETA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];

describe('replay de trazas reales L16 con el trazado vigente', () => {
  for (const id of Object.keys(fx.sesiones)) {
    it(`${id} (${fx.sesiones[id]!.etiqueta}): fase por rumbo y orden de PC correcto`, () => {
      const { emitidos, violaciones } = reproducir(id);
      // (a) regreso solo después de pasar el retorno, y sin volver a ida hasta cerrar la vuelta.
      expect(violaciones).toEqual([]);
      // (b) 1..7, 8, 9..14, 16 en cada vuelta (Molinos 15 ausente sin designación); la última puede quedar incompleta.
      const vs = vueltas(emitidos);
      expect(vs.length).toBeGreaterThan(0);
      vs.forEach((v, i) => {
        const esperado = i === vs.length - 1 ? COMPLETA.slice(0, v.length) : COMPLETA;
        expect(v).toEqual(esperado);
      });
      expect(vs[0]!.length).toBeGreaterThanOrEqual(8); // no vacuo: al menos pasó el retorno
    });
  }

  it('con la lógica previa las trazas del 22/10 se rompen (el test detecta la regresión)', () => {
    for (const id of ['4d3b08a1', '5e19c201']) {
      const { emitidos, violaciones } = reproducir(id, true);
      expect(violaciones.length).toBeGreaterThan(0);
      // Lo que vio producción: 0, 16, 14..10 (PC de regreso cumplidos yendo en ida), 7, 8...
      expect(emitidos.slice(0, 7)).toEqual([0, 16, 14, 13, 12, 11, 10]);
    }
  });
});
