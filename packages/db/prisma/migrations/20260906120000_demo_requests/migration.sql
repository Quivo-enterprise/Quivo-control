-- Solicitudes públicas de demostración de control.myquivo.com.
CREATE TABLE "demo_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "vehicleCount" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'landing',
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_requests_createdAt_idx" ON "demo_requests"("createdAt");
CREATE INDEX "demo_requests_status_createdAt_idx" ON "demo_requests"("status", "createdAt");

-- El rol runtime ya recibe estos permisos por los privilegios por defecto de la
-- migración de RLS; se repite de forma explícita para instalaciones parciales.
GRANT SELECT, INSERT, UPDATE ON "demo_requests" TO quivo_app;
