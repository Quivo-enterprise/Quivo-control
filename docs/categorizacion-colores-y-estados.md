# Ecosistema QUIVO — Guía Maestra de Categorización de Colores y Estados

> **Documento Oficial de Estandarización Visual**  
> **Ámbito:** Todos los sistemas y plataformas QUIVO (Panel Web de Control `apps/web`, App Móvil Conductores `apps/movil`, App de Pasajeros `apps/pasajero`, APIs y Notificaciones).  
> **Objetivo:** Mantener coherencia semántica, accesibilidad de alto contraste (WCAG AA/AAA) y ergonomía operativa para el transporte urbano en Bolivia.

---

## 1. Principios de Diseño Cromático

1. **Significado Semántico Consistente:** Un mismo color siempre representa el mismo estado operativo o nivel de criticidad en cualquier pantalla o dispositivo.
2. **Alto Contraste y Legibilidad:** Todos los componentes de estado deben ser legibles tanto en modo oscuro como bajo luz solar directa en terminales móviles.
3. **Doble Codificación (Color + Icono/Texto):** Ningún estado o advertencia debe comunicarse exclusivamente mediante color; siempre debe acompañarse de un icono vectorial o etiqueta textual para accesibilidad total.
4. **Identidad Boliviana Auténtica:** Los colores de líneas y flotas respetan la tradición cromática del transporte público de Bolivia (carteles, combinaciones primarias/secundarias y banderas de ruta).

---

## 2. Categorización Semántica de Estados Operativos

### 🟢 2.1. Activo / Operativo / Conforme (Success — Verde Esmeralda)

Representa estados saludables, habilitados, sincronizados o completados satisfactoriamente.

| Token CSS | Color Base (Hex) | Fondo Translúcido (Glass) | Borde Sugerido |
| :--- | :--- | :--- | :--- |
| `var(--qv-color-success)` | `#10B981` (Emerald 500) | `rgba(16, 185, 129, 0.12)` | `rgba(16, 185, 129, 0.35)` |

**Aplicación en Módulos:**
- **Vehículos:** Vehículo en operación activa (`activo`).
- **Socios / Conductores / Sindicatos:** Habilitado para operar (`activo`).
- **Líneas:** Ruta publicada y visible para usuarios finales (`publicado`).
- **Sanciones:** Sanción pagada / regularizada / cumplida (`pagada`).
- **GPS / Tracking:** Unidad en línea con señal confiable (< 15s de antigüedad).
- **Sync Móvil:** Paquete de telemetría recibido y procesado sin errores (`200 OK`).

---

### 🟡 2.2. Precaución / En Revisión / Transición (Warning — Ámbar / Dorado)

Representa estados que requieren atención del operador, procesos en curso o desvíos leves.

| Token CSS | Color Base (Hex) | Fondo Translúcido (Glass) | Borde Sugerido |
| :--- | :--- | :--- | :--- |
| `var(--qv-color-warning)` | `#F59E0B` (Amber 500) | `rgba(245, 158, 11, 0.14)` | `rgba(245, 158, 11, 0.40)` |

**Aplicación en Módulos:**
- **Vehículos:** Unidad con suspensión temporal o inspección técnica pendiente (`suspendido`).
- **Líneas:** Línea validada técnica y geométricamente, lista para publicación (`validado`).
- **Sanciones:** Sanción en proceso de apelación ante el tribunal sindical (`apelada`).
- **GPS / Tracking:** Señal GPS con degradación o retraso de transmisión (15s a 60s sin reporte).
- **Rutas y Trazas:** Desvío moderado de la ruta planificada (50m a 150m fuera de la traza).

---

### 🔴 2.3. Peligro / Inactivo / Rechazado / Anulado (Danger — Carmesí / Rose)

Representa bloqueos operativos, infracciones, fallas críticas o registros deshabilitados.

| Token CSS | Color Base (Hex) | Fondo Translúcido (Glass) | Borde Sugerido |
| :--- | :--- | :--- | :--- |
| `var(--qv-color-danger)` | `#F43F5E` (Rose 500) | `rgba(244, 63, 94, 0.14)` | `rgba(244, 63, 94, 0.40)` |

**Aplicación en Módulos:**
- **Vehículos:** Vehículo dado de baja o inhabilitado (`inactivo`).
- **Conductores / Socios:** Conductor deshabilitado o suspendido (`inactivo`).
- **Sanciones:** Sanción formalmente aplicada (`aplicada`) o anulada por falta de mérito (`anulada`).
- **Sync / Ingesta:** Paquete de sincronización rechazado (`400 / 422 / 500`).
- **GPS / Tracking:** Pérdida total de conexión (> 180s sin datos) o exceso crítico de velocidad.

---

### 🔵 2.4. En Espera / Taller / Mantenimiento / Técnico (Info / Idle — Índigo / Cian)

Representa estados neutros, preventivos o de preparación técnica.

| Token CSS | Color Base (Hex) | Fondo Translúcido (Glass) | Borde Sugerido |
| :--- | :--- | :--- | :--- |
| `var(--qv-color-primary)` | `#6366F1` (Indigo 500) | `rgba(99, 102, 241, 0.12)` | `rgba(99, 102, 241, 0.35)` |
| `var(--qv-color-accent)` | `#06B6D4` (Cyan 500) | `rgba(6, 182, 212, 0.12)` | `rgba(6, 182, 212, 0.35)` |

**Aplicación en Módulos:**
- **Vehículos:** Unidad en taller mecánico o mantenimiento programado (`mantenimiento`) o pendiente de documentación inicial (`pendiente`).
- **Líneas:** Línea en etapa de diseño preliminar (`borrador`).
- **Sanciones:** Sanción registrada pendiente de notificación (`pendiente`).
- **Auditoría:** Registro de creación o actualización estándar.

---

## 3. Matriz de Severidad de Reglas y Sanciones

| Nivel de Gravedad | Tono Visual | Token / Color | Icono Recomendado | Ejemplo de Infracción |
| :--- | :--- | :--- | :--- | :--- |
| **Leve** | Cian / Azul Suave | `#06B6D4` | `AlertCircle` | Falta menor de uniforme, aseo de cabina. |
| **Grave** | Ámbar / Naranja | `#F59E0B` | `AlertTriangle` | Desvío no justificado, adelanto de horario > 5 min. |
| **Gravísima** | Carmesí / Rojo Intenso | `#EF4444` | `ShieldAlert` | Conducción peligrosa, cobro indebido de pasaje. |

---

## 4. Paleta Normalizada de Colores de Transporte Boliviano

Definida en `@quivo/shared` (`COLORES_VEHICULO`), normaliza los colores de carrocería, letreros y banderas de sindicatos:

| Código | Nombre Oficial | Color Muestra (Hex) | Color de Texto | Borde de Contraste Requerido |
| :--- | :--- | :--- | :--- | :--- |
| `blanco` | Blanco | `#F7F7F8` | `#17171A` (Oscuro) | Sí (`#CBD5E1`) |
| `negro` | Negro | `#17171A` | `#FFFFFF` (Claro) | No |
| `gris` | Gris | `#7A7A82` | `#FFFFFF` (Claro) | No |
| `rojo` | Rojo | `#DC2626` | `#FFFFFF` (Claro) | No |
| `azul` | Azul | `#2563EB` | `#FFFFFF` (Claro) | No |
| `verde` | Verde | `#16A34A` | `#FFFFFF` (Claro) | No |
| `amarillo` | Amarillo | `#EAB308` | `#17171A` (Oscuro) | Sí (`#CA8A04`) |
| `celeste` | Celeste | `#0284C7` | `#FFFFFF` (Claro) | No |
| `naranja` | Naranja | `#EA580C` | `#FFFFFF` (Claro) | No |
| `morado` | Morado / Violeta | `#7C3AED` | `#FFFFFF` (Claro) | No |
| `cafe` | Café / Marrón | `#78350F` | `#FFFFFF` (Claro) | No |
| `rosado` | Rosado | `#DB2777` | `#FFFFFF` (Claro) | No |
| `verde_olivo`| Verde Olivo | `#365314` | `#FFFFFF` (Claro) | No |
| `beige` | Beige / Crema | `#D6D3D1` | `#17171A` (Oscuro) | Sí (`#A8A29E`) |

### 4.1. Regla de Contraste para Líneas Bicolor
- Cuando una línea de transporte combina 2 colores (ejemplo: *Rojo con franja Amarilla* o *Azul con borde Blanco*):
  - **Color Primario:** Fondo principal del badge de la línea (`row.color`).
  - **Color Secundario:** Borde exterior perimetral de 2px a 3px (`row.colorSecundario`).
  - **Color de Texto:** Calculado automáticamente según la luminancia del fondo primario (`row.colorTexto`).

---

## 5. Implementación en Código

### 5.1. Componente `StatusBadge` (`@quivo/design-system`)

```tsx
import { StatusBadge } from '@quivo/design-system';

// Activo
<StatusBadge status="active" label="Activo" />

// Inactivo
<StatusBadge status="inactive" label="Inactivo" />

// Advertencia / Suspensión
<StatusBadge status="warning" label="Suspendido" />

// En Espera / Taller
<StatusBadge status="idle" label="Mantenimiento" />
```

### 5.2. Mapeo Tipado de Estados de Vehículo

```ts
import type { StatusBadgeStatus } from '@quivo/design-system';
import type { Vehiculo } from '@quivo/shared';

export const ESTADO_BADGE_VEHICULO: Record<Vehiculo['estado'], StatusBadgeStatus> = {
  activo: 'active',
  inactivo: 'inactive',
  suspendido: 'warning',
  mantenimiento: 'idle',
  pendiente: 'idle',
};
```

### 5.3. Mapeo Tipado de Estados de Sanciones

```ts
import type { StatusBadgeStatus } from '@quivo/design-system';
import type { EstadoSancion } from '@quivo/shared';

export const ESTADO_BADGE_SANCION: Record<EstadoSancion, StatusBadgeStatus> = {
  pendiente: 'idle',
  aplicada: 'danger',
  apelada: 'warning',
  pagada: 'active',
  anulada: 'inactive',
};
```

### 5.4. Cápsula de Herramientas de Tabla (`.qv-table-actions-capsule`)

```tsx
<div className="qv-table-actions-capsule">
  <button type="button" className="qv-action-pill-btn" onClick={() => onEdit(row)}>
    <Pencil size={13} />
    <span>Editar</span>
  </button>
  <span className="qv-action-pill-divider" />
  <button type="button" className="qv-action-pill-btn qv-action-pill-btn--danger" onClick={() => onDelete(row)}>
    <Trash2 size={13} />
    <span>Eliminar</span>
  </button>
</div>
```

---

## 6. Lista de Verificación para Nuevas Pantallas

- [ ] ¿Los estados positivos usan verde esmeralda (`--qv-color-success`)?
- [ ] ¿Los estados de alerta o apelación usan ámbar (`--qv-color-warning`)?
- [ ] ¿Los estados críticos, bloqueados o rechazados usan carmesí (`--qv-color-danger`)?
- [ ] ¿Los colores claros (blanco, amarillo, beige) tienen texto `#17171A` y borde visible?
- [ ] ¿Todos los badges y botones de estado incluyen texto explícito e icono vectorial?
- [ ] ¿Las acciones por fila están encapsuladas en `.qv-table-actions-capsule`?
