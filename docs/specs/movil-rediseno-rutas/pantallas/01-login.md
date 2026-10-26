# Pantalla 1 — Login: placa recordada + teclado de desbloqueo

Lee primero `docs/specs/movil-rediseno-rutas/README.md` (reglas comunes, fuentes, colores, Prettier).
Esta spec reemplaza el formulario de dos campos de `src/features/auth/vehicle-login-screen.tsx`.

## Idea
Como el inicio de sesión de una PC: el usuario (aquí, **la placa**) ya viene cargado y solo se escribe la
clave. La clave se escribe como al **desbloquear un celular**: puntos arriba y un teclado numérico propio
abajo, sin el teclado del sistema.

## Lo que NO cambia
- El fondo degradado y el logo blanco del pie (aprobados). Mismos colores, mismas `locations`.
- `use-auth-movil.ts`, `vehicle-login-schema.ts`, `@quivo/shared` y la API: no se tocan.
- El contrato del componente: `VehicleLoginScreen({ loading, error, onSubmit(placa, pin) })`.
- El PIN válido sigue siendo de **6 a 12 dígitos** (`PinMovilSchema`). Por eso **no hay envío automático**:
  se envía con la tecla ✓.

## Estados de la pantalla

### A. Placa recordada (el caso de todos los días)
- Arriba: título `Ingresa tu PIN` (Heading, Oxanium, blanco) y debajo una pastilla con la placa
  (`7777QVO`, icono de vehículo) y el enlace `Cambiar` (44 dp de alto mínimo) que lleva al estado B.
- Puntos del PIN: siempre se ven **6 puntos** vacíos. Si se escriben más de 6, aparecen más, hasta 12.
  Un punto lleno = dígito escrito. Usa blanco y blanco al 40 %, no colores sueltos.
- Teclado 3×4 de teclas circulares de **72 dp**: `1 2 3 / 4 5 6 / 7 8 9 / ⌫ 0 ✓`.
  - Los dígitos van en Oxanium grande y blanco. El fondo de la tecla es blanco al 16 % y sube a 28 % al presionar.
  - `⌫` borra un dígito; con pulsación larga borra todo.
  - `✓` envía. Se deshabilita (opacidad 0,4) con menos de 6 dígitos. Mientras `loading`, muestra un spinner
    y todas las teclas quedan deshabilitadas.
  - Vibración corta (`Vibration.vibrate(10)`) al tocar cada tecla.
- Debajo, en texto pequeño: `¿No tienes tu PIN? Solicítalo a tu sindicato.`

### B. Sin placa recordada (primera vez, o tocó "Cambiar")
- Título `Conecta tu vehículo` y el campo de placa (el `Input` compartido; mayúsculas; placeholder
  `1234ABC o 123ABC`), con el teclado del sistema.
- Un botón `Continuar` (Button primario, ancho completo) que valida la placa con `vehicleLoginSchema`
  (solo el campo placa) y pasa al estado A con esa placa. "Siguiente" del teclado hace lo mismo.
- Si había una placa recordada, se muestra `Volver a 7777QVO` para regresar sin escribir.

### Error del servidor (PIN rechazado, bloqueo, red)
- Los puntos se vacían, se ponen rojos (`danger`) y hacen un **temblor** horizontal de unos 300 ms
  (Animated, `useNativeDriver`). El teléfono vibra un poco más largo.
- El mensaje (`error`) aparece bajo los puntos, con `accessibilityRole="alert"`.
- Al escribir el primer dígito nuevo, los puntos vuelven a blanco y el mensaje se oculta.

## Placa recordada (persistencia)
- Módulo nuevo `src/features/auth/ultima-placa.ts` con AsyncStorage y la clave `quivo.mobile.ultima-placa.v1`:
  `leerUltimaPlaca(): Promise<string | null>`, `guardarUltimaPlaca(placa)`, `olvidarUltimaPlaca()`.
  Toda lectura y escritura va en try/catch; si falla, se comporta como si no hubiera placa.
- Se guarda **solo después de un login exitoso**: en `App.tsx`, un efecto que, cuando
  `auth.estado.etapa` pasa a `'asignacion'` u `'operacion'`, guarda la placa que se envió (la normalizada
  que recibe `onSubmit`). Esa placa la guarda en un ref el `onSubmit` envuelto de App.
- Cerrar sesión **no** la borra: igual que la PC, que recuerda al último usuario. Solo `Cambiar` la reemplaza
  tras el siguiente login exitoso.
- Mientras se lee la placa (primer render), no muestres el estado B un instante para luego saltar al A.
  Espera la lectura (es instantánea); mientras tanto, solo el fondo.

## Lógica pura (con tests de vitest)
`src/features/auth/teclado-pin.ts`, sin React:
- `agregarDigito(pin, d)`: no pasa de 12.
- `borrarDigito(pin)`.
- `puedeEnviar(pin)`: true con 6 a 12 dígitos.
- `cantidadPuntos(pin)`: `max(6, pin.length)`.

Escribe los tests en `teclado-pin.test.ts`. Para `ultima-placa.ts` no hacen falta tests.

## Accesibilidad
- Cada tecla: `accessibilityRole="button"`, con etiqueta `"1"`…`"0"`, `"Borrar"` o `"Ingresar"`, y
  `accessibilityState.disabled`.
- Los puntos forman un solo elemento accesible: `"PIN, 4 dígitos escritos"`, con `accessibilityLiveRegion="polite"`.
- El PIN nunca se lee en voz alta ni se muestra en claro (ya no hay botón de ojo).
- Respeta `allowFontScaling` como el resto de la app; el teclado debe caber en 360×640 dp sin scroll.

## Archivos
- Reescribir: `src/features/auth/vehicle-login-screen.tsx` (puedes partirlo en `components/teclado-pin.tsx`
  y `components/puntos-pin.tsx` dentro de `src/features/auth/`).
- Nuevos: `src/features/auth/teclado-pin.ts`, `teclado-pin.test.ts`, `ultima-placa.ts`.
- Tocar solo lo justo de `App.tsx` (envolver `onSubmit` y el efecto de guardar).

## Criterio de aceptación
- Con placa recordada, el login es: abrir la app → 6 toques → ✓. Ni teclado del sistema ni scroll.
- PIN equivocado: temblor, puntos rojos y mensaje; se reintenta sin borrar a mano.
- En 360 dp de ancho no se corta ningún texto; todas las teclas y enlaces ≥ 44 dp.
- Cero hex sueltos fuera del degradado aprobado; fuentes con `fontStyle` o los componentes del DS.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/pantalla-01-login.md`
  con qué hiciste, qué no, y dudas.
