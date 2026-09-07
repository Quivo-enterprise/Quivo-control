'use client';

import { useEffect, useState } from 'react';
import type { SelectOption } from '@quivo/design-system';
import type { Linea } from '@quivo/shared';
import { useAuth } from '../auth/auth-context';
import { lineasApi } from './lineas';

export interface LineaOptionsResult {
  options: SelectOption[];
  lineas: Linea[];
  nombrePorId: Record<string, string>;
  lineaPorId: Record<string, Linea>;
}

export function useLineaOptions(): LineaOptionsResult {
  const { token, isDevBypass } = useAuth();
  const [result, setResult] = useState<LineaOptionsResult>({
    options: [],
    lineas: [],
    nombrePorId: {},
    lineaPorId: {},
  });

  useEffect(() => {
    if (isDevBypass || !token) {
      return;
    }
    let cancelled = false;
    lineasApi
      .listar(token)
      .then((lineas) => {
        if (cancelled) return;
        setResult({
          options: lineas.map((l) => ({
            label: l.nombreCorto ? `${l.nombreCorto} - ${l.nombre}` : `Línea ${l.codigo} - ${l.nombre}`,
            value: l.id,
          })),
          lineas,
          nombrePorId: Object.fromEntries(lineas.map((l) => [l.id, l.nombreCorto || `Línea ${l.codigo}`])),
          lineaPorId: Object.fromEntries(lineas.map((l) => [l.id, l])),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, isDevBypass]);

  return result;
}
