# Credenciales de Desarrollo — QUIVO Control

Documento de referencia con todas las credenciales locales de acceso para desarrolladores y pasantes.

> **Importante — qué es demo y qué NO.** Todo lo de este documento (placas, CI, PINs,
> password de los usuarios web) es **exclusivamente demo/desarrollo**: sindicatos
> `Sindicato 1º de Mayo` / `Sindicato Unificado del Norte` (`SINDICATO_A_ID`/`SINDICATO_B_ID`
> en `packages/db/prisma/seed.ts`) y la cuenta `admin@aislamiento.local`. **El sindicato del
> piloto real (QUI-366) NO está acá y sus credenciales NO se publican en ningún archivo del
> repo.** El vehículo y el conductor del piloto usan un PIN generado al azar en el momento
> de creación (ver sección 5) — reusar los PINs demo de abajo contra la placa/CI reales del
> piloto no funciona: son secretos distintos, generados por separado, y el seed nunca los
> revierte una vez rotados.

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
sección 1.

- **Placa e identificadores** (`PILOTO001` / `PILOTO-CI-001` en `packages/db/prisma/seed.ts`)
  siguen siendo placeholder — el CTO carga la placa/CI reales antes de que arranque el
  piloto — pero el **PIN nunca es un valor publicado en este archivo ni en el repo**.
- La **primera vez** que corre el seed y el vehículo/conductor piloto todavía no existen,
  genera un PIN numérico aleatorio de 8 dígitos (`crypto.randomInt`, cumple el formato de
  `PinMovilSchema`) por separado para el vehículo y para el conductor, y lo **imprime una
  única vez en la salida del seed** con el aviso de que hay que anotarlo porque no se vuelve
  a mostrar (no queda en ningún log persistente propio ni se puede recuperar después). Se
  puede fijar a mano en vez de generarlo al azar con las variables de entorno
  `PILOTO_PIN_VEHICULO` / `PILOTO_PIN_CONDUCTOR` (mismo mecanismo que `MOBILE_SEED_*` de la
  sección 1, pero **exclusivo del piloto** — no lo confundas con esas).
- **Corridas siguientes del seed NUNCA tocan una credencial ya creada.** El seed corre en
  cada build de CI; antes de este fix, cada corrida revertía el PIN del vehículo/conductor
  piloto al PIN demo publicado (`246810`/`135790`), incluso después de que el CTO lo
  rotara a mano con el endpoint de credenciales. Ahora, si la fila ya existe, el seed no
  imprime nada nuevo ni modifica `credencialHash` — la única forma de cambiar el PIN del
  piloto después de la creación inicial es el endpoint (`establecerPinVehiculo` /
  `establecerPinConductor`), nunca re-correr el seed.
- **Qué tiene que hacer el CTO:** correr el seed una vez, copiar los dos PINs que imprime
  (o pre-fijarlos con `PILOTO_PIN_VEHICULO`/`PILOTO_PIN_CONDUCTOR` antes de esa primera
  corrida) y guardarlos fuera del repo (gestor de secretos, no un archivo versionado). Si
  ya corrió el seed contra la base del piloto con una versión anterior de este código (antes
  del fix), rotar el PIN a mano con el endpoint de credenciales — la corrida vieja pudo
  haber dejado la credencial demo puesta.

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
