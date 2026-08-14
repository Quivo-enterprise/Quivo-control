# Credenciales de Desarrollo — QUIVO Control

Documento de referencia con todas las credenciales locales de acceso para desarrolladores y pasantes.

---

## 📱 1. Aplicación Móvil (QUIVO Conductor)

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

---

## 💻 2. Aplicación Web / Panel Administrativo (`apps/web`)

- **URL de desarrollo:** `http://localhost:3000`
- **Contraseña general para todos los usuarios demo:** `Quivo123!`

| Rol | Correo Electrónico | Contraseña | Alcance / Permisos |
| :--- | :--- | :--- | :--- |
| **SuperAdmin QUIVO** | `admin@quivo.local` | `Quivo123!` | Acceso global sin restricción de tenant |
| **Admin Sindicato** | `admin@sindicato.local` | `Quivo123!` | Administrador de Sindicato 1º de Mayo |

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
- **JWT Secret (Dev):** `change-me-in-production`

---

## 🚀 4. Guía Rápida para Pasantes / Desarrolladores

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
