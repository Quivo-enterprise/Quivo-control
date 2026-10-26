import { UMBRAL_VECINO_FRESCO_MS, type VecinoRuta } from '@quivo/shared';

export type Lado = 'delante' | 'detras';

/**
 * Estado de una fila del panel:
 * - `vecino`: hay un vecino con dato fresco.
 * - `nadie`: la respuesta es fresca y dice que no hay nadie en ese lado.
 * - `sinDato`: el dato guardado venció (o no se sabe) — NO equivale a "nadie".
 */
export type EstadoFila =
  { tipo: 'vecino'; vecino: VecinoRuta } | { tipo: 'nadie' } | { tipo: 'sinDato' };

/** Fallos consecutivos de red a partir de los cuales el panel avisa "Sin actualizar". */
export const FALLOS_PARA_AVISO = 2;

/**
 * Guarda del lado del cliente: el servidor ya filtra por frescura, pero un dato guardado (offline
 * o pausado) envejece. `edadFixS` es la del momento del cálculo; `transcurridoMs` suma el tiempo
 * desde que se recibió la respuesta.
 */
export function vecinoVisible(vecino: VecinoRuta | null, transcurridoMs = 0): vecino is VecinoRuta {
  if (!vecino) return false;
  return vecino.edadFixS * 1000 + Math.max(0, transcurridoMs) <= UMBRAL_VECINO_FRESCO_MS;
}

/**
 * Deriva el estado de una fila. Un `null` solo significa "nadie" mientras la respuesta misma sea
 * fresca: pasado el umbral desde su recepción ya no se sabe si sigue sin haber nadie.
 */
export function estadoFila(vecino: VecinoRuta | null, transcurridoMs = 0): EstadoFila {
  if (vecino) {
    return vecinoVisible(vecino, transcurridoMs) ? { tipo: 'vecino', vecino } : { tipo: 'sinDato' };
  }
  return Math.max(0, transcurridoMs) <= UMBRAL_VECINO_FRESCO_MS
    ? { tipo: 'nadie' }
    : { tipo: 'sinDato' };
}

/** Si ambas filas están `sinDato` la tarjeta no aporta nada y se oculta. */
export function tarjetaVisible(delante: EstadoFila, detras: EstadoFila): boolean {
  return !(delante.tipo === 'sinDato' && detras.tipo === 'sinDato');
}

/** Minutos enteros de antigüedad del fix: edad al calcular + tiempo desde la recepción. */
export function minutosDesde(edadFixS: number, transcurridoMs = 0): number {
  const segundos = Math.max(0, edadFixS) + Math.max(0, transcurridoMs) / 1000;
  return Math.floor(segundos / 60);
}

/** True cuando hubo `FALLOS_PARA_AVISO` o más fallos seguidos (el dato mostrado puede ser viejo). */
export function sinActualizar(fallosConsecutivos: number): boolean {
  return fallosConsecutivos >= FALLOS_PARA_AVISO;
}

/** Texto corto de antigüedad del fix: "hace menos de 1 min" / "hace N min". */
export function textoEdad(edadFixS: number, transcurridoMs = 0): string {
  const minutos = minutosDesde(edadFixS, transcurridoMs);
  return minutos < 1 ? 'hace menos de 1 min' : `hace ${minutos} min`;
}

function textoEdadHablado(edadFixS: number, transcurridoMs: number): string {
  const minutos = minutosDesde(edadFixS, transcurridoMs);
  if (minutos < 1) return 'hace menos de un minuto';
  return minutos === 1 ? 'hace 1 minuto' : `hace ${minutos} minutos`;
}

/** Distancia partida en valor + unidad; única fuente del redondeo (visual y hablado). */
export function distanciaPartes(metros: number): { valor: string; unidad: 'm' | 'km' } {
  if (metros < 1000) return { valor: String(Math.round(metros)), unidad: 'm' };
  return { valor: (metros / 1000).toFixed(1), unidad: 'km' };
}

/** Texto visual: "850 m" / "1.2 km" (mismo formato que `formatearDistancia`). */
export function textoDistancia(metros: number): string {
  const { valor, unidad } = distanciaPartes(metros);
  return `${valor} ${unidad}`;
}

export function distanciaHablada(metros: number): string {
  const { valor, unidad } = distanciaPartes(metros);
  if (unidad === 'm') return valor === '1' ? '1 metro' : `${valor} metros`;
  return `${valor.replace('.', ',')} kilómetros`;
}

export function textoVacio(lado: Lado): string {
  return lado === 'delante' ? 'Nadie delante en tu ruta' : 'Nadie detrás en tu ruta';
}

export const TEXTO_SIN_DATO = 'Sin datos recientes';

export function etiquetaLado(lado: Lado): string {
  return lado === 'delante' ? 'Delante' : 'Detrás';
}

/** Frase completa para lector de pantalla de una fila según su estado. */
export function etiquetaAccesibleFila(lado: Lado, estado: EstadoFila, transcurridoMs = 0): string {
  if (estado.tipo === 'nadie') return textoVacio(lado);
  if (estado.tipo === 'sinDato') return `${etiquetaLado(lado)}: ${TEXTO_SIN_DATO.toLowerCase()}`;
  const { vecino } = estado;
  const interno = vecino.numeroInterno ? `, interno ${vecino.numeroInterno}` : '';
  const semaforo =
    lado === 'delante'
      ? { normal: '', atencion: ', cerca', alerta: ', muy cerca' }[
          estadoDistanciaVecino(vecino.distanciaM)
        ]
      : '';
  return `${etiquetaLado(lado)}: placa ${vecino.placa}${interno}, a ${distanciaHablada(vecino.distanciaM)}${semaforo}, ${textoEdadHablado(vecino.edadFixS, transcurridoMs)}`;
}

/** Umbrales (m) de la tarjeta "Delante": por encima de ATENCION es normal; en ALERTA_M o menos, alerta. */
export const DISTANCIA_ATENCION_M = 500;
export const DISTANCIA_ALERTA_M = 300;
/** Histéresis: la alerta hablada solo se re-arma al superar esta distancia (jitter GPS alrededor de 300 m). */
export const DISTANCIA_REARME_M = 350;

export type EstadoDistanciaVecino = 'normal' | 'atencion' | 'alerta';

/** Semáforo de la distancia al vehículo de adelante. */
export function estadoDistanciaVecino(metros: number): EstadoDistanciaVecino {
  if (metros <= DISTANCIA_ALERTA_M) return 'alerta';
  if (metros <= DISTANCIA_ATENCION_M) return 'atencion';
  return 'normal';
}

/**
 * Decide si hablar la alerta: una vez por cruce a ALERTA y re-arme solo pasando de DISTANCIA_REARME_M.
 * `metros` null (sin dato/nadie) no cambia nada. Devuelve el nuevo estado `armada` del llamador.
 */
export function decidirAlertaVecino(
  metros: number | null,
  armada: boolean,
): { hablar: boolean; armada: boolean } {
  if (metros === null) return { hablar: false, armada };
  if (armada && estadoDistanciaVecino(metros) === 'alerta') return { hablar: true, armada: false };
  if (!armada && metros > DISTANCIA_REARME_M) return { hablar: false, armada: true };
  return { hablar: false, armada };
}
