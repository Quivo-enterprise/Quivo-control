/**
 * Controlador del ciclo de vida del canal visual (`BackgroundGeolocation.watchPosition`),
 * extraído de `use-gps-operativo.ts` para poder testearlo sin montar el hook.
 *
 * CAUSA DEL CRASH DE CAMPO (`TypeError: undefined is not a function` en `evaluarCanalVisual`):
 * los tipos instalados (`@transistorsoft/background-geolocation-types@5.2.2/dist/core/api/
 * BackgroundGeolocation.d.ts:89`) declaran `watchPosition(...): Subscription` (síncrono), pero el
 * runtime real (`react-native-background-geolocation@5.4.0`, `src/NativeModule.js:289`) es
 * `static async watchPosition(...)` y devuelve `Promise<{id, remove}>`; además RECHAZA la promesa
 * ante un fallo nativo (no llama al callback `failure`). Guardar esa Promise como si fuera la
 * `Subscription` hacía que `.remove()` (al ir a segundo plano) fuera `undefined` → TypeError.
 *
 * Este controlador acepta ambas formas (sync o Promise) y es seguro ante carreras: si `detener`
 * corre mientras la promesa sigue pendiente, la suscripción se remueve apenas resuelve y no se
 * guarda (contador de generación).
 */

export type SuscripcionWatch = { remove: () => void };

export type DepsControladorCanalVisual = {
  /** Abre el `watchPosition`. Puede devolver la `Subscription` (tipos) o una Promise (runtime). */
  abrirWatch: () => SuscripcionWatch | Promise<SuscripcionWatch>;
  /** `paso`: `canal-visual-iniciar` | `canal-visual-detener`. */
  reportarError: (error: unknown, paso: string) => void;
};

export function crearControladorCanalVisual(deps: DepsControladorCanalVisual) {
  let activa: SuscripcionWatch | null = null;
  let pendiente = false;
  let generacion = 0;

  function removerSeguro(suscripcion: unknown): void {
    const remove = (suscripcion as { remove?: unknown } | null | undefined)?.remove;
    if (typeof remove !== 'function') return;
    try {
      (remove as () => void).call(suscripcion);
    } catch (error) {
      deps.reportarError(error, 'canal-visual-detener');
    }
  }

  return {
    /** `true` si hay un watch corriendo o abriéndose (no se debe abrir otro). */
    estaActivoOPendiente: () => activa !== null || pendiente,

    /** Abre el watch si no hay uno activo ni pendiente. Devuelve `true` si lo abrió. */
    iniciar(): boolean {
      if (activa !== null || pendiente) return false;
      pendiente = true;
      const miGeneracion = ++generacion;
      // `new Promise` captura también un throw síncrono de `abrirWatch`.
      new Promise<SuscripcionWatch>((resolver) => resolver(deps.abrirWatch()))
        .then((suscripcion) => {
          if (miGeneracion !== generacion) {
            // `detener` corrió mientras estaba pendiente: remover y no guardar.
            removerSeguro(suscripcion);
            return;
          }
          pendiente = false;
          activa = suscripcion;
        })
        .catch((error: unknown) => {
          if (miGeneracion === generacion) pendiente = false;
          deps.reportarError(error, 'canal-visual-iniciar');
        });
      return true;
    },

    /** Detiene el watch (activo o pendiente). Nunca lanza. `true` si había algo que detener. */
    detener(): boolean {
      const habia = activa !== null || pendiente;
      generacion += 1; // invalida cualquier apertura pendiente
      pendiente = false;
      const suscripcion = activa;
      activa = null;
      if (suscripcion) removerSeguro(suscripcion);
      return habia;
    },
  };
}
