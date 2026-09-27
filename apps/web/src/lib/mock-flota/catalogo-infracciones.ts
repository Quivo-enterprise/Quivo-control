import type { InfraccionTipo, Severidad } from './tipos';

/**
 * Catálogo de infracciones y acciones — Decisión 8 del plan.
 *
 * **TODO son valores inventados para la demo, editables por el CTO en este archivo.** No
 * corresponden a ningún catálogo real de sanciones ni al enum real de severidad
 * (`packages/shared/src/enums/estados.ts:59`, que es `leve|grave|gravisima`).
 */
export const CATALOGO_INFRACCIONES: InfraccionTipo[] = [
  {
    id: 'parada-fuera-de-lugar',
    nombre: 'Parada fuera de lugar',
    severidad: 'leve',
    acciones: [
      {
        id: 'llamada-atencion-verbal',
        nombre: 'Llamada de atención verbal',
        descripcion: 'Se conversa con el conductor sobre la falta, sin registro formal.',
      },
      {
        id: 'amonestacion-escrita',
        nombre: 'Amonestación escrita',
        descripcion: 'Queda constancia escrita de la falta en el legajo del conductor.',
      },
    ],
  },
  {
    id: 'retraso-de-frecuencia',
    nombre: 'Retraso de frecuencia',
    severidad: 'leve',
    acciones: [
      {
        id: 'llamada-atencion-verbal',
        nombre: 'Llamada de atención verbal',
        descripcion: 'Se conversa con el conductor sobre la falta, sin registro formal.',
      },
      {
        id: 'amonestacion-escrita',
        nombre: 'Amonestación escrita',
        descripcion: 'Queda constancia escrita de la falta en el legajo del conductor.',
      },
    ],
  },
  {
    id: 'desvio-de-ruta',
    nombre: 'Desvío de ruta',
    severidad: 'media',
    acciones: [
      {
        id: 'multa-bs-100',
        nombre: 'Multa Bs 100',
        descripcion: 'Sanción económica de 100 bolivianos.',
      },
      {
        id: 'suspension-1-dia',
        nombre: 'Suspensión 1 día',
        descripcion: 'El conductor queda suspendido de operar por 1 día.',
      },
    ],
  },
  {
    id: 'exceso-de-pasajeros',
    nombre: 'Exceso de pasajeros',
    severidad: 'media',
    acciones: [
      {
        id: 'multa-bs-100',
        nombre: 'Multa Bs 100',
        descripcion: 'Sanción económica de 100 bolivianos.',
      },
      {
        id: 'suspension-1-dia',
        nombre: 'Suspensión 1 día',
        descripcion: 'El conductor queda suspendido de operar por 1 día.',
      },
    ],
  },
  {
    id: 'exceso-de-velocidad',
    nombre: 'Exceso de velocidad',
    severidad: 'grave',
    acciones: [
      {
        id: 'multa-bs-300',
        nombre: 'Multa Bs 300',
        descripcion: 'Sanción económica de 300 bolivianos.',
      },
      {
        id: 'suspension-3-dias',
        nombre: 'Suspensión 3 días',
        descripcion: 'El conductor queda suspendido de operar por 3 días.',
      },
      {
        id: 'retiro-temporal-de-la-linea',
        nombre: 'Retiro temporal de la línea',
        descripcion: 'El vehículo se retira temporalmente de la línea hasta nueva revisión.',
      },
    ],
  },
  {
    id: 'conduccion-temeraria',
    nombre: 'Conducción temeraria',
    severidad: 'grave',
    acciones: [
      {
        id: 'multa-bs-300',
        nombre: 'Multa Bs 300',
        descripcion: 'Sanción económica de 300 bolivianos.',
      },
      {
        id: 'suspension-3-dias',
        nombre: 'Suspensión 3 días',
        descripcion: 'El conductor queda suspendido de operar por 3 días.',
      },
      {
        id: 'retiro-temporal-de-la-linea',
        nombre: 'Retiro temporal de la línea',
        descripcion: 'El vehículo se retira temporalmente de la línea hasta nueva revisión.',
      },
    ],
  },
];

/**
 * Metadata visual de cada severidad — Decisión 6/7 del plan.
 *
 * `docs/categorizacion-colores-y-estados.md` define tokens de severidad real distintos
 * (`leve` = Cian `#06B6D4`, `grave` = Ámbar `#F59E0B`, `gravísima` = Rojo `#EF4444`) para el
 * enum real de 3 niveles con OTRO significado. Estos hex son los que pidió el CTO
 * explícitamente para el semáforo de esta demo (amarillo/naranja/rojo) y se mantienen tal
 * cual, sin homologar con ese documento.
 */
export const SEVERIDAD_META: Record<
  Severidad,
  { etiqueta: string; color: string; periodoParpadeoMs: number }
> = {
  leve: { etiqueta: 'Leve', color: '#facc15', periodoParpadeoMs: 1600 },
  media: { etiqueta: 'Media', color: '#f97316', periodoParpadeoMs: 1000 },
  grave: { etiqueta: 'Grave', color: '#dc2626', periodoParpadeoMs: 600 },
};
