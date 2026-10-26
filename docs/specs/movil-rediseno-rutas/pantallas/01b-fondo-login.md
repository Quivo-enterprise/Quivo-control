# Pantalla 1b — Fondo animado del login (aurora QUIVO)

Lee primero `docs/specs/movil-rediseno-rutas/README.md`. Esta spec reemplaza el degradado diagonal del login
(naranja–índigo por partes iguales). Al mezclarse, esos dos colores casi opuestos dan franjas color café
(`#8B5962`, `#A3654F`) y el resultado no se siente QUIVO.

## Idea
Una **aurora**: base índigo profunda y dos o tres manchas grandes y difusas que se desplazan y "respiran"
muy despacio. El índigo de la marca es el protagonista y el naranja es solo un brillo de acento.

## Reglas de color
- Base: degradado vertical de índigo noche a `primary` (`#3226b4`). El tono noche lo eliges tú, pero
  derívalo del índigo de la marca (por ejemplo, `#14113F` o `#1E1B4B`, que ya existe como
  `COLOR_ESPERA`). No uses negro ni gris.
- Manchas: índigo claro (`primaryStrong`, `#4f22d6`) y naranja de la marca (`accent`, `#fd9e15`). La
  naranja es la más chica y la más transparente.
- **Nunca** un degradado lineal que pase de naranja a índigo: el naranja solo existe como mancha radial que
  se desvanece a transparente. Así no vuelve a aparecer el café.
- Los valores de color vienen de `dsColors` donde existan. Los que no existan se declaran como constantes
  con nombre, comentadas, al inicio del archivo.

## Movimiento
- Cada mancha se traslada unos pocos dp y escala entre 0,9 y 1,1, en un bucle de **15 a 20 s**, con
  ciclos distintos para que no se vea sincronizado. Usa `Animated.loop` y `Easing.inOut(Easing.sin)`.
- Todo con `useNativeDriver: true`: solo `transform` y `opacity`, nunca `cx`/`cy` del SVG en cada cuadro.
  Por eso cada mancha es una `Animated.View` que contiene su propio `Svg` con un `RadialGradient`.
- Si el sistema tiene activado **reducir movimiento** (`AccessibilityInfo.isReduceMotionEnabled` y su
  evento `reduceMotionChanged`), el fondo queda quieto en su posición base.
- Las animaciones se detienen al desmontar.

## Variantes para elegir en el teléfono
Exporta `FondoLogin({ variante = 'a' }: { variante?: 'a' | 'b' | 'c' })`:
- `a`: sobria. Dos manchas (índigo claro arriba a la izquierda, naranja chica abajo a la derecha) y movimiento lento.
- `b`: más cálida. La mancha naranja es más grande y más visible.
- `c`: más viva. Tres manchas (agrega otra índigo) y un poco más de recorrido.

Deja en el informe cuál recomiendas y por qué.

## Archivos
- Nuevo: `apps/mobile/src/features/auth/components/fondo-login.tsx`. Solo ese archivo. Ocupa
  `StyleSheet.absoluteFill` y tiene `pointerEvents="none"`.
- **No** toques `vehicle-login-screen.tsx`: otro agente lo está reescribiendo. El supervisor conecta el
  fondo cuando los dos terminen.
- Sin dependencias nuevas: `react-native-svg` y `Animated` ya están en el proyecto.

## Criterio de aceptación
- Ningún tono café ni gris en ninguna variante. Domina el índigo y el naranja se ve como un brillo.
- Fluido y sin trabajo en JS por cuadro. Quieto si está activado reducir movimiento.
- Los textos blancos del login (título, dígitos del teclado) se leen bien sobre cualquier punto del fondo.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/pantalla-01b-fondo.md`.
