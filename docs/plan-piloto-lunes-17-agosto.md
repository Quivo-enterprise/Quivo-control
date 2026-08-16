# Plan de cierre — piloto del lunes 17 de agosto de 2026

> Escrito el 2026-08-15. **Este documento reemplaza a `plan-finalizacion-piloto.md`** como fuente
> de verdad del alcance y las fechas. Aquel plan apunta el piloto al 5–19 de octubre y trata al
> spike GPS como gate previo; ambas premisas quedaron obsoletas.

## Qué cambió

El CTO confirmó el 2026-08-15 que **el piloto real arranca el lunes 17 de agosto con un auto**.
Quedan dos días: sábado 15 y domingo 16.

Decisiones que enmarcan el plan:

1. **Distribución por APK directo instalado a mano.** Google Play queda fuera hasta que se pague
   la cuenta. QUI-351 y la parte de *closed testing* de QUI-364 salen del camino crítico.
2. **Transistorsoft con el trial de 30 días**, no compra. La key va a los secrets de EAS.
   **Vence alrededor del 16 de septiembre de 2026** — decidir la compra antes de esa fecha.
3. **Backend en GCP Cloud Run**, según el ADR 0002 (`southamerica-west1`).
4. **Piloto real, un auto.** No es una demo: los datos del lunes cuentan.
5. **Teléfonos disponibles recién el domingo.** El APK tiene que estar listo el sábado a la noche.

### Consecuencias

- **QUI-216 (spike GPS de 8 h) deja de ser un gate previo.** Se absorbe en la prueba del domingo
  en teléfono real y en el piloto del lunes.
- **Aparece un bloqueo nuevo en el camino crítico: el backend tiene que estar desplegado con
  HTTPS antes del lunes.** El teléfono del conductor no llega a `localhost`. Eso convierte a
  QUI-354 (Dockerfiles) y QUI-213 (GCP) en bloqueantes duros, no diferibles.
- Atenuante: la app es offline-first con outbox SQLite. Solo necesita conexión para bajar el
  paquete del día y sincronizar, no durante toda la jornada.

## Principio de organización

El camino crítico pasa por **las manos del CTO**: consola de GCP, build del APK, y el teléfono en
la ruta el domingo. Nada de eso lo hace un subagente.

Por eso: los subagentes primero desbloquean al CTO (el código que necesita para desplegar y
buildear), y todo lo que no es del lunes corre en paralelo en otros subagentes.

---

## Vía 1 — camino crítico del lunes

### Sábado: desplegar y buildear (25 pts)

| Issue | Qué | Pts |
|---|---|---|
| QUI-354 | Dockerfile de `apps/api` con dos `CMD` (API y worker) + `enableShutdownHooks()` + liveness/readiness separados. **Y un Dockerfile aparte para `apps/web`** — QUI-213 confirma que el panel también va a Cloud Run, porque Firebase App Hosting no tiene región sudamericana | 3 |
| QUI-356 | Guardarraíl de arranque para `JWT_SECRET` + purgar el default publicado en `CREDENCIALES.md` y `.env.example` + bajar `JWT_REFRESH_TTL` de 30d a 7d | 1 |
| QUI-358 | `sindicatoId` + RLS en `gps_points`. Barato hoy (tabla vacía); en 3 meses son ~90 particiones y backfill con downtime | 3 |
| QUI-357 | `usesCleartextTraffic: false`. Ahora es posible porque Cloud Run da HTTPS | 1 |
| QUI-359 | Rotación del refresh token en el panel web, portando el patrón de compare-and-swap que ya usa `auth-movil.service.ts:275` | 2 |
| QUI-213 | GCP: Cloud Run (API + worker + web), Cloud SQL PostGIS, Memorystore, Secret Manager, Terraform | 5 |
| QUI-366 | Seed del sindicato real: 1 línea, 1 ruta con geometría, puntos de control, **1 vehículo y 1 conductor** — el piloto es con un solo auto. Más el segundo tenant de aislamiento | 2 |
| QUI-364 | Build release firmado para sideload: EAS + keystore + key trial de Transistorsoft + **URL del API apuntando a Cloud Run** | 5 |
| QUI-365 | Sentry en `apps/mobile` con release tagging, cubriendo también el headless task de GPS | 2 |
| QUI-367 | Checklist de aceptación con umbrales numéricos y criterios de aborto | 1 |

**Trampa a evitar:** un APK firmado apuntando a `localhost` se ve perfecto hasta que sale a la
calle. La URL base del API del perfil de release es lo último que hay que verificar antes de
firmar.

### Domingo: prueba en teléfono real

Reemplaza al spike de 8 h. Con el APK instalado, recorriendo la ruta:

1. El tracking en background sigue vivo con la pantalla apagada.
2. **Sobrevive a matar la app y a un reboot del teléfono.**
3. Consumo de batería medido en el trayecto.
4. Huecos entre puntos GPS bajo el umbral del checklist.
5. Los puntos de control se detectan solos al pasar.
6. El outbox sincroniza contra **Cloud Run**, no contra local.
7. El recorrido se reconstruye correctamente en el panel web.

**Fallback si el tracking en background falla categóricamente:** correr el lunes con registro
manual del conductor. Degradado, pero el piloto no se cae delante del sindicato.

### Domingo: lo que toca al conductor (8 pts)

| Issue | Qué | Pts |
|---|---|---|
| QUI-348 | Los 4 bugs del sprint M6. El peor es `use-sync-status.ts:36`: usa `&&` donde va `||`, así que con `isInternetReachable === null` — lo habitual en Android de gama baja — el banner offline nunca aparece | 3 |
| QUI-338 | `errorSync` nunca se renderiza; permiso de ubicación denegado sin mensaje propio ni deep-link a Ajustes | 3 |
| QUI-346 | Timestamp de última sincronización exitosa + estado de fallo definitivo distinguible de "reintentando" | 2 |

Criterio de corte: solo lo que un conductor puede encontrarse el lunes.

---

## Vía 2 — en paralelo, no bloquea el lunes

### Rescate de los 3 PRs abiertos de Valentina

| PR | Issue | Veredicto |
|---|---|---|
| #8 | QUI-339 | **Split.** El doc WCAG de 236 líneas es real y verificado. Pero contrabandea un helper `parseDate` en `auditoria.service.ts:19` y `sync-errores.service.ts:18` que no arregla nada: los schemas ya usan `z.coerce.date()` y el pipe global entrega `Date`. Mergear solo el doc — y así desaparece el conflicto con el #14 |
| #9 | QUI-340 | **Rescatar tal cual.** Único conflicto es `pnpm-lock.yaml`: rebase + `pnpm install`. El título promete "fixtures propios" que no existen (es seeding inline por UI) |
| #14 | QUI-342 | **Rescatar con fixes.** CI rojo por dos `eslint-disable-next-line react-hooks/exhaustive-deps` en `reportes/page.tsx:86,124` que referencian un plugin ausente. **El lint rojo esconde un bug real**: el refactor de fechas renombró variables en 2 de 4 funciones — `exportes.service.ts:191` y `:280` siguen usando `${desde}`/`${hasta}` en el SQL. Sin filtro de fecha interpola `undefined` en `$queryRaw` |

### Hardening diferido (16 pts)

QUI-355 (filtro `sindicatoId` en 8 servicios) · QUI-360 (`audit_log` REVOKE + ip/userAgent) ·
QUI-361 (concurrencia del worker) · QUI-362 (paginación de recorridos) · **QUI-363 (prueba
negativa de RLS)** · QUI-252 (particiones diarias) · QUI-347 (fixes de accesibilidad) ·
QUI-250 (scripts de k6).

QUI-363 no bloquea el lunes pero es la que valida a todas las demás: si se rompe una policy a
propósito y la suite sigue verde, el aislamiento multi-tenant es teatro.

### Fuera de alcance

QUI-216 (absorbido por el piloto) · QUI-237 (se valida en campo) · QUI-351 (Play, diferida) ·
QUI-350 (resuelta con el trial) · QUI-368 (M7) · QUI-253 (empieza el lunes, se cierra con acta).

---

## Verificación

**Del código:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `pnpm test:acceptance`
en verde local, y CI verde (`ci` + `acceptance`) antes de cada merge.

**Del despliegue (sábado):** `/health` de Cloud Run responde por HTTPS desde fuera de la red del
CTO · login web contra el API desplegado · aislamiento cross-tenant probado a mano con dos
sesiones de distinto `sindicatoId`.

**Del piloto (domingo):** los 7 puntos de la prueba en teléfono real.

## Entorno local

Turbo no propaga el `.env` y la máquina del CTO tiene Node v24 mientras el repo pide `>=22 <23`:

```bash
export npm_config_engine_strict=false
export DATABASE_URL="postgresql://quivo:quivo_dev@localhost:5434/quivo_control"
export RUNTIME_DATABASE_URL="postgresql://quivo_app:quivo_app_dev@localhost:5434/quivo_control"
export JWT_SECRET="ci-only-secret-never-use-in-production-000000"
export REDIS_URL="redis://localhost:6380"
export BETTER_AUTH_URL="http://localhost:3001"
docker compose up -d postgres redis
```

`RUNTIME_DATABASE_URL` apunta al rol `quivo_app`, el único sin `BYPASSRLS`. Sin ella la conexión
cae al superusuario `quivo`, Postgres ignora RLS y los tests de aislamiento no verifican nada.
**En Cloud Run va a Secret Manager, nunca a una variable en claro.** Si Better-Auth falla con
`Failed to decrypt private key`: `DELETE FROM jwks;`.
