# Credenciales de Desarrollo — QUIVO Control

Documento de referencia con todas las credenciales locales de acceso para desarrolladores y pasantes.

> **Importante — qué es demo y qué NO.** Todo lo de este documento (placas, CI, PINs,
> password de los usuarios web) es **exclusivamente demo/desarrollo**: sindicatos
> `Sindicato 1º de Mayo` / `Sindicato Unificado del Norte` (`SINDICATO_A_ID`/`SINDICATO_B_ID`
> en `packages/db/prisma/seed.ts`) y la cuenta `admin@aislamiento.local`. **El sindicato del
> piloto real (QUI-366) NO está acá y sus credenciales NO se publican en ningún archivo del
> repo.** Las 6 credenciales de prueba del piloto (1 chofer + 5 pasantes) usan un PIN
> generado al azar en el momento de creación (ver sección 5) — reusar los PINs demo de abajo
> contra las placas/CI del piloto no funciona: son secretos distintos, generados por
> separado, y ni el seed ni el script del piloto los revierten una vez creados/rotados.

---

## 📱 1. Aplicación Móvil (QUIVO Conductor) — SOLO DEMO

La app móvil utiliza una autenticación encadenada en **dos pasos**:
- **Paso 1:** Placa del vehículo + PIN del vehículo.
- **Paso 2:** Documento de Identidad (CI) del chofer + PIN del chofer.

### Sindicato 1: Sindicato 1º de Mayo
| Entidad | Campo Identificador | Valor Demo | PIN |
| :--- | :--- | :--- | :--- |
| **Vehículo** | Placa | `1001ABC` | `246810` |
| **Chofer** | Documento Identidad (CI) | `1000101 LP` | `135790` |
| **Línea/Ruta** | Código | `L1` (Línea 1) | N/A |

### Sindicato 2: Sindicato Unificado del Norte
| Entidad | Campo Identificador | Valor Demo | PIN |
| :--- | :--- | :--- | :--- |
| **Vehículo** | Placa | `2002DEF` | `246810` |
| **Chofer** | Documento Identidad (CI) | `2000202 SC` | `135790` |
| **Línea/Ruta** | Código | `L1` (Línea 1) | N/A |

> **Nota sobre PINes:** Los PINes por defecto son `246810` (vehículo) y `135790` (chofer). Se pueden cambiar mediante las variables de entorno `MOBILE_SEED_VEHICLE_PIN` y `MOBILE_SEED_DRIVER_PIN`.
>
> **Estos dos sindicatos y sus PINs son SOLO demo/desarrollo — nunca usar este patrón para
> un tenant real.** El sindicato piloto real deliberadamente NO participa de este mecanismo
> (ver sección 5).

---

## 💻 2. Aplicación Web / Panel Administrativo (`apps/web`)

- **URL de desarrollo:** `http://localhost:3000`
- **Contraseña general para todos los usuarios demo:** `Quivo123!`

| Rol | Correo Electrónico | Contraseña | Alcance / Permisos |
| :--- | :--- | :--- | :--- |
| **SuperAdmin QUIVO** | `admin@quivo.local` | `Quivo123!` | Acceso global sin restricción de tenant |
| **Admin Sindicato** | `admin@sindicato.local` | `Quivo123!` | Administrador de Sindicato 1º de Mayo |
| **Admin Aislamiento** | `admin@aislamiento.local` | `Quivo123!` | Solo pruebas E2E de aislamiento cross-tenant (QUI-366); RLS lo limita al tenant de aislamiento, no toca datos del piloto |

> **Riesgo residual conocido:** estas tres cuentas viven en la misma base que el sindicato
> piloto, con contraseña publicada acá. RLS acota `admin@aislamiento.local` a su propio
> tenant, así que no puede leer/escribir datos del piloto — pero sigue siendo una cuenta
> real y activa con password conocido. Separar el seed demo del seed del piloto (bases o
> proyectos distintos) quedó fuera de alcance del fix QUI-366 por tiempo; recomendación: si
> el piloto pasa de prueba a producción real, mover el seed demo a un entorno aparte o
> borrar estas cuentas de la base del piloto.

---

## 🗄️ 3. Base de Datos e Infraestructura Local

### Servicios en Docker (`docker-compose.yml`)
- **Postgres (Puerto host 5434):**
  - **Superusuario (Migraciones/Admin):** `postgresql://quivo:quivo_dev@localhost:5434/quivo_control`
  - **Usuario Aplicación (Runtime/RLS):** `postgresql://quivo_app:quivo_app_dev@localhost:5434/quivo_control`
- **Redis (Puerto host 6380):**
  - **URL:** `redis://localhost:6380`

### Servidor API / Backend (`apps/api`)
- **URL API:** `http://localhost:3001`
- **JWT Secret (Dev):** no publicado acá (QUI-356). Vive solo en tu `.env` local, sin
  commitear. Generá el tuyo con `openssl rand -base64 32` y copialo a `JWT_SECRET` en
  `.env` (ver `.env.example`) — fuera de `development`, el arranque falla si falta, si es
  un valor de ejemplo conocido, o si es demasiado corto.

---

## 🔒 5. Sindicato Piloto Real (QUI-366) — NO son credenciales demo

El sindicato piloto (arranca el lunes) es datos reales: sus eventos GPS son evidencia legal
para sanciones a un conductor real. Por eso **no** comparte el mecanismo de PIN fijo de la
sección 1, y **no** genera vehículo/conductor desde `packages/db/prisma/seed.ts` — ese seed
solo siembra la línea/ruta/puntos de control del sindicato piloto (placeholder hasta que el
CTO carga el circuito real con `scripts/cargar-circuito-z12.ts`); ya no crea ninguna
credencial (el vehículo/conductor placeholder `PILOTO001`/`PILOTO-CI-001` que existía antes
se retiró: esa placa no pasaba la validación de placa boliviana y llegó a romper el listado
del panel).

- **Fuente de las credenciales de prueba:** `scripts/crear-credenciales-piloto.ts`. Crea
  **6 credenciales autocontenidas** — 1 chofer + 5 pasantes, con placa PTA ficticia pero
  válida (`9001TST`..`9006TST`) — repartidas 3 en la ruta Z12 y 3 en la ruta `circuito` de la
  línea 120. Requiere que la línea/ruta Z12 (seed) y la ruta 120-circuito
  (`scripts/cargar-linea-120.ts --apply`) ya existan; si no, aborta con instrucciones de qué
  correr antes.
- **Cómo correrlo:**
  ```bash
  DATABASE_URL=postgresql://quivo:quivo_dev@localhost:5434/quivo_control \
    pnpm exec tsx scripts/crear-credenciales-piloto.ts
  ```
  Sin flags: siempre aplica (`COMMIT`) si todo verifica.
- **PINes:** cada conductor recibe un PIN numérico de 6 dígitos generado al azar
  (`crypto.randomInt`). Se **imprime una única vez por consola, después del `COMMIT`**, con
  el aviso de que hay que anotarlo porque no se vuelve a mostrar — **nunca queda en este
  archivo ni en ningún otro archivo del repo**. Una fila que ya tenía PIN NO se vuelve a
  imprimir en corridas siguientes (queda "SIN TOCAR (ya tenía PIN)" en la salida).
- **Corridas siguientes son idempotentes y no pisan un PIN ya entregado.** El script es
  seguro de re-correr (ids fijos, upserts) para extender la cobertura de asignaciones hacia
  adelante — no duplica filas ni pisa el `credencialHash` de una fila existente. Para rotar
  los 6 PINs a propósito (en vez de dejarlos como estaban):
  ```bash
  FORZAR_PIN=1 DATABASE_URL=... pnpm exec tsx scripts/crear-credenciales-piloto.ts
  ```
- **Qué tiene que hacer el CTO:** correr el script una vez, copiar los PINs que imprime por
  consola (después del `COMMIT`) y guardarlos fuera del repo (gestor de secretos, no un
  archivo versionado). El script termina con una verificación de solo lectura que confirma,
  para las 6 credenciales, que hay una asignación vigente HOY que cumple exactamente la
  condición de login (`buscarCandidatosNivel1`, `auth-movil.service.ts`) — si alguna falla,
  lo avisa en la propia salida (no aborta: es diagnosticable, no necesariamente un bug del
  script).

---

## 🚀 6. Guía Rápida para Pasantes / Desarrolladores

1. **Iniciar todo el entorno de desarrollo:**
   ```bash
   pnpm dev
   ```
   *(Este comando levanta contenedores, ejecuta migraciones y seeds, y arranca API, Web y Metro).*

2. **Re-ejecutar el Seed de la Base de Datos:**
   ```bash
   pnpm --filter @quivo/db seed
   ```

3. **Iniciar sólo la App Móvil en Android:**
   ```bash
   pnpm --filter @quivo/mobile android
   ```
