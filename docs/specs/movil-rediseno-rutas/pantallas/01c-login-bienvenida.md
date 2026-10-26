# Pantalla 1c — Bienvenida en varios idiomas y nuevo acomodo del login

Va **después** de `01-login.md` (placa recordada + teclado) y de `01b-fondo-login.md` (fondo animado).
Lee el README de reglas comunes. Esta spec corrige el estado B ("Conecta tu vehículo") y el acomodo general.

## Problemas de hoy
- Todo el contenido está pegado arriba y queda media pantalla vacía.
- El input de placa y el botón Continuar no son de la misma familia: tienen distinta altura y peso, y el input
  se ve como una píldora blanca suelta.
- El logo está solo en el pie, lejos de todo.

## Nuevo acomodo (estados A y B)
De arriba hacia abajo, dentro del área segura:
1. **Logo** (`logo-white.png`, el mismo asset aprobado), centrado arriba, de unos 96×38 dp. Es la marca,
   no el protagonista.
2. **Zona protagonista**, que ocupa el espacio flexible del medio, centrada vertical y horizontalmente:
   - Estado B: el saludo en varios idiomas (ver abajo).
   - Estado A: `Ingresa tu PIN`, la pastilla de la placa con `Cambiar` y los puntos del PIN.
3. **Zona de acción**, abajo, al alcance del pulgar:
   - Estado B: subtítulo `Conecta tu vehículo` y la burbuja con la placa y Continuar.
   - Estado A: el teclado numérico.
4. Pie: `¿No tienes tu PIN? Solicítalo a tu sindicato.`, en texto pequeño.

Con el teclado del sistema abierto (estado B), el saludo se achica o se oculta (anímalo) para que la placa y
Continuar queden siempre visibles. Usa `KeyboardAvoidingView` como hoy.

## Saludo en varios idiomas (estado B)
Como la pantalla "hola" de Apple: una sola palabra grande que cambia de idioma con un fundido suave.
- Texto en `Heading` (Oxanium 700), blanco, de unos 44 dp, centrado y en una sola línea
  (`adjustsFontSizeToFit` con `numberOfLines={1}`).
- Cada palabra dura unos 2,5 s. La transición es un fundido cruzado con un leve desplazamiento hacia arriba
  y escala de 0,96 a 1, de unos 600 ms, con `useNativeDriver`. Usa dos `Animated.Text` que se alternan,
  sin desmontar en cada cambio.
- Debajo, en texto pequeño blanco al 70 %, el nombre del idioma (`Quechua`, `Aymara`…) para que se entienda.
- Orden: arranca y vuelve siempre a **Bienvenido**. Primero van los idiomas oficiales de Bolivia y después
  otros:
  1. Bienvenido — Español
  2. Allin hamusqayki — Quechua
  3. Aski jutawi — Aymara
  4. Tereguahẽ porãite — Guaraní
  5. Welcome — English
  6. Bem-vindo — Português
  7. Bienvenue — Français
  8. Willkommen — Deutsch
  9. Benvenuto — Italiano
- Solo idiomas con alfabeto latino, porque Oxanium no trae glifos chinos, japoneses ni árabes y con otra
  fuente se rompería el estilo.
- La lista vive en un arreglo exportado de un archivo puro, `src/features/auth/saludos.ts`, para corregir
  traducciones sin tocar el componente. Agrega un comentario: **las traducciones de quechua, aymara y guaraní
  las debe validar un hablante antes de producción.**
- Accesibilidad: el saludo es decorativo. Lleva `accessibilityLabel="Bienvenido"` fijo, no es región viva
  y no se anuncia en cada cambio.
- Con **reducir movimiento** activado: queda fijo en `Bienvenido`, sin rotar.
- La animación se pausa con el teclado abierto y al desmontar.

## Placa y Continuar: una sola burbuja
Usa el lenguaje de Rutas: un grupo es una burbuja con radios concéntricos.
- Una `Burbuja` en columna (`src/shared/components/burbuja`) que contiene el input de placa y el botón
  Continuar, con `quivoBubble.padding` y `quivoBubble.gap` entre ellos.
- El input y el botón tienen **la misma altura (52 dp), el mismo ancho y el mismo radio interior**
  (`quivoBubble.innerRadius`), concéntrico con la burbuja.
- El input va sobre `surfaceSoft`, con borde `borderSubtle` y la placa en Oxanium semibold de 20 dp con un
  leve espaciado entre letras, porque la placa es un código. El botón es el primario de siempre.
- Sin etiqueta "Placa del vehículo" encima: el subtítulo `Conecta tu vehículo` y el placeholder
  `Placa · 1234ABC` ya lo dicen. Conserva `accessibilityLabel="Placa del vehículo"`.
- En el estado A, la pastilla de la placa usa el mismo radio y la misma tipografía de placa, para que se
  reconozca como el mismo dato.

## Archivos
- `src/features/auth/vehicle-login-screen.tsx` (y sus componentes en `src/features/auth/components/`).
- Nuevos: `src/features/auth/saludos.ts` y `src/features/auth/components/saludo-idiomas.tsx`.
- No toques `fondo-login.tsx` (es de codex-trabajo1) ni nada fuera de `src/features/auth/`.

## Criterio de aceptación
- En 360×640 dp y en 412×915 dp el contenido se reparte en toda la altura, sin franjas vacías grandes.
- Con el teclado abierto, la placa y Continuar se ven completas.
- El input y el botón se ven como un mismo grupo: misma altura, mismo radio y dentro de la misma burbuja.
- El saludo rota con suavidad, sin saltos de layout, y queda fijo si está activado reducir movimiento.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/pantalla-01c-bienvenida.md`.
