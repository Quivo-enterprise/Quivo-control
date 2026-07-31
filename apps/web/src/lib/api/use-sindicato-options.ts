'use client';

import { useEffect, useState } from 'react';
import type { SelectOption } from '@quivo/design-system';
import { useAuth } from '../auth/auth-context';
import { sindicatosApi } from './sindicatos';

interface SindicatoOptionsResult {
  /** Para el `<Select>` de tenant en los formularios — solo `admin_quivo` puede elegir. */
  options: SelectOption[];
  /** Para resolver el nombre a mostrar en las columnas "Sindicato" de las tablas. */
  nombrePorId: Record<string, string>;
}

/**
 * `/v1/sindicatos` es `admin_quivo`-only (QUI-220) — `admin_sindicato`/`operador` nunca
 * pueden pegarle, así que para ellos esto siempre devuelve vacío (ven un solo tenant, el
 * propio, así que la columna "Sindicato" no aporta mucho de todas formas). Bajo el bypass
 * de dev tampoco hay token real, así que tampoco se llama a la API.
 */
export function useSindicatoOptions(): SindicatoOptionsResult {
  const { token, user, isDevBypass } = useAuth();
  const [result, setResult] = useState<SindicatoOptionsResult>({ options: [], nombrePorId: {} });

  useEffect(() => {
    if (isDevBypass || !token || user?.rol !== 'admin_quivo') {
      return;
    }
    let cancelled = false;
    sindicatosApi
      .listar(token)
      .then((sindicatos) => {
        if (cancelled) {
          return;
        }
        setResult({
          options: sindicatos.map((s) => ({ label: s.nombre, value: s.id })),
          nombrePorId: Object.fromEntries(sindicatos.map((s) => [s.id, s.nombre])),
        });
      })
      .catch(() => {
        // Sin fallback: si falla, el select queda vacío y el submit fallará con el error
        // real de la API — no hay nada útil que mostrar acá en particular.
      });
    return () => {
      cancelled = true;
    };
  }, [token, user?.rol, isDevBypass]);

  return result;
}
