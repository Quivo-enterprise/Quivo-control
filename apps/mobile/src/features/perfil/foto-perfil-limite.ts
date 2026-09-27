/**
 * Tope de tamaño para la foto de perfil demo, en un archivo PURO aparte (sin ningún import de
 * `react-native`/`expo-*`) para poder testearlo con `vitest` sin arrastrar `perfil-screen.tsx`
 * (que sí importa `react-native`, no parseable fuera de Metro/Hermes — ver `perfil-screen.tsx`
 * para el detalle completo del fix que motiva este archivo).
 *
 * `TOPE_DATA_URI_BYTES`: sin `expo-file-system` resoluble desde `apps/mobile` (no es dependencia
 * directa del paquete — ver el docblock en `perfil-screen.tsx`), la foto sigue viajando como data
 * URI base64 en memoria/AsyncStorage. `quality: 0.3` en el picker ya baja el peso típico, pero
 * una cámara de muy alta resolución puede igual devolver algo pesado — este tope rechaza ANTES de
 * persistir en vez de arriesgar romper la lectura de AsyncStorage/CursorWindow en Android.
 */
export const TOPE_DATA_URI_BYTES = 400_000;

export function dataUriDemasiadoGrande(dataUri: string): boolean {
  return dataUri.length > TOPE_DATA_URI_BYTES;
}
