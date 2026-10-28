'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SelectOption } from '@quivo/design-system';
import type { Linea } from '@quivo/shared';
import { useAuth } from '../auth/auth-context';
import { lineasApi } from './lineas';
import { useSindicatoOptions } from './use-sindicato-options';

export interface LineaOptionsResult {
  options: SelectOption[];
  lineas: Linea[];
  nombrePorId: Record<string, string>;
  lineaPorId: Record<string, Linea>;
}

/** Nombre de la línea sin duplicar el código ("Línea 16", no "Línea 16 - Línea 16"). */
function etiquetaLinea(l: Linea): string {
  return l.nombre.includes(l.codigo) ? l.nombre : `${l.codigo} - ${l.nombre}`;
}

export function useLineaOptions(): LineaOptionsResult {
  const { token, isDevBypass } = useAuth();
  // Solo `admin_quivo` recibe nombres (ver el hook); para el resto queda vacío y no se agrega nada.
  const { nombrePorId: sindicatoPorId } = useSindicatoOptions();
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
          options: [],
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

  // Con líneas de varios sindicatos (admin_quivo) el nombre solo es ambiguo: se agrega el sindicato.
  const options = useMemo<SelectOption[]>(() => {
    const variosSindicatos = new Set(result.lineas.map((l) => l.sindicatoId)).size > 1;
    return result.lineas.map((l) => {
      const sindicato = variosSindicatos ? sindicatoPorId[l.sindicatoId] : undefined;
      return { label: sindicato ? `${etiquetaLinea(l)} · ${sindicato}` : etiquetaLinea(l), value: l.id };
    });
  }, [result.lineas, sindicatoPorId]);

  return { ...result, options };
}
