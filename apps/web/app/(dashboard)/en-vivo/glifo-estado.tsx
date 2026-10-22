import { GLIFOS_ESTADO } from '@quivo/design-system';
import type { EstadoFrescura } from '@quivo/shared';

/** Forma + color del estado (las mismas formas que la insignia del marcador del mapa); el texto va siempre al lado. */
export function GlifoEstado({ estado }: { estado: EstadoFrescura }) {
  return (
    <svg
      className={`qv-live-glifo qv-live-est--${estado}`}
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      // Constante del design-system (sin datos del usuario).
      dangerouslySetInnerHTML={{ __html: GLIFOS_ESTADO[estado] }}
    />
  );
}
