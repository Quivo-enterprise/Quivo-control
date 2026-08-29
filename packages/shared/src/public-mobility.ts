import { z } from 'zod';
import { LineaGeoJsonSchema, PuntoGeoJsonSchema } from './geo.js';
import { uuidSchema } from './primitives.js';

/** Estado editorial independiente de que un recurso esté operativo. */
export const EstadoPublicacionSchema = z.enum(['borrador', 'validado', 'publicado', 'archivado']);
export type EstadoPublicacion = z.infer<typeof EstadoPublicacionSchema>;

export const MobilityCityIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type MobilityCityId = z.infer<typeof MobilityCityIdSchema>;

export const MobilityCoverageStatusSchema = z.enum(['ready', 'community', 'coming_soon']);
export type MobilityCoverageStatus = z.infer<typeof MobilityCoverageStatusSchema>;

export const PublicMobilityCitySchema = z.object({
  id: MobilityCityIdSchema,
  name: z.string().min(1).max(200),
  departmentCode: z.string().max(20).nullable(),
  departmentName: z.string().max(200).nullable(),
  countryCode: z.string().length(2).nullable(),
  timezone: z.string().max(80).nullable(),
  coverageStatus: MobilityCoverageStatusSchema,
  sourceType: z.string().max(80).nullable(),
  sourceName: z.string().max(200).nullable(),
  sourceLicense: z.string().max(200).nullable(),
  sourceUpdatedAt: z.string().datetime().nullable(),
  availableModes: z.array(z.string().max(40)),
  auxiliaryServices: z.array(z.string().max(80)),
});
export type PublicMobilityCity = z.infer<typeof PublicMobilityCitySchema>;

export const PublicOperatorSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
});
export type PublicOperator = z.infer<typeof PublicOperatorSchema>;

export const PublicLineBrandingSchema = z.object({
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  textColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  shortName: z.string().nullable(),
  tagline: z.string().nullable(),
  markerType: z.string().nullable(),
  markerValue: z.string().nullable(),
  roofSign: z.string().nullable(),
});
export type PublicLineBranding = z.infer<typeof PublicLineBrandingSchema>;

export const PublicLineSchema = z.object({
  id: uuidSchema,
  cityId: MobilityCityIdSchema,
  cityName: z.string().min(1).max(200),
  departmentCode: z.string().max(20).nullable(),
  departmentName: z.string().max(200).nullable(),
  operator: PublicOperatorSchema,
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  branding: PublicLineBrandingSchema,
  updatedAt: z.string().datetime(),
});
export type PublicLine = z.infer<typeof PublicLineSchema>;

export const PublicVariantSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
});
export type PublicVariant = z.infer<typeof PublicVariantSchema>;

export const PublicStopSchema = z.object({
  id: uuidSchema,
  cityId: MobilityCityIdSchema,
  routeId: uuidSchema,
  name: z.string().min(1).max(200),
  reference: z.string().nullable(),
  type: z.enum(['origen', 'intermedia', 'destino']),
  order: z.number().int().nonnegative(),
  coordinate: PuntoGeoJsonSchema,
  updatedAt: z.string().datetime(),
});
export type PublicStop = z.infer<typeof PublicStopSchema>;

export const PublicRouteSchema = z.object({
  id: uuidSchema,
  cityId: MobilityCityIdSchema,
  lineId: uuidSchema,
  direction: z.string().min(1).max(50),
  geometry: LineaGeoJsonSchema,
  variants: z.array(PublicVariantSchema),
  stops: z.array(PublicStopSchema),
  updatedAt: z.string().datetime(),
});
export type PublicRoute = z.infer<typeof PublicRouteSchema>;

export const PublicLineDetailSchema = PublicLineSchema.extend({
  routes: z.array(PublicRouteSchema),
});
export type PublicLineDetail = z.infer<typeof PublicLineDetailSchema>;

/** Resultado seguro de escanear un QR: sólo apunta al contenido público de la línea. */
export const PublicVehicleQrSchema = z.object({
  lineId: uuidSchema,
});
export type PublicVehicleQr = z.infer<typeof PublicVehicleQrSchema>;

export const JourneySearchRequestSchema = z.object({
  cityId: MobilityCityIdSchema.optional(),
  origin: PuntoGeoJsonSchema,
  destination: PuntoGeoJsonSchema,
  maxWalkingMeters: z.number().int().min(100).max(2_000).optional().default(600),
});
export type JourneySearchRequest = z.infer<typeof JourneySearchRequestSchema>;

export const JourneySegmentSchema = z.object({
  type: z.enum(['walk', 'transit', 'transfer']),
  distanceMeters: z.number().nonnegative().optional(),
  durationMinutes: z.number().nonnegative(),
  line: z.object({ id: uuidSchema, code: z.string(), name: z.string() }).optional(),
  routeId: uuidSchema.optional(),
  direction: z.string().optional(),
});
export type JourneySegment = z.infer<typeof JourneySegmentSchema>;

export const JourneyOptionSchema = z.object({
  id: z.string().min(1),
  score: z.number().nonnegative(),
  estimatedDurationMinutes: z.number().nonnegative(),
  walkingDistanceMeters: z.number().nonnegative(),
  transportDistanceMeters: z.number().nonnegative(),
  transfers: z.number().int().nonnegative(),
  segments: z.array(JourneySegmentSchema).min(1),
});
export type JourneyOption = z.infer<typeof JourneyOptionSchema>;

export const JourneySearchResponseSchema = z.object({
  options: z.array(JourneyOptionSchema),
  /** Subconjunto de `options[].id` que el planner destaca como mejor alternativa por eje (más rápida, menos transbordos, menos caminata). La UI decide cómo mostrarlas, sin descartar el resto. */
  recommendedIds: z.array(z.string().min(1)),
});
export type JourneySearchResponse = z.infer<typeof JourneySearchResponseSchema>;
