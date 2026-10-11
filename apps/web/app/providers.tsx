'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '../src/lib/auth/auth-context';
import { ConsultasPorIdentidad } from '../src/lib/auth/consultas-por-identidad';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ConsultasPorIdentidad>{children}</ConsultasPorIdentidad>
    </AuthProvider>
  );
}
