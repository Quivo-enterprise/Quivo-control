import { z } from 'zod';
import { LineaGeoJsonSchema, PuntoGeoJsonSchema } from '../geo.js';
import { uuidSchema } from '../primitives.js';

// docs/plan-molinos-designacion.md, F1 — vueltas en el servidor y designación a Molinos.

export const EstadoVueltaSchema = z.enum(['en_curso', 'completa', 'abierta_al_cierre']);
export type EstadoVuelta = z.infer<typeof EstadoVueltaSchema>;

/**
 * Salida de un punto del recorrido se confirma con 2 fixes consecutivos a más de `radio + 30 m`
 * del punto de espera y `accuracy <= 30 m` (mismo corte de precisión que el desvío): un solo
 * fix suelto puede ser un salto de GPS, y dentro del radio el vehículo sigue "esperando".
 */
export const ESPERA_SALIDA_MARGEN_M = 30;
export const ESPERA_SALIDA_PUNTOS_CONSECUTIVOS = 2;
export const ESPERA_MAX_ACCURACY_M = 30;

/** Vuelta en curso dentro del poll de posiciones (`PosicionEnVivo.vuelta`). */
export const VueltaPosicionSchema = z.object({
  numero: z.number().int().positive(),
  varianteId: uuidSchema.nullable(),
  varianteNombre: z.string().nullable(),
  /** ISO. `null` mientras no hay designación (o si se canceló: `varianteId` null). */
  designadaEn: z.string().nullable(),
  /** ISO de cuando el chofer confirmó "Entendido"; `null` = todavía no lo vio. */
  acuseEn: z.string().nullable(),
  /** Llegó al punto de espera y todavía no salió. */
  enEspera: z.boolean(),
  esperaDesdeTs: z.string().nullable(),
});
export type VueltaPosicion = z.infer<typeof VueltaPosicionSchema>;

/** `PUT /reportes/en-vivo/:sesionId/vuelta-actual/designacion`. `null` cancela la designación. */
export const DesignarVueltaSchema = z.object({
  varianteId: uuidSchema.nullable(),
});
export type DesignarVuelta = z.infer<typeof DesignarVueltaSchema>;

/** Respuesta de la designación: la vuelta actualizada. */
export const VueltaResumenSchema = z.object({
  id: uuidSchema,
  /** Tenant de la vuelta (el interceptor de auditoría lo usa para atribuir el registro). */
  sindicatoId: uuidSchema,
  sesionId: uuidSchema,
  numero: z.number().int().positive(),
  estado: EstadoVueltaSchema,
  inicioTs: z.string(),
  finTs: z.string().nullable(),
  pasoRetornoTs: z.string().nullable(),
  varianteId: uuidSchema.nullable(),
  varianteNombre: z.string().nullable(),
  designadaPor: z.string().nullable(),
  designadaEn: z.string().nullable(),
  acuseEn: z.string().nullable(),
  esperaLlegadaTs: z.string().nullable(),
  esperaSalidaTs: z.string().nullable(),
});
export type VueltaResumen = z.infer<typeof VueltaResumenSchema>;

/**
 * `GET /reportes/en-vivo/molinos` — resumen por línea para el HUD ("Molinos: X en espera ·
 * último envío hace N min · próximo sugerido en M min"). Se pide aparte del poll de 2 s porque
 * agrega por línea/día y cambia con mucha menos frecuencia.
 */
export const MolinosLineaSchema = z.object({
  lineaId: uuidSchema,
  lineaNombre: z.string(),
  /** Vehículos que llegaron al punto de espera y todavía no salieron. */
  enEspera: z.number().int().nonnegative(),
  /** Llegada más antigua entre los que siguen esperando; `null` si no hay ninguno. */
  esperaDesdeTs: z.string().nullable(),
  /** Última designación del día (máx `designadaEn` con variante); `null` si no hubo. */
  ultimoEnvioTs: z.string().nullable(),
  /** Sesiones activas de la línea con recorrido no finalizado. */
  flotaActiva: z.number().int().nonnegative(),
  /** De ellas, las que todavía no tienen ninguna vuelta designada hoy. */
  sinMolinosHoy: z.number().int().nonnegative(),
  /** Intervalo objetivo entre envíos (ventana diurna / flota activa, mínimo 1 min). */
  intervaloObjetivoMs: z.number().int().positive(),
  /** `ultimoEnvioTs + intervalo`, o ahora si todavía no hubo envíos hoy. */
  proximoSugeridoEn: z.string(),
});
export type MolinosLinea = z.infer<typeof MolinosLineaSchema>;

export const MolinosResumenSchema = z.object({
  servidorTs: z.string(),
  lineas: z.array(MolinosLineaSchema),
});
export type MolinosResumen = z.infer<typeof MolinosResumenSchema>;

/**
 * `GET /mobile/vuelta-actual` — lo que necesita la app del chofer (la sesión sale del token,
 * nunca de un id del cliente). `vueltaId`/`numero` en `null` = la sesión todavía no tiene una
 * vuelta en curso (antes de pasar por la terminal).
 */
export const VueltaActualMovilSchema = z.object({
  vueltaId: uuidSchema.nullable(),
  numero: z.number().int().positive().nullable(),
  designacion: z
    .object({
      varianteId: uuidSchema,
      nombre: z.string(),
      /** ISO exacto de la designación: el acuse lo devuelve tal cual para identificarla. */
      designadaEn: z.string(),
      /** ISO del acuse ya registrado (la app no vuelve a avisar); `null` = falta confirmar. */
      acuseEn: z.string().nullable(),
      /** Tramo adicional de la variante; `null` si la variante no tiene geometría cargada. */
      tramo: LineaGeoJsonSchema.nullable(),
      puntoEspera: z.object({
        id: uuidSchema,
        coord: PuntoGeoJsonSchema,
        esperaMin: z.number().int().positive(),
      }),
    })
    .nullable(),
  enEspera: z.object({ desdeTs: z.string() }).nullable(),
});
export type VueltaActualMovil = z.infer<typeof VueltaActualMovilSchema>;

/** `POST /mobile/vuelta-actual/acuse`. */
export const AcuseVueltaSchema = z.object({
  vueltaId: uuidSchema,
  designadaEn: z.string().datetime(),
});
export type AcuseVuelta = z.infer<typeof AcuseVueltaSchema>;
