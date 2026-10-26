# codex-trabajo1 · Iteración 2 — Avisos, modales y paneles sobre el mapa

Lee `docs/specs/movil-rediseno-rutas/README.md`, `ux-propuestas-equipo.md` (esta iteración aplica **UX-4, UX-5 y
UX-6**), tu informe de la iteración 1 y las **correcciones del supervisor**
anotadas al final de este archivo (si las hay, van primero).
Ya existen las primitivas de `src/shared/components/burbuja/` y los componentes compartidos migrados por codex-trabajo2:
úsalos, no crees variantes nuevas.

## A) Correcciones de la iteración 1
Aplica primero todo lo que el supervisor anote abajo, en "Correcciones".

## B) Feedback de control y vuelta
- `control-feedback-toast.tsx`: burbuja superior (debajo de la cabecera, sin taparla), icono de estado + "Punto N
  registrado", radio concéntrico, entrada/salida con `duration.base` y `easing` del design system.
- `vuelta-completada-banner.tsx`: misma burbuja que el toast (principio 6), con su acción "Terminar" como `Button`.
- `vuelta-actual/aviso-designacion.tsx`: tarjeta en burbuja con título `Heading`, cuerpo `Text`, acción única
  "Entendido" en `primary`; variante cancelada con el mismo esqueleto. Mantén el apilado con el banner (props `top`).
- Contador de espera de Molinos (`ContadorEsperaMolinos`, dentro de `operacion/`): `PildoraBurbuja` sobre la hoja.

## C) Modales de la pantalla de operación (`operation-screen.tsx`)
- **Reportar — UX-5**: en el modal de observación, antes del campo, píldoras de motivo rápido (Bloqueo o trancadera ·
  Falla mecánica · Salud o emergencia · Almuerzo · Combustible) en una fila que envuelve, 44 px de alto. Tocar una
  completa el texto del campo; el conductor puede agregar detalle. Mismo envío de observación que hoy.
  Título del modal: "Reportar un problema".
- "Registro automático" y "Reportar un problema": reemplazar el `BlurView` + píldoras propias por el diálogo único
  que dejó codex-trabajo2 (`quivo-confirm-dialog.tsx`) si su API alcanza; si no, una tarjeta con la **misma**
  geometría (radio `quivoBubble.radius`, acciones `Button` de igual ancho) y anota el hueco.
  Botones en minúscula inicial con verbo ("Entendido", "Cancelar", "Enviar"), no en mayúsculas.
- El campo de observación usa el `Input` migrado (multilínea, radio interior).

## D) Paneles
- `fila-salida/fila-salida-card.tsx` — **UX-6**: tarjeta en burbuja dentro de la hoja; hora de salida destacada con
  `Heading`, "Sales detrás de PLACA" con los datos que ya trae `vista`; "quién sale después" solo si el dato ya existe
  (si no, anótalo como pendiente). Estado con `Badge`.
- `vecinos-ruta/vecinos-ruta-panel.tsx` y `vecinos-ruta-card.tsx` — **UX-4**: burbuja arriba, debajo de la cabecera.
  Cada fila: DELANTE / ATRÁS, **placa grande** y distancia con números tabulares. Estados con constantes con nombre:
  normal (> 500 m), atención (≤ 500 m, borde `warning`), cerca (≤ 300 m, borde `danger` + "Vehículo de adelante
  demasiado cerca" / "Vehículo de atrás demasiado cerca"), con icono además del color. **Sin voz.** No tapa la
  columna de FABs. No cambies cómo se obtienen los vecinos (`topBase` y el hook quedan igual).

## Criterio de aceptación
- Toast, banner, aviso de designación y modales comparten un mismo esqueleto visual.
- Ningún overlay se solapa con otro en 360 dp (cabecera, toast/banner/aviso apilados, FABs, hoja).
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/codex-trabajo1-iteracion-2.md`.

## Correcciones del supervisor (iteración 1)
_(el supervisor completa esta sección antes de lanzar la iteración 2)_
