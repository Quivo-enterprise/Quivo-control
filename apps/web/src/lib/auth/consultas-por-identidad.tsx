'use client';

import { useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './auth-context';
import { claveIdentidad } from './identidad';

/**
 * `QueryClient` con alcance de identidad. Va DENTRO de `AuthProvider`. Cuando la identidad
 * cambia, el `key` remonta todo el subárbol autenticado y el cliente nuevo nace vacío en el
 * mismo render del cambio: ningún observer de la cuenta A sobrevive al primer render de B ni
 * hay una ventana (como con un efecto + `clear()`) en la que B vea datos de A. Cubre logout,
 * sesión caducada, reemplazo desde otra pestaña (`storage`) y cambio de rol de demo.
 * El refresh de token no cambia la clave, así que no remonta.
 */
export function ConsultasPorIdentidad({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const clave = claveIdentidad(user);
  const client = useMemo(() => new QueryClient(), [clave]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider key={clave} client={client}>
      {children}
    </QueryClientProvider>
  );
}
