-- Favoritos, lugares y búsquedas recientes: datos de experiencia, separados de Control.

CREATE TABLE "passenger_favorite_lines" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passenger_favorite_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "passenger_favorite_lines_userId_lineId_key" ON "passenger_favorite_lines"("userId", "lineId");
CREATE INDEX "passenger_favorite_lines_userId_createdAt_idx" ON "passenger_favorite_lines"("userId", "createdAt");
ALTER TABLE "passenger_favorite_lines" ADD CONSTRAINT "passenger_favorite_lines_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_saved_places" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coordinate" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "passenger_saved_places_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "passenger_saved_places_userId_updatedAt_idx" ON "passenger_saved_places"("userId", "updatedAt");
ALTER TABLE "passenger_saved_places" ADD CONSTRAINT "passenger_saved_places_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passenger_recent_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "origin" JSONB NOT NULL,
    "destination" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passenger_recent_searches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "passenger_recent_searches_userId_createdAt_idx" ON "passenger_recent_searches"("userId", "createdAt");
ALTER TABLE "passenger_recent_searches" ADD CONSTRAINT "passenger_recent_searches_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passenger_favorite_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_favorite_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_saved_places" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_saved_places" FORCE ROW LEVEL SECURITY;
ALTER TABLE "passenger_recent_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passenger_recent_searches" FORCE ROW LEVEL SECURITY;

CREATE POLICY passenger_favorite_owner ON "passenger_favorite_lines"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_place_owner ON "passenger_saved_places"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
CREATE POLICY passenger_recent_search_owner ON "passenger_recent_searches"
  USING (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true))
  WITH CHECK (current_setting('app.rol', true) = 'admin_quivo' OR "userId" = current_setting('app.user_id', true));
