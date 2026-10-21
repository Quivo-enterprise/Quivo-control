import { z } from 'zod';
import { PuntoGeoJsonSchema } from '../geo.js';
import { EstadoPuntoControlSchema } from '../enums/estados.js';
import { uuidSchema } from '../primitives.js';

/**
 * Rol del PC en el ciclo de vueltas (docs/plan-molinos-designacion.md): `terminal` abre/cierra
 * la vuelta (Salomón Romero), `retorno` es el punto del medio (Honduras), `espera` es donde la
 * unidad designada espera `esperaMin` minutos (Molinos).
 */
export const RolPuntoControlSchema = z.enum(['terminal', 'retorno', 'espera']);
export type RolPuntoControl = z.infer<typeof RolPuntoControlSchema>;

/** `coord` viaja como GeoJSON Point in/out — la columna real es `GEOGRAPHY(POINT)`
 * (SQL crudo en apps/api, igual que `paradas.coord`/`rutas.geometria`). La validación de
 * cumplimiento en recorrido (RF-39, contra `radioToleranciaM`) es de M3 (worker) — acá solo
 * la gestión del punto (RF-34..38). */
export const PuntoControlSchema = z.object({
  id: uuidSchema,
  rutaId: uuidSchema,
  orden: z.number().int().nonnegative(),
  coord: PuntoGeoJsonSchema,
  radioToleranciaM: z.number().int().positive(),
  obligatorio: z.boolean(),
  estado: EstadoPuntoControlSchema,
  /** `null`/ausente = punto común. Solo un admin lo edita. */
  rol: RolPuntoControlSchema.nullable().optional(),
  /** Minutos de espera obligatoria; solo con `rol = 'espera'` (el servicio lo valida). */
  esperaMin: z.number().int().positive().nullable().optional(),
  /** Frecuencia base de la fila de salida (min); solo con `rol = 'terminal'` (el servicio lo valida). */
  frecuenciaSalidaMin: z.number().int().min(1).max(120).nullable().optional(),
});
export type PuntoControl = z.infer<typeof PuntoControlSchema>;

export const CrearPuntoControlSchema = PuntoControlSchema.omit({
  id: true,
  rutaId: true,
  obligatorio: true,
  estado: true,
}).extend({
  obligatorio: z.boolean().default(true),
  estado: EstadoPuntoControlSchema.default('activo'),
});
export type CrearPuntoControl = z.infer<typeof CrearPuntoControlSchema>;

export const ActualizarPuntoControlSchema = PuntoControlSchema.omit({ id: true, rutaId: true }).partial();
export type ActualizarPuntoControl = z.infer<typeof ActualizarPuntoControlSchema>;

/**
 * ENTREGA 6 (plan post-piloto 2026-09-09, "separar detección de anuncio") — constantes
 * compartidas del anuncio al chofer, deliberadamente DISTINTAS de `radioToleranciaM` (la
 * detección/evidencia, que NO cambia — ver `apps/mobile/src/gps/geofence.ts`,
 * `filtrarNuevosCumplimientos`). Viven acá (no hardcodeadas en `apps/mobile`) porque las
 * consume tanto el móvil (voz + confirmación) como, potencialmente, un panel de operaciones
 * que quiera mostrar el mismo criterio.
 *
 * Diagnóstico del piloto del 09-09: con el radio de detección de producción (150 m) y el
 * muestreo cada 15 m constantes, la voz decía "alcanzado" apenas el primer fix caía DENTRO del
 * círculo — entre 104 y 150 m del punto real, según la perpendicular de paso. Geometría
 * determinista, no un bug — pero un defecto de producto: el chofer necesita un aviso
 * informativo TEMPRANO (mientras se acerca) y una confirmación de paso creíble CERCA del punto,
 * y hoy son el mismo evento.
 */

/**
 * Radio (metros) dentro del cual se dispara el AVISO de aproximación por voz — informativo,
 * NO toca la máquina de estados de detección (que sigue evaluando contra
 * `pc.radioToleranciaM`, sin cambios). Igual al radio de detección de producción (150 m, ver
 * `scripts/data/z12-circuito/puntos-control.json` y `scripts/cargar-linea-120.ts`) para que el
 * chofer escuche el aviso apenas el punto entra en el radio que de verdad cuenta como
 * evidencia — no antes (ruido) ni después (tarde para reaccionar).
 */
export const RADIO_AVISO_M = 150;

/**
 * Radio (metros) DENTRO del cual el "mínimo local" de una visita se considera lo bastante
 * cerca del punto real como para confirmar el paso apenas la distancia empiece a crecer (ver
 * `filtrarNuevosCumplimientos`, `apps/mobile/src/gps/geofence.ts`, sección "mínimo local").
 * Un mínimo que nunca entra en este radio (punto plantado lejos de la trayectoria real, ver
 * "por qué 10 m es estructuralmente imposible" en el plan) no se descarta — el FALLBACK
 * OBLIGATORIO de fixes sin confirmar igual emite, para no perder evidencia — pero el caso
 * normal (el chofer efectivamente pasa cerca del punto) confirma apenas se detecta que el
 * vehículo empezó a alejarse de un mínimo ya creíble. Valor PROVISIONAL, sin validar contra
 * datos reales todavía (ver Entrega 18 del plan, replay SQL) — 40 m es un cuarto del radio de
 * detección de producción, lo bastante angosto para que "confirmado" se sienta como "al lado
 * del punto" y no como "en su misma cuadra".
 */
export const RADIO_CONFIRMACION_M = 40;
