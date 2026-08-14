# Informe de Auditoría de Accesibilidad (WCAG 2.1 AA) - QUI-339

Este informe detalla los hallazgos de accesibilidad en la plataforma web de administración, categorizados por severidad y criterio WCAG.

## Resumen Ejecutivo

**🔴 Alta Severidad:**
- **Formularios y labels**: 38 inputs o selects interactivos sin atributo `id` (rompe navegación para Screen Readers).
- **Textos alternativos**: 0 imágenes sin atributo `alt`.

**🟡 Media Severidad:**
- **Contraste de colores**: 129 colores hexadecimales hardcodeados que requieren revisión de contraste.
- **Semántica de íconos**: 8 íconos decorativos sin ocultamiento ARIA.

**🟢 Baja Severidad / Cumplimiento:**
- **Foco visible y teclado**: 100% de cumplimiento operativo (gestionado globalmente vía `globals.css`).

---

## 🔴 Hallazgos de Severidad Alta

### 1. Etiquetas de Formularios Desvinculadas (WCAG 1.3.1, 3.3.2)
**Problema:** Inputs interactivos sin atributo `id`, lo que impide vincularlos a un `<label htmlFor>`. Bloquea críticamente el uso con lectores de pantalla.

✅ **Cumplimiento Positivo:** Todos los inputs de las pantallas de alta/edición (socios, vehículos, conductores, líneas, etc.) gestionados vía `ModuleTablePage` están correctamente asociados mediante `id` y `htmlFor`.

**Excepciones detectadas (Falta `id`):**

| Ubicación (`path:line`) | Elemento Detectado | Criterio WCAG | Fix Propuesto |
|---|---|---|---|
| `apps/web/app/(dashboard)/auditoria/page.tsx:146` | `<Select label="Entidad" options={[ { label: 'Todas...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/auditoria/page.tsx:155` | `<Select label="Acción" options={[ { label: 'Todas'...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/auditoria/page.tsx:164` | `<Input label="Usuario (id)" value={usuarioId} onCh...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:401` | `<Select options={[{ label: 'Seleccionar...', value...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:432` | `<Select label="Estado" options={[ { label: 'Todos'...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:445` | `<Select label="Regla" options={[ { label: 'Todas',...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:643` | `<Select label="Regla" options={reglas.map((r) =>...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:649` | `<Select label="Tipo de sujeto" options={SUJETO_TIP...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:658` | `<Select label="Sujeto" options={opcionesSujeto} va...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reglas/page.tsx:670` | `<Input label="Referencia de evidencia (opcional)" ...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reportes/page.tsx:190` | `<Select label="Agrupar por" options={OPCIONES_AGRU...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reportes/page.tsx:248` | `<Select label="Estado de sanción" options={OPCIONE...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reportes/page.tsx:254` | `<Select label="Sujeto de sanción" options={OPCIONE...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/reportes/page.tsx:269` | `<Select label="Actividad por" options={OPCIONES_AC...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:386` | `<Input label="Periodo" placeholder="2026-09" value...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:467` | `<Input label="Buscar por período" placeholder="Ej....` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:475` | `<Select label="Estado" options={[ { label: 'Todos'...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:781` | `<Select label="Ruta" options={rutas.map((r) =>...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:787` | `<Select label="Conductor" options={[ { label: 'Sin...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:796` | `<Select label="Horario" options={HORARIOS} value={...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:880` | `<Select label="Vehículo" options={vehiculos.map((v...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:886` | `<Select label="Ruta" options={rutas.map((r) =>...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:892` | `<Select label="Conductor" options={[ { label: 'Sin...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:902` | `<Select label="Horario" options={HORARIOS} value={...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:908` | `<Input label="Orden" type="number" value={orden} o...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rutas/page.tsx:1349` | `<Input placeholder="Nombre de variante" value={nom...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rutas/page.tsx:1403` | `<Input label="Radio de tolerancia (m)" type="numbe...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/rutas/page.tsx:1418` | `<Input label="Orden" type="number" min="0" step="1...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/sync-errores/page.tsx:130` | `<Input label="Dispositivo" value={deviceId} onChan...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/sync-errores/page.tsx:135` | `<Input label="Sesión (id)" value={sesionId} onChan...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/usuarios/page.tsx:146` | `<Input label="Buscar por nombre o email" placehold...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/usuarios/page.tsx:152` | `<Select label="Rol" options={OPCIONES_ROL} value={...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/usuarios/page.tsx:197` | `<Input label="Email del usuario" type="email" valu...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/usuarios/page.tsx:203` | `<Input label="Contraseña nueva" type="password" va...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/usuarios/page.tsx:210` | `<Input label="Confirmar contraseña nueva" type="pa...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/vehiculos/page.tsx:269` | `<Select aria-label="Filtrar por tipo" options={TIP...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/app/(dashboard)/vehiculos/page.tsx:279` | `<Select aria-label="Filtrar por estado" options={O...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |
| `apps/web/src/lib/api/use-sindicato-options.ts:9` | `<Select>...` | 1.3.1 / 3.3.2 | Proveer un atributo `id` único y vincular con `<label htmlFor="...">` |

### 2. Ausencia de Textos Alternativos en Imágenes (WCAG 1.1.1)

**Problema:** Imágenes de contenido sin atributo `alt`, bloqueando la interpretación de lectores de pantalla.

✅ **Cumplimiento:** Todas las imágenes escaneadas cuentan con atributo `alt` válido.

## 🟡 Hallazgos de Severidad Media

### 3. Contraste de Colores Hardcodeados (WCAG 1.4.3 y 1.4.11)

**Problema:** Uso extensivo de colores hexadecimales fuera de los tokens CSS (`--qv-*`), impidiendo adaptabilidad a temas claro/oscuro.

> **Nota:** Se ha calculado el contraste asumiendo fondo blanco (`#ffffff`). Contraste menor a 4.5:1 falla.

| Ubicación (`path:line`) | Medición (Hex) | Contraste vs Blanco | Criterio WCAG | Fix Propuesto |
|---|---|---|---|---|
| `apps/web/app/(dashboard)/page.tsx:270` | `#d8dde6` | 1.36:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/reglas/page.tsx:684` | `#ddd` | 1.36:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/reglas/page.tsx:689` | `#eee` | 1.16:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/reportes/recorridos/[id]/page.tsx:104` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/reportes/recorridos/[id]/page.tsx:124` | `#16a34a` | 3.30:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/reportes/recorridos/[id]/page.tsx:124` | `#dc2626` | 4.83:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:523` | `#fff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:922` | `#ddd` | 1.36:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rotaciones/page.tsx:928` | `#eee` | 1.16:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#007f86` | 4.79:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#ff6b35` | 2.84:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#6750a4` | 6.44:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#1976d2` | 4.60:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#2e7d32` | 5.13:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:76` | `#c62828` | 5.62:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:722` | `#2e7d32` | 5.13:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:722` | `#c62828` | 5.62:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:746` | `#ff6b35` | 2.84:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:756` | `#2e7d32` | 5.13:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:765` | `#c62828` | 5.62:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:1459` | `#2e7d32` | 5.13:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/rutas/page.tsx:1467` | `#c62828` | 5.62:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/page.tsx:370` | `#94a3b8` | 2.56:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:560` | `#cbd5e1` | 1.48:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:819` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:835` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:837` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:841` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:842` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:856` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:858` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:861` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:862` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:880` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:882` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:885` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:886` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:887` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:888` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:889` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:904` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:906` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:910` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:911` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:912` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:913` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:931` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:933` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:936` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:937` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:938` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:939` | `#93c5fd` | 1.80:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:940` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:941` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:959` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:961` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:964` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:965` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1003` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1011` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1023` | `#334155` | 10.35:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1029` | `#334155` | 10.35:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1035` | `#334155` | 10.35:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1041` | `#334155` | 10.35:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1052` | `#fbbf24` | 1.67:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1053` | `#d97706` | 3.19:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1056` | `#ef4444` | 3.76:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1061` | `#475569` | 7.58:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1062` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1070` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1070` | `#0f172a` | 17.85:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1071` | `#94a3b8` | 2.56:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1072` | `#f8fafc` | 1.05:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1075` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1075` | `#0f172a` | 17.85:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1076` | `#94a3b8` | 2.56:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1077` | `#f8fafc` | 1.05:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1090` | `#ffffff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1091` | `#f1f5f9` | 1.10:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1094` | `#bae6fd` | 1.33:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:1095` | `#38bdf8` | 2.14:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:489` | `#2876bb` | 4.77:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:491` | `#15171a` | 17.96:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1080` | `#ffffff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1081` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1094` | `#f1f5f9` | 1.10:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1108` | `#eff6ff` | 1.09:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1110` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1118` | `#0f172a` | 17.85:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1126` | `#64748b` | 4.76:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1133` | `#f8fafc` | 1.05:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1134` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1136` | `#64748b` | 4.76:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1146` | `#f1f5f9` | 1.10:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1147` | `#0f172a` | 17.85:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1181` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1194` | `#ffffff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1195` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1208` | `#cbd5e1` | 1.48:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1213` | `#f0f6ff` | 1.09:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1214` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1215` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1220` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1222` | `#ffffff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1233` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1239` | `#64748b` | 4.76:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1252` | `#94a3b8` | 2.56:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1290` | `#22c55e` | 2.28:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1293` | `#94a3b8` | 2.56:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1296` | `#eab308` | 1.92:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1299` | `#3b82f6` | 3.68:1 ⚠️ Falla Texto | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1304` | `#f8fafc` | 1.05:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1305` | `#f1f5f9` | 1.10:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1313` | `#0f172a` | 17.85:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1320` | `#64748b` | 4.76:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1349` | `#eff6ff` | 1.09:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1351` | `#2563eb` | 5.17:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1363` | `#475569` | 7.58:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1371` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1389` | `#ffffff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1390` | `#e2e8f0` | 1.23:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1392` | `#475569` | 7.58:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1406` | `#64748b` | 4.76:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1411` | `#1e293b` | 14.63:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/globals.css:1419` | `#f1f5f9` | 1.10:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/icon.svg:3` | `#2d22b2` | 10.59:1 ✅ Pasa (Fondo Claro) | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/icon.svg:4` | `#f90` | 2.14:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/app/icon.svg:6` | `#fff` | 1.00:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |
| `apps/web/src/components/brand/QuivoLogoTransition.tsx:186` | `#FF9900` | 2.14:1 ❌ Falla Severo | 1.4.3 / 1.4.11 | Reemplazar por token CSS (ej. `var(--qv-color-...)`) |

### 4. Íconos Decorativos sin Ocultamiento ARIA (WCAG 1.1.1)

**Problema:** Íconos expuestos en el árbol de accesibilidad sin descripción, generando ruido en lectores de pantalla.

| Ubicación (`path:line`) | Elemento | Criterio WCAG | Fix Propuesto |
|---|---|---|---|
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:826` | `<svg width="44" height="24" viewBox="0 0 48 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:847` | `<svg width="44" height="24" viewBox="0 0 48 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:867` | `<svg width="48" height="24" viewBox="0 0 48 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:894` | `<svg width="48" height="24" viewBox="0 0 48 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:918` | `<svg width="52" height="24" viewBox="0 0 52 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:946` | `<svg width="44" height="24" viewBox="0 0 48 24" fi...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/(dashboard)/vehiculos/vehicle-form-panel.tsx:995` | `<svg width="260" height="140" viewBox="0 0 260 140...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |
| `apps/web/app/icon.svg:1` | `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0...` | 1.1.1 | Agregar `aria-hidden="true"` (decorativo) o `aria-label="..."` (interactivo) |

## 🟢 Hallazgos de Severidad Baja / Cumplimiento Positivo

### 5. Accesibilidad por Teclado y Foco (WCAG 2.1.1, 2.4.7)

✅ **Cumplimiento:** Operativos y gestionados correctamente mediante el design system y `globals.css`. No se detectaron trampas de foco en modales ni paneles deslizantes.

