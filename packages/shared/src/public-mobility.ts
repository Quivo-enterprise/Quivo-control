import { z } from 'zod';
import { LineaGeoJsonSchema, PuntoGeoJsonSchema } from './geo.js';
import { uuidSchema } from './primitives.js';

/** Estado editorial independiente de que un recurso esté operativo. */
export const EstadoPublicacionSchema = z.enum(['borrador', 'validado', 'publicado', 'archivado']);
export type EstadoPublicacion = z.infer<typeof EstadoPublicacionSchema>;

/** Id de ciudad para el catálogo de cobertura de `MobilityCity` (Control lo usa para
 * scopear líneas por ciudad, ver `packages/shared/src/entities/linea.ts`). */
export const MobilityCityIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type MobilityCityId = z.infer<typeof MobilityCityIdSchema>;

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
