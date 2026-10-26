# Pantalla 01c · Bienvenida y acomodo del login

## Cambios

- `apps/mobile/src/features/auth/vehicle-login-screen.tsx`: usa `FondoLogin variante="a"` en modo oscuro, agrupa placa y Continuar en una `Burbuja` con altura de 52 dp y radio interior de 22 dp, lleva el logo blanco de Control arriba a la izquierda y lo centra y amplía a 128×52 dp en el espacio disponible cuando se abre el teclado; distribuye saludo/PIN al centro y acciones abajo. Las 12 teclas del PIN comparten una sola superficie redondeada; su diámetro se adapta al área segura medida (aprox. 76 dp en 360×640 y hasta 88 dp en pantallas altas), con 8 dp iguales alrededor. El radio exterior acompaña la curva circular de las teclas y cada fila queda centrada. Se conserva el fondo índigo y la lectura en blanco independientemente del ajuste de apariencia del teléfono.
- `apps/mobile/src/features/auth/components/saludo-idiomas.tsx`: rota dos capas permanentes con fundido, desplazamiento y escala; pausa con el teclado abierto y queda fijo en Bienvenido si el sistema solicita reducir movimiento.
- `apps/mobile/src/features/auth/saludos.ts`: contiene los nueve saludos en el orden solicitado y la nota de validación para quechua, aymara y guaraní.

## Design system y límites

- `Heading`, `Text`, `Button`, `Input` compartido, `fontStyle` y tokens `colors`, `space`, `radius`, `fontSize`, `duration`; `Burbuja` compartida para el grupo de placa.
- El saludo animado usa `Animated.Text` con `fontStyle('display', '700')`, ya que `Heading` no expone una API de animación nativa. Su tipografía equivale al Heading solicitado.
- No se modificó `fondo-login.tsx`. Se usa siempre la variante índigo actual; se descartó la variación amarilla a petición del responsable.

## Pendiente de validación visual

- Confirmar en el Motorola las alturas a 360×640 y 412×915 dp, sobre todo la posición centrada del logo con el teclado abierto, errores de placa y tamaño de letra ampliado. No se levantó Metro ni se usó `adb`.
- Las traducciones de quechua, aymara y guaraní necesitan revisión por hablantes antes de producción.

## Verificación

- `npx tsc --noEmit -p .`: correcto.
- `npx eslint src`: correcto, 0 errores y 7 advertencias preexistentes en otros archivos.
- `npx vitest run`: 88 archivos y 1083 tests aprobados.
- `npx prettier --check` en los tres archivos de esta iteración: correcto.
