'use client';

import { useEffect, useRef } from 'react';

/**
 * Ítem 8 del guion de fixes (2026-09-27): `VistaPanel` (`vistas/vista-panel.tsx`) y
 * `TrufiPanel` (`trufi-panel.tsx`) pueden estar los DOS abiertos a la vez (p. ej. E07 04:17:
 * Novedades → "Ver en mapa" abre la ficha del trufi ENCIMA de la vista Novedades ya abierta).
 * Antes cada uno escuchaba `Escape` en `document` por separado y sin coordinarse — un solo
 * golpe de tecla cerraba los DOS paneles de una.
 *
 * Regla: si el foco (`document.activeElement`) está DENTRO de un panel, ESE gana, sin mirar
 * nada más (es literalmente donde está parado el usuario). Si el foco quedó FUERA de los dos
 * (p. ej. el delegado clickeó el mapa), gana el panel abierto MÁS RECIENTE — se rastrea con una
 * pila de módulo (no React state — no hace falta re-render por esto), empujando al activarse y
 * sacando al desmontarse/desactivarse, así que "más reciente" se mantiene correcto incluso
 * después de que el panel de encima se cierre.
 */
let pilaAbiertos: symbol[] = [];

interface OpcionesCierreConEscape {
  /** `true` mientras el panel está montado/abierto. */
  activo: boolean;
  onCerrar: () => void;
}

export function useCierraConEscape(panelRef: React.RefObject<HTMLElement | null>, { activo, onCerrar }: OpcionesCierreConEscape) {
  const miIdRef = useRef<symbol | null>(null);
  if (miIdRef.current === null) {
    miIdRef.current = Symbol('panel');
  }

  // `onCerrar` vive en un ref para que el efecto del listener (abajo) no tenga que declararlo
  // como dependencia — mismo patrón que `vistas/vista-configuracion.tsx:43-57`. Los llamadores
  // (p. ej. `TrufiPanel`, con el mock tickeando cada ~1 s) pueden pasar una arrow function nueva
  // en cada render sin que esto fuerce destruir y reinstalar el listener de `document` cada vez.
  const onCerrarRef = useRef(onCerrar);
  useEffect(() => {
    onCerrarRef.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    if (!activo) return undefined;
    const id = miIdRef.current!;
    pilaAbiertos.push(id);
    return () => {
      pilaAbiertos = pilaAbiertos.filter((x) => x !== id);
    };
  }, [activo]);

  useEffect(() => {
    if (!activo) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const panel = panelRef.current;
      // Mismo guard que ya existía en ambos paneles: no robarle Escape a un `<Select>`/listbox
      // hijo abierto (su propio trigger llama `preventDefault()`; el listbox portado queda
      // fuera de `panelRef` en el DOM).
      if (panel?.querySelector('[aria-expanded="true"]')) return;
      if (document.querySelector('[role="listbox"]')) return;

      const activeElement = document.activeElement;
      const focoDentro = !!panel && !!activeElement && panel.contains(activeElement);
      const soyElMasReciente = pilaAbiertos[pilaAbiertos.length - 1] === miIdRef.current;
      if (focoDentro || soyElMasReciente) {
        onCerrarRef.current();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activo, panelRef]);
}
