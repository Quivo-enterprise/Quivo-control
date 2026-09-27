/**
 * Tipos del módulo `mock-flota` — estado de demo para `/en-vivo` en modo
 * `NEXT_PUBLIC_MOCK_FLOTA=true` (ver `docs/plan-mock-flota-en-vivo.md`).
 *
 * Todo lo de este módulo es **mock**: vive solo en memoria del cliente (se resetea al
 * recargar la página) y no toca Prisma, la API real ni `packages/shared`. La severidad
 * `leve|media|grave` es DISTINTA del enum real `leve|grave|gravisima`
 * (`packages/shared/src/enums/estados.ts:59`) — es la que pidió el CTO para esta demo, a
 * propósito, y no se homologan.
 */

/** Gravedad de una infracción mock. Ver nota de cabecera: no es el enum real. */
export type Severidad = 'leve' | 'media' | 'grave';

/** Las 2 líneas mockeadas. Los nombres son literales exactos usados en toda la UI. */
export type LineaMockId = 'z12' | 'l120';

export interface ParadaMock {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  /** Posición dentro de `LineaMock.paradas`, en el orden real de recorrido del circuito. */
  orden: number;
}

export interface LineaMock {
  id: LineaMockId;
  nombre: 'Z12' | 'Línea 120';
  /** Color de borde de los marcadores de esta línea (Decisión 6 del plan). */
  color: string;
  /** `[lat, lng]` — OJO: es el orden inverso del GeoJSON `[lon, lat]` de donde salen los datos. */
  polilinea: [number, number][];
  paradas: ParadaMock[];
}

export interface TrufiMock {
  id: string;
  placa: string;
  numeroInterno: string;
  conductorNombre: string;
  lineaId: LineaMockId;
  fotoUrl: string;
  /** Solo dígitos, formato E.164 sin `+` (p. ej. `59170000001`) — ver `whatsapp.ts`. */
  whatsapp: string;
}

export interface AccionTipo {
  id: string;
  nombre: string;
  descripcion: string;
}

export interface InfraccionTipo {
  id: string;
  nombre: string;
  severidad: Severidad;
  acciones: AccionTipo[];
}

export type ModoAplicacion = 'ahora' | 'plazo';

export interface AccionAplicada {
  accionId: string;
  modo: ModoAplicacion;
  /** ISO datetime — momento en que se aplicó la acción (no en que vence). */
  aplicadaEn: string;
  /** ISO date (`yyyy-mm-dd`) — solo presente con `modo: 'plazo'`. */
  venceEl?: string;
}

export interface InfraccionMock {
  id: string;
  trufiId: string;
  tipoId: string;
  severidad: Severidad;
  /** ISO datetime en que se disparó la infracción simulada. */
  ocurridaEn: string;
  estado: 'activa' | 'sancionada';
  accionAplicada?: AccionAplicada;
}

export interface EstadoTrufi {
  trufiId: string;
  /** Avance sobre la polilínea de su línea, en `[0, 1)` — hace loop al llegar a 1. */
  avance: number;
  lat: number;
  lng: number;
  siguienteParadaId: string | null;
}

export interface EstadoFlotaMock {
  trufis: Record<string, EstadoTrufi>;
  infracciones: InfraccionMock[];
  pausado: boolean;
}
