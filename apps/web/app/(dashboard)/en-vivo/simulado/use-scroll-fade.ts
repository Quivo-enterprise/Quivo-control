'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Ítem 10 del guion de fixes (2026-09-27): a 390px las pestañas de la ficha (`trufi-panel.tsx`)
 * y la franja KPI (`franja-kpi.tsx`) scrollean horizontal (`overflow-x: auto`, ya existía) pero
 * quedan CORTADAS sin ninguna pista visual de que hay más contenido a la derecha. Este hook
 * mide `scrollWidth`/`clientWidth`/`scrollLeft` del contenedor (en cada resize/scroll, vía
 * `ResizeObserver` + listener de `scroll`) y devuelve si falta contenido a la derecha —
 * `en-vivo-simulado`/`trufi-panel`/`franja-kpi` usan eso para aplicar (o no) la clase del fade
 * (`.qv-scroll-fade-right`, `simulado.css`) SOLO cuando de verdad desborda, no siempre.
 */
export function useScrollFadeRight<T extends HTMLElement>(): { ref: RefObject<T>; desbordaDerecha: boolean } {
  // `useRef<T>(null)` (no `T | null` en el genérico) — matchea el overload de React que
  // devuelve `RefObject<T>` a secas, el mismo tipo que espera la prop `ref` de un elemento del
  // DOM (`RefObject<T | null>` explícito NO es asignable ahí, aunque `current` sea `T | null`
  // en los dos casos — invarianza del genérico, no de los miembros).
  const ref = useRef<T>(null);
  const [desbordaDerecha, setDesbordaDerecha] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    function medir() {
      if (!el) return;
      // Margen chico (4px) para no parpadear por redondeo de subpíxel cuando el scroll ya
      // llegó "casi" al final.
      const restante = el.scrollWidth - el.clientWidth - el.scrollLeft;
      setDesbordaDerecha(restante > 4);
    }

    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', medir);
      ro.disconnect();
    };
  }, []);

  return { ref, desbordaDerecha };
}
