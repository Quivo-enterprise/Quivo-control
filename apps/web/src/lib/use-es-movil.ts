import { useEffect, useState } from 'react';
import { MOBILE_QUERY } from '@quivo/design-system';

/** `true` a <= 720 px. Las páginas del dashboard renderizan tras RequireAuth (cliente): leer matchMedia al inicio no desajusta SSR. */
export function useEsMovil(): boolean {
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMovil(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return movil;
}
