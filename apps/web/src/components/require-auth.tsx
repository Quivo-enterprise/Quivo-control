'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader } from '@quivo/design-system';
import { useAuth } from '../lib/auth/auth-context';
import { isRouteAllowedForRole, NAV_ITEMS, rutaInicialParaRol } from '../lib/nav-items';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = !user || isRouteAllowedForRole(NAV_ITEMS, pathname, user.rol);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!allowed) {
      // Rol autenticado pero sin acceso a este módulo (ej. admin_sindicato en /sindicatos). Se va a
      // su ruta de inicio: para el `operador` no es `/` (no tiene dashboard) sino `/en-vivo`.
      const inicio = rutaInicialParaRol(NAV_ITEMS, user.rol);
      if (inicio !== pathname) router.replace(inicio);
    }
  }, [loading, user, allowed, router, pathname]);

  if (loading || !user || !allowed) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader />
      </div>
    );
  }

  return <>{children}</>;
}
