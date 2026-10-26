# Pendientes de la entrada: pantalla de carga y turno vencido

Lee `README.md` y `pantallas/reglas-burbujas.md`.

## A. Pantalla de carga "Preparando tu contexto operativo…" (`apps/mobile/App.tsx`, `LoadingScreen`)
Aparece entre "Elige tu turno" (o el PIN) y el mapa, y también cuando fallan las fuentes. Hoy es la
pantalla vieja: rompe la continuidad aurora → mapa.
- Muévela a un componente propio, `src/features/auth/components/pantalla-carga.tsx`, con props
  `{ label, error }`, y úsala desde `App.tsx` en lugar de la función local. Las condiciones de cuándo se
  muestra **no cambian**.
- **Diseño**: el mismo lenguaje que el splash (`splash-screen.tsx`):
  - fondo `<FondoLogin variante="a" />`;
  - logo blanco centrado (`logo-white.png`);
  - debajo, la línea de progreso indeterminada de 120×3 dp, igual a la del splash (si puedes, extráela a
    un componente compartido en `components/` y úsala en los dos);
  - el texto en Text sm blanco al 80 %.
- **Texto**: `Preparando tu ruta…` en vez de "Preparando tu contexto operativo…", que es lenguaje técnico.
- **Error** (`error`): sin línea de progreso; icono `alert-circle` y el texto en una burbuja blanca, como
  los errores del splash.
- Con reducir movimiento, la línea queda fija (igual que el splash).
- **Ojo con las fuentes**: el caso `error` de `App.tsx` se muestra cuando **fallaron las fuentes**. Ahí no
  uses `Heading` ni fuentes de marca: usa `Text` de react-native con la fuente del sistema.

## B. Turno vencido al elegir (`apps/mobile/src/features/auth/use-auth-movil.ts`, solo `seleccionarAsignacion`)
Si "Elige tu turno" queda abierta unos minutos, el `seleccionToken` vence y el servidor responde 401.
Hoy el chofer ve "Las credenciales no son válidas." y cree que puso mal el PIN.
- En `seleccionarAsignacion`, envuelve la llamada a `authMovilApi.seleccionarAsignacionSesion` en un
  try/catch. Si el error es un `ApiError` con `status === 401` y **no** trae `codigo === CODIGO_SESION_NO_VIGENTE`,
  relánzalo como `new Error('Pasó mucho tiempo desde que ingresaste tu PIN. Vuelve a ingresarlo para elegir tu turno.')`.
  Cualquier otro error se relanza igual que hoy.
  - Antes, revisa cómo `ejecutar` convierte el error en `estado.error`, para que el texto llegue tal cual.
- No cambies nada más del hook: ni contadores de 401, ni circuito de refresh, ni etapas.
- **Test**: agrega `use-auth-movil.seleccion-vencida.test.ts`, siguiendo el estilo de los
  `use-auth-movil.*.test.ts` existentes, con 401 sin código → el mensaje nuevo, y 401 con
  `SESION_NO_VIGENTE` → el mensaje de siempre.
- **En la pantalla** (`assignment-selection-screen.tsx`): cuando `error` sea ese mensaje, la burbuja de
  error lleva además la acción `Ingresar PIN` (`ghost`, 44 de alto), que llama a `onBack`. Compara contra
  una constante exportada desde `use-auth-movil.ts` (`MENSAJE_SELECCION_VENCIDA`), no contra el string copiado.

## Criterio de aceptación
- Elegir turno → carga → mapa, sin saltos de fondo.
- Turno vencido: un mensaje claro y un toque para volver al PIN.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-06-pendientes.md`.
