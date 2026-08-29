-- Datos privados de experiencia, notificaciones y catálogo de capacidades para QUIVO Rutas.

CREATE TABLE "passenger_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "appVersion" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_devices_tokenHash_key" ON "passenger_devices"("tokenHash");
CREATE UNIQUE INDEX "passenger_devices_userId_deviceId_key" ON "passenger_devices"("userId", "deviceId");
CREATE INDEX "passenger_devices_userId_enabled_idx" ON "passenger_devices"("userId", "enabled");
ALTER TABLE "passenger_devices" ADD CONSTRAINT "passenger_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "lineChanges" BOOLEAN NOT NULL DEFAULT true,
    "tripReminders" BOOLEAN NOT NULL DEFAULT true,
    "campaigns" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_notification_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_notification_preferences_userId_key"
  ON "passenger_notification_preferences"("userId");
ALTER TABLE "passenger_notification_preferences" ADD CONSTRAINT "passenger_notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "passenger_notifications_userId_createdAt_idx"
  ON "passenger_notifications"("userId", "createdAt");
CREATE INDEX "passenger_notifications_userId_readAt_createdAt_idx"
  ON "passenger_notifications"("userId", "readAt", "createdAt");
ALTER TABLE "passenger_notifications" ADD CONSTRAINT "passenger_notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_notification_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_notification_deliveries_notificationId_deviceId_key"
  ON "passenger_notification_deliveries"("notificationId", "deviceId");
CREATE INDEX "passenger_notification_deliveries_status_updatedAt_idx"
  ON "passenger_notification_deliveries"("status", "updatedAt");
ALTER TABLE "passenger_notification_deliveries" ADD CONSTRAINT "passenger_notification_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "passenger_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_notification_deliveries" ADD CONSTRAINT "passenger_notification_deliveries_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "passenger_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_alert_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_alert_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_alert_subscriptions_userId_targetKey_key"
  ON "passenger_alert_subscriptions"("userId", "targetKey");
CREATE INDEX "passenger_alert_subscriptions_targetType_targetId_enabled_idx"
  ON "passenger_alert_subscriptions"("targetType", "targetId", "enabled");
ALTER TABLE "passenger_alert_subscriptions" ADD CONSTRAINT "passenger_alert_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_plans_code_key" ON "passenger_plans"("code");
CREATE INDEX "passenger_plans_active_priceCents_idx" ON "passenger_plans"("active", "priceCents");

CREATE TABLE "passenger_plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_plan_features_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_plan_features_planId_code_key" ON "passenger_plan_features"("planId", "code");
ALTER TABLE "passenger_plan_features" ADD CONSTRAINT "passenger_plan_features_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "passenger_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "provider" TEXT,
    "providerSubscriptionId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "passenger_subscriptions_userId_status_currentPeriodEnd_idx"
  ON "passenger_subscriptions"("userId", "status", "currentPeriodEnd");
CREATE UNIQUE INDEX "passenger_subscriptions_provider_providerSubscriptionId_key"
  ON "passenger_subscriptions"("provider", "providerSubscriptionId");
ALTER TABLE "passenger_subscriptions" ADD CONSTRAINT "passenger_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passenger_subscriptions" ADD CONSTRAINT "passenger_subscriptions_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "passenger_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "passenger_entitlement_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_entitlement_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_entitlement_grants_userId_code_source_key"
  ON "passenger_entitlement_grants"("userId", "code", "source");
CREATE INDEX "passenger_entitlement_grants_userId_code_expiresAt_idx"
  ON "passenger_entitlement_grants"("userId", "code", "expiresAt");
ALTER TABLE "passenger_entitlement_grants" ADD CONSTRAINT "passenger_entitlement_grants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plan gratuito y plan de prueba de capacidades. El cobro real se habilita por proveedor
-- en una fase posterior; las capacidades ya son server-side desde el primer día.
INSERT INTO "passenger_plans" ("id", "code", "name", "description", "priceCents", "currency", "interval", "active", "createdAt", "updatedAt")
VALUES
  ('70000000-0000-4000-8000-000000000001', 'free', 'Gratis', 'Consulta pública de movilidad', 0, 'BOB', 'month', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('70000000-0000-4000-8000-000000000002', 'plus', 'QUIVO Plus', 'Alertas y preferencias ampliadas', 1900, 'BOB', 'month', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "passenger_plan_features" ("id", "planId", "code", "value", "createdAt", "updatedAt")
VALUES
  ('71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'saved_places_limit', '3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('71000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'advanced_alerts', 'false', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('71000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000002', 'saved_places_limit', 'unlimited', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('71000000-0000-4000-8000-000000000004', '70000000-0000-4000-8000-000000000002', 'advanced_alerts', 'true', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("planId", "code") DO NOTHING;

-- Owner isolation para recursos privados. `admin_quivo` conserva capacidad de soporte;
-- el resto solo puede ver filas cuyo userId coincide con el contexto de la request.
ALTER TABLE "passenger_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notification_preferences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notifications" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_notification_deliveries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_alert_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_alert_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_entitlement_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_entitlement_grants" FORCE ROW LEVEL SECURITY;

CREATE POLICY passenger_device_owner ON "passenger_devices"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_preference_owner ON "passenger_notification_preferences"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_notification_owner ON "passenger_notifications"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_alert_owner ON "passenger_alert_subscriptions"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_subscription_owner ON "passenger_subscriptions"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_grant_owner ON "passenger_entitlement_grants"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));

-- Las entregas se acceden por sus relaciones y nunca se exponen como un recurso de
-- pasajero; se aíslan por la notificación/dispositivo asociado.
CREATE POLICY passenger_delivery_owner ON "passenger_notification_deliveries"
  USING (
    current_setting('app.rol', true) = 'admin_quivo'
    OR EXISTS (SELECT 1 FROM "passenger_notifications" n WHERE n.id = "notificationId" AND n."userId" = current_setting('app.user_id', true))
  )
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo');
