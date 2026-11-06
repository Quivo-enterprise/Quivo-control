'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface ItemMenuAcciones {
  clave: string;
  etiqueta: string;
  icono?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** `menuitemradio`/`menuitemcheckbox` exponen `aria-checked` con `marcado`. */
  rol?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  marcado?: boolean;
}

interface MenuAccionesProps {
  /** Contenido del botón disparador (ícono y/o texto). */
  children: ReactNode;
  /** `aria-label` del botón; también nombra el menú. */
  etiqueta: string;
  /** Clase del botón disparador. */
  className: string;
  items: ItemMenuAcciones[];
  /** `data-*` para que el llamador localice el disparador (devolver el foco al cerrar una hoja). */
  dataDisparador?: string;
  disabled?: boolean;
}

/** Menú de acciones del móvil: botón con `aria-haspopup`, foco al primer ítem, flechas, Inicio/Fin, Escape/Tab/clic afuera cierran. */
export function MenuAcciones({ children, etiqueta, className, items, dataDisparador, disabled }: MenuAccionesProps) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const habilitados = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];

  // Al abrir, el foco va al primer ítem habilitado (o al marcado, para un selector).
  useEffect(() => {
    if (!abierto) return;
    const lista = habilitados();
    (lista.find((el) => el.getAttribute('aria-checked') === 'true' && el.getAttribute('role') === 'menuitemradio') ?? lista[0])?.focus();
  }, [abierto]);

  // Clic/toque fuera cierra (sin robar el foco a lo que se tocó).
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const lista = habilitados();
    const actual = lista.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      lista[(actual + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % lista.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      lista[e.key === 'Home' ? 0 : lista.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    } else if (e.key === 'Tab') {
      // El foco pasa al disparador y el Tab del navegador sigue desde ahí; el menú no queda abierto ni huérfano.
      setAbierto(false);
      boton.current?.focus();
    }
  };

  const elegir = (item: ItemMenuAcciones) => {
    setAbierto(false);
    boton.current?.focus();
    item.onSelect(); // después del foco: una hoja que se abre puede moverlo a donde le toque
  };

  return (
    <div className="qv-menu-ac" ref={raiz}>
      <button
        ref={boton}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? menuId : undefined}
        aria-label={etiqueta}
        disabled={disabled}
        {...(dataDisparador ? { [`data-${dataDisparador}`]: '' } : {})}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !abierto) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        {children}
      </button>
      {abierto && (
        <div ref={menu} id={menuId} role="menu" aria-label={etiqueta} className="qv-menu-ac__menu" onKeyDown={teclas}>
          {items.map((item) => (
            <button
              key={item.clave}
              type="button"
              role={item.rol ?? 'menuitem'}
              aria-checked={item.rol && item.rol !== 'menuitem' ? Boolean(item.marcado) : undefined}
              tabIndex={-1}
              className="qv-menu-ac__item"
              disabled={item.disabled}
              onClick={() => elegir(item)}
            >
              {item.icono}
              <span className="qv-menu-ac__texto">{item.etiqueta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
