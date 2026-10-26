# Pantalla 0 — Splash: misma aurora que el login, logo protagonista y menos espera

Lee el README de reglas comunes. Archivo: `apps/mobile/src/features/auth/splash-screen.tsx`.

## Problemas de hoy
- Fondo con un degradado distinto al del login: al pasar del splash al login cambia todo el color.
- El logo animado (`VectorLogo`) no se vio en el Motorola: solo aparecieron el spinner naranja y el texto.
- El spinner naranja grande y dos líneas de texto compiten con la marca.
- Espera mínima artificial de **2,5 s** en cada apertura, aunque todo esté listo antes.
- Los estados de error son texto suelto con un botón naranja de 220 dp.

## Lo que NO cambia
- La lógica: `NetInfo.fetch()`, la cota de 5 s, la diferencia entre `sin_conexion` y `tardanza` (y sus
  comentarios), `onLoadData` y `onReady`. Los textos de error dicen lo mismo, aunque pueden acortarse.
- `App.tsx`, `use-auth-movil.ts` y `fondo-login.tsx` no se tocan.

## Nuevo diseño
1. **Fondo**: `<FondoLogin variante="a" />` (de `components/fondo-login.tsx`). Es la misma aurora del login,
   así el paso del splash al login se siente continuo.
2. **Logo** centrado, como protagonista:
   - Averigua por qué `VectorLogo` no se ve en Android (¿tamaño 0, `viewBox`, color, opacidad inicial que
     nunca sube?) y arréglalo. Si no lo logras con un cambio chico, usa `assets/images/logo-white.png` con
     una entrada de fundido + escala de 0,92 a 1 (Animated, driver nativo) y explícalo en el informe.
   - Después de la entrada, un "respiro" muy suave (opacidad de 0,85 a 1, ciclo de unos 2 s) mientras
     dura la verificación. Sin rotaciones.
3. **Progreso**: en lugar del spinner, una **línea fina indeterminada** de 120×3 dp bajo el logo, con un
   segmento naranja (`accent`) que se desliza sobre blanco al 20 %, con radio completo y driver nativo.
4. **Texto**: una sola línea, `Preparando tu jornada`, en `Text` sm blanco al 80 %. Aparece con fundido
   **solo si la verificación pasa de 800 ms**, para que no parpadee en una apertura rápida.
5. **Espera mínima**: baja de 2500 ms a **900 ms**, lo justo para que la entrada del logo se vea completa.
   Es el único cambio de tiempos permitido.
6. **Errores** (`sin_conexion` y `tardanza`): una `Burbuja` en columna (la superficie blanca de
   `shared/components/burbuja`) centrada en la mitad inferior, con:
   - un icono en círculo de 44 dp (`cloud-offline-outline` para sin conexión, `time-outline` para tardanza);
   - el título en `Heading` md (`Sin conexión` / `Esto está tardando`);
   - el mensaje en `Text` sm `secondary`;
   - `Reintentar` como `Button` primario a ancho completo, 52 dp, radio `quivoBubble.innerRadius`.

   El logo sigue arriba, quieto. Al reintentar, la burbuja se va con un fundido y vuelve la línea de progreso.
7. Accesibilidad: el logo con `accessibilityLabel="QUIVO Control"`, la línea de progreso con
   `accessibilityRole="progressbar"` y la etiqueta `Preparando tu jornada`, y el error con `accessibilityRole="alert"`.
   Con **reducir movimiento** activado: sin respiro y sin deslizamiento (la línea queda fija al 40 %).

## Splash nativo (solo informa, no lo cambies)
`app.config.ts` usa `backgroundColor: '#ffffff'` en `expo-splash-screen`: al abrir la app se ve un flash
blanco antes del splash índigo. En el informe propón el color (el `INDIGO_NOCHE` de `fondo-login.tsx`) y
la imagen. Lo cambia el supervisor, porque requiere recompilar el nativo.

## Criterio de aceptación
- Del splash al login no cambia el fondo.
- Apertura con sesión y red: menos de 1,2 s de splash, con el logo visible y animado.
- Sin conexión: burbuja clara con Reintentar, que funciona.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/pantalla-00-splash.md`.
