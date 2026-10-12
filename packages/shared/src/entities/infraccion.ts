import { z } from 'zod';
import { GravedadReglaSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';
import { CrearSancionSchema } from './sancion.js';

// docs/plan-en-vivo-alertas.md, PR A — infracciones detectadas automáticamente por el worker
// de ingesta (desvío de ruta, punto de control omitido) y accionables por el admin.

export const TipoInfraccionSchema = z.enum(['desvio_ruta', 'pc_omitido']);
export type TipoInfraccion = z.infer<typeof TipoInfraccionSchema>;

export const EstadoInfraccionSchema = z.enum(['abierta', 'atendida', 'sancionada', 'descartada']);
export type EstadoInfraccion = z.infer<typeof EstadoInfraccionSchema>;

/**
 * `Regla.tipo` es texto libre; estos dos valores EXACTOS están reservados: si el sindicato
 * tiene una `Regla` activa con uno de ellos, su `gravedad` y su `id` se usan al abrir la
 * infracción (ver `resolverGravedadInfraccion` en apps/api). La UI de `/reglas` los sugiere.
 */
export const REGLA_TIPO_DESVIO_RUTA = 'desvio_ruta';
export const REGLA_TIPO_PC_OMITIDO = 'pc_omitido';
export const REGLA_TIPOS_RESERVADOS_INFRACCION = [
  REGLA_TIPO_DESVIO_RUTA,
  REGLA_TIPO_PC_OMITIDO,
] as const;

/** Gravedad cuando el sindicato NO definió una `Regla` con el `tipo` reservado. */
export const GRAVEDAD_DEFAULT_POR_TIPO: Record<TipoInfraccion, z.infer<typeof GravedadReglaSchema>> = {
  desvio_ruta: 'grave',
  pc_omitido: 'leve',
};

/** Orden de severidad para agregar el "nivel" de un vehículo (leve < grave < gravisima). */
export const GRAVEDAD_ORDEN: Record<z.infer<typeof GravedadReglaSchema>, number> = {
  leve: 1,
  grave: 2,
  gravisima: 3,
};

// ---- Umbrales de la máquina de desvío (constantes por ahora; configurables por línea queda
// fuera de alcance). `DESVIO_UMBRAL_M` = `RUTA_PROXIMIDAD_TOLERANCIA_METROS` de apps/api
// (100 m) — hay un test en apps/api que lo asegura, shared no puede importar de la api.
export const DESVIO_UMBRAL_M = 100;
/** Histéresis: distancia por debajo de la cual un punto cuenta como "de regreso a la ruta". */
export const DESVIO_REGRESO_M = 60;
/** Puntos consecutivos fuera de la ruta necesarios para abrir. */
export const DESVIO_MIN_PUNTOS = 3;
/** Duración mínima entre el primer y el último punto fuera para abrir (ms). */
export const DESVIO_MIN_DURACION_MS = 45_000;
/** Puntos consecutivos de regreso necesarios para cerrar. */
export const DESVIO_MIN_PUNTOS_REGRESO = 2;
/** Un fix con `accuracy` mayor se ignora (`accuracy` nula se acepta). */
export const DESVIO_MAX_ACCURACY_M = 30;

export const DetalleDesvioSchema = z.object({
  distanciaMaxM: z.number().nonnegative(),
  duracionS: z.number().nonnegative(),
  puntos: z.number().int().nonnegative(),
});
export type DetalleDesvio = z.infer<typeof DetalleDesvioSchema>;

export const DetallePcOmitidoSchema = z.object({
  puntoControlId: z.string(),
  orden: z.number().int(),
  nombre: z.string().nullable().optional(),
});
export type DetallePcOmitido = z.infer<typeof DetallePcOmitidoSchema>;

export const InfraccionSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  sesionId: uuidSchema,
  vehiculoId: uuidSchema,
  conductorId: uuidSchema,
  lineaId: uuidSchema,
  rutaId: uuidSchema,
  tipo: TipoInfraccionSchema,
  gravedad: GravedadReglaSchema,
  reglaId: uuidSchema.nullable(),
  estado: EstadoInfraccionSchema,
  inicioTs: z.coerce.date(),
  finTs: z.coerce.date().nullable(),
  lat: z.number(),
  lng: z.number(),
  /** `DetalleDesvio` o `DetallePcOmitido` según `tipo` (jsonb). */
  detalle: z.record(z.unknown()),
  sancionId: uuidSchema.nullable(),
  atendidaPor: z.string().nullable(),
  atendidaEn: z.coerce.date().nullable(),
  nota: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Infraccion = z.infer<typeof InfraccionSchema>;

export const AccionInfraccionSchema = z.enum(['atender', 'descartar']);
export type AccionInfraccion = z.infer<typeof AccionInfraccionSchema>;

export const ActualizarInfraccionSchema = z.object({
  accion: AccionInfraccionSchema,
  nota: z.string().max(500).optional(),
});
export type ActualizarInfraccion = z.infer<typeof ActualizarInfraccionSchema>;

/** `POST /infracciones/:id/sancionar` — mismos campos que `CrearSancion`, sin `sindicatoId`
 * (se deriva de la infracción). */
export const SancionarInfraccionSchema = CrearSancionSchema.omit({ sindicatoId: true });
export type SancionarInfraccion = z.infer<typeof SancionarInfraccionSchema>;
