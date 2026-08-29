import { z } from 'zod';
import { PuntoGeoJsonSchema } from './geo.js';

export const PassengerDevicePlatformSchema = z.enum(['expo', 'fcm', 'apns', 'web']);
export type PassengerDevicePlatform = z.infer<typeof PassengerDevicePlatformSchema>;

export const RegisterPassengerDeviceRequestSchema = z.object({
  deviceId: z.string().trim().min(1).max(160),
  platform: PassengerDevicePlatformSchema,
  token: z.string().trim().min(10).max(4096),
  appVersion: z.string().trim().max(80).optional(),
});
export type RegisterPassengerDeviceRequest = z.infer<typeof RegisterPassengerDeviceRequestSchema>;

export const PassengerDeviceSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().min(1).max(160),
  platform: PassengerDevicePlatformSchema,
  appVersion: z.string().nullable(),
  enabled: z.boolean(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type PassengerDevice = z.infer<typeof PassengerDeviceSchema>;

export const PassengerNotificationCategorySchema = z.enum([
  'line_change',
  'service_alert',
  'trip_reminder',
  'campaign',
  'system',
]);
export type PassengerNotificationCategory = z.infer<typeof PassengerNotificationCategorySchema>;

export const PassengerNotificationSchema = z.object({
  id: z.string().uuid(),
  category: PassengerNotificationCategorySchema,
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(4_000),
  deepLink: z.string().max(2_000).nullable(),
  readAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PassengerNotification = z.infer<typeof PassengerNotificationSchema>;

export const PassengerNotificationPreferencesSchema = z.object({
  serviceAlerts: z.boolean(),
  lineChanges: z.boolean(),
  tripReminders: z.boolean(),
  campaigns: z.boolean(),
  system: z.boolean(),
});
export type PassengerNotificationPreferences = z.infer<
  typeof PassengerNotificationPreferencesSchema
>;

export const UpdatePassengerNotificationPreferencesSchema =
  PassengerNotificationPreferencesSchema.partial();
export type UpdatePassengerNotificationPreferences = z.infer<
  typeof UpdatePassengerNotificationPreferencesSchema
>;

export const PassengerPlanFeatureSchema = z.object({
  code: z.string().min(1).max(100),
  value: z.string().min(1).max(500),
});
export type PassengerPlanFeature = z.infer<typeof PassengerPlanFeatureSchema>;

export const PassengerPlanSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  interval: z.enum(['month', 'year', 'one_time']),
  features: z.array(PassengerPlanFeatureSchema),
});
export type PassengerPlan = z.infer<typeof PassengerPlanSchema>;

export const PassengerSubscriptionSchema = z.object({
  id: z.string().uuid(),
  planCode: z.string().min(1).max(60),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'expired']),
  startsAt: z.string().datetime(),
  currentPeriodEnd: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type PassengerSubscription = z.infer<typeof PassengerSubscriptionSchema>;

export const PassengerEntitlementsSchema = z.object({
  plan: PassengerPlanSchema,
  subscription: PassengerSubscriptionSchema.nullable(),
  grants: z.record(z.string()),
});
export type PassengerEntitlements = z.infer<typeof PassengerEntitlementsSchema>;

export const PassengerFavoriteLineSchema = z.object({
  lineId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type PassengerFavoriteLine = z.infer<typeof PassengerFavoriteLineSchema>;

export const PassengerSavedPlaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  coordinate: PuntoGeoJsonSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PassengerSavedPlace = z.infer<typeof PassengerSavedPlaceSchema>;

export const CreatePassengerSavedPlaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  coordinate: PuntoGeoJsonSchema,
});
export type CreatePassengerSavedPlace = z.infer<typeof CreatePassengerSavedPlaceSchema>;

export const UpdatePassengerSavedPlaceSchema = CreatePassengerSavedPlaceSchema.partial();
export type UpdatePassengerSavedPlace = z.infer<typeof UpdatePassengerSavedPlaceSchema>;

export const PassengerRecentSearchSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(200).nullable(),
  origin: PuntoGeoJsonSchema,
  destination: PuntoGeoJsonSchema,
  createdAt: z.string().datetime(),
});
export type PassengerRecentSearch = z.infer<typeof PassengerRecentSearchSchema>;

export const CreatePassengerRecentSearchSchema = z.object({
  label: z.string().trim().max(200).optional(),
  origin: PuntoGeoJsonSchema,
  destination: PuntoGeoJsonSchema,
});
export type CreatePassengerRecentSearch = z.infer<typeof CreatePassengerRecentSearchSchema>;

export const PassengerAlertTargetSchema = z.enum(['line', 'route']);
export type PassengerAlertTarget = z.infer<typeof PassengerAlertTargetSchema>;

export const PassengerAlertSubscriptionSchema = z.object({
  targetType: PassengerAlertTargetSchema,
  targetId: z.string().uuid(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PassengerAlertSubscription = z.infer<typeof PassengerAlertSubscriptionSchema>;
