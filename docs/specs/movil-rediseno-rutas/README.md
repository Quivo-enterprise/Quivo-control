# Rediseño de QUIVO Conductor con el lenguaje de QUIVO Rutas — reglas comunes

**Lectura obligatoria para codex-trabajo1 y codex-trabajo2 antes de tocar código.**
Supervisor: Claude (revisa diffs, saca capturas en el Motorola y hace los commits).

## Objetivo
Llevar toda la app del conductor (`apps/mobile`) al lenguaje visual que estrenó QUIVO Rutas
(`/home/jairomgr/Proyectos/QUIVO/Quivo-rutas`): **burbujas**, píldoras, radios concéntricos,
controles de 44 px y **QUIVO Design System** (`@quivo/design-system-native`).
Solo diseño UI/UX. **Nada de lógica.**

## Propuestas UX del equipo
`ux-propuestas-equipo.md` (en esta carpeta) define **qué** se muestra y **cuándo** en la pantalla del mapa.
Si una propuesta choca con una regla de este README, gana la propuesta en lo de UX y este README en lo visual.

## Referencias que tienes que leer (solo lectura)
- `Quivo-rutas/docs/ux-ui/README.md`, `02-componentes.md`, `03-layout-y-responsive.md`, `06-accesibilidad-y-usabilidad.md`
- `Quivo-UI-UX/docs/design-system/15-reglas-ux-ui.md` (reglas comunes de todos los productos QUIVO)
- `Quivo-UI-UX/packages/design-system-native/src/` (API real de los componentes nativos; **no inventes props**)
- Pantalla de referencia del patrón: `Quivo-rutas/apps/web/src/styles/map-layout.css` (sección celular, burbujas inferiores)
  y `Quivo-rutas/apps/mobile/src/` (cómo Rutas consume el design system nativo)

## QUIVO Design System (obligatorio)
- Importa desde `@quivo/design-system-native`: `Button`, `Text`, `Heading`, `Badge`, `Card`, `Input`, `Switch`,
  `Avatar`, `Divider`, `Loader` y los tokens `colors`, `space`, `radius`, `fontSize`, `fontWeight`, `duration`, `easing`, `elevation`.
- Tokens del design system: `apps/mobile/src/shared/theme/design-system.ts` (`dsColors` en tema claro, `dsSpace`,
  `dsRadius`, `dsFontSize`, `dsFontWeight`, `dsFontFamily`, `dsDuration`, `dsEasing`, `dsElevation`).
  Geometría de burbuja: `quivoBubble` en `apps/mobile/src/shared/theme/quivo-theme.ts`. `quivoColors` sigue ahí por
  compatibilidad: en lo que toques, pásate a `dsColors`. Si te falta un token, **no pongas un hex suelto**: anótalo.
- Las fuentes ya están registradas con el nombre corto que pide el design system (`Oxanium`, `Montserrat`).
- **Fuentes en Android (obligatorio):** nunca pongas `fontWeight` ni `fontFamily` sueltos en un estilo: en Android la
  fuente cae a Roboto. Usa `Text` con la prop `weight` (`regular` · `medium` · `semibold` · `bold`), `Heading`, o en
  un `StyleSheet` `...fontStyle('body' | 'display', '400' | '500' | '600' | '700')` de `@quivo/design-system-native`.
  Todo texto de la app sale de `Text`/`Heading` del design system o lleva `fontStyle`: el `Text` de `react-native`
  sin `fontStyle` también cae a Roboto.
- **No uses `textMuted` ni `variant="muted"`**: en tema claro es `#1a1a1a` (error del token). Para texto
  secundario usa `textSecondary`/`variant="secondary"`; para placeholders y ayudas, `textTertiary`.
- Código con el formato del repo (Prettier, `printWidth` 100) y conservando los comentarios que explican el
  porqué. Nada de componentes compactados en una sola línea.
- Si un componente del design system no cubre un caso (por ejemplo, no hay hoja inferior, diálogo ni botón de icono),
  crea la pieza local **sobre los tokens del design system** y anótala en tu informe como "hueco del design system".
  **No edites `Quivo-UI-UX` ni `packages/design-system-native`.**
- Iconos: se mantiene `@expo/vector-icons` (Ionicons) que ya usa la app. No agregues librerías.

## Geometría de burbuja (la que pide el responsable)
Equivale a `--qv-bubble-*` de `tokens.css`. En código: `quivoBubble` de `quivo-theme.ts`.

| Token | Valor | Uso |
|---|---|---|
| `quivoBubble.touch` | 44 | Alto mínimo de todo control táctil (botón, píldora, icono) |
| `quivoBubble.padding` | 8 | Relleno de la burbuja, **igual en los 4 lados** |
| `quivoBubble.gap` | 8 | Separación entre controles dentro de una burbuja |
| `quivoBubble.radius` | 30 | Radio de la burbuja (44/2 + 8) |
| `quivoBubble.innerRadius` | 22 | Radio de lo que va dentro (radio − relleno): **concéntrico** |
| `quivoBubble.edge` | 12 | Margen contra los bordes de la pantalla |

Reglas de geometría:
1. Relleno igual en los 4 lados; gaps iguales; iconos centrados ópticamente en su círculo de 44.
2. Radios concéntricos: radio interior = radio exterior − relleno. Nunca un cuadrado dentro de una píldora.
3. Las burbujas flotan sobre el mapa: superficie `surfaceRaised` (≈ 92 % de opacidad está permitida), borde con
   tinte de marca (primario al 14 % sobre `borderSubtle`) y `elevation` del design system. Sin glow ni gradientes.
4. Lo que va pegado abajo respeta `safe-area` (`useSafeAreaInsets`). Lo que va arriba, también.
5. Espaciado solo con la escala (4 · 8 · 12 · 16 · 24 · 32 · 48). **Nada de 6, 7, 10, 13 px.**
6. **Un solo `primary` visible por grupo de acciones**; secundarias en `outline`, discretas en `ghost`.

## Contexto del conductor (más estricto que Rutas)
- Se usa **manejando, al sol, en Android de gama baja** (el de pruebas es un Moto E13, 720 × 1600).
  Contraste alto, textos ≥ 14 px, la acción principal del recorrido (Iniciar / Pausar / Finalizar / Empezar día) ≥ 48 px.
- Nada tapa el trazado más de lo necesario; lo importante cabe en la primera pantalla.
- Tema claro únicamente (la app no tiene modo oscuro; no lo agregues).
- El **login ya fue aprobado** (fondo diagonal naranja/morado y logo blanco): no cambies el fondo ni el logo.

## El mapa no cambia
El mapa de Google que usa hoy la app (`react-native-maps`, `src/features/mapa/route-map.tsx`: estilo, trazado,
marcadores, cámara, brújula) **se queda igual**. Solo se rediseñan los componentes que van encima del mapa
y cómo se usan (cabecera, botones, avisos, hoja, modales).

## Prohibido
- Tocar `src/features/mapa/` (el mapa de Google y su estilo).
- Importar `@quivo/design-system-native` (o `src/shared/theme/design-system.ts`) desde un `.ts` de lógica que tenga
  tests: arrastra `react-native` y vitest no lo puede leer. Solo desde `.tsx` de presentación.
- Tocar hooks (`use-*.ts`), `gps/`, `db/`, `shared/api/`, `shared/security/`, `shared/observability/`, navegación,
  contratos de props entre componentes, textos de error que vienen del servidor, ni el comportamiento.
- Quitar o cambiar `accessibilityLabel`, `accessibilityRole`, `testID` o `hitSlop` (puedes **agregar**).
- Agregar dependencias, editar `package.json`, `pnpm-lock.yaml`, `metro.config.js`, `app.config.ts` o `android/`.
- `git add`, `git commit`, `git stash`, `git checkout` o cualquier escritura en git. El supervisor hace los commits.
- Levantar Metro, `adb` o el emulador: el supervisor prueba en el Motorola.
- Tocar archivos que no son de tu propiedad (tabla abajo). Si necesitas un cambio ahí, pídelo en tu informe.

## Propiedad de archivos (para que los dos trabajen a la vez sin pisarse)
| Área | Dueño |
|---|---|
| `src/shared/components/burbuja/` (nuevo: primitivas de burbuja) | **codex-trabajo1** |
| `src/features/operacion/*.tsx` (salvo `gps-provider.tsx`, `map-error-boundary.tsx`) | **codex-trabajo1** |
| `src/features/vuelta-actual/*.tsx`, `src/features/fila-salida/*.tsx`, `src/features/vecinos-ruta/*.tsx` | **codex-trabajo1** |
| `src/shared/components/*.tsx` (Button, Card, Input, diálogos, cabecera) | **codex-trabajo2** |
| `src/features/auth/**/*.tsx`, `src/features/perfil/*.tsx` (salvo `use-operacion-settings.tsx`), `src/features/vehiculo-foto/*.tsx` | **codex-trabajo2** |
| `src/shared/theme/*`, `src/features/mapa/*`, `App.tsx`, `packages/design-system-native` | supervisor (pídelo en el informe) |

La API pública de `src/shared/components/*` (nombres de props y su significado) **no cambia**: codex-trabajo1 la usa
mientras codex-trabajo2 la migra al design system.

## Verificación antes de entregar
Desde la raíz del repo:
```bash
pnpm --filter @quivo/mobile typecheck
pnpm --filter @quivo/mobile lint
pnpm --filter @quivo/mobile test
```
Los tres en verde. Si algo ya fallaba antes de tu cambio, dilo con la salida exacta.

## Entrega
Escribe `docs/specs/movil-rediseno-rutas/resultados/<codex>-iteracion-<n>.md` con:
1. Archivos tocados y qué cambió en cada uno (una línea).
2. Componentes del design system que usaste y dónde.
3. Huecos del design system o tokens que faltaron.
4. Lo que quedó fuera o dudas para el supervisor.
5. Salida resumida de typecheck, lint y test.

Textos en español claro y directo; botones que empiezan con verbo, sin signos de exclamación.
