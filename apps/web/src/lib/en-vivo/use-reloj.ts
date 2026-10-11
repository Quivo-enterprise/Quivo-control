import { useEffect, useState } from 'react';

/**
 * Devuelve `Date.now()` y se re-renderiza cada `intervaloMs`, para que las antigüedades
 * ("hace X") corran solas entre polls. Úsalo SIEMPRE en componentes hoja (`PanelFrescura`,
 * `PanelJornada`, …): un tick de 1 s en la página del mapa la re-renderizaría entera cada
 * segundo. Elegí el intervalo más grueso que la información justifique.
 */
export function useReloj(intervaloMs: number): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}
