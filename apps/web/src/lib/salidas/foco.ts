/**
 * Foco programático dentro de un contenedor. `Input`/`Select`/`Button` del design system no
 * reenvían `ref` (React 18), así que se enfoca por selector desde un wrapper con ref.
 */
export function enfocar(contenedor: HTMLElement | null, selector = 'input, select, textarea, button'): void {
  contenedor?.querySelector<HTMLElement>(selector)?.focus();
}
