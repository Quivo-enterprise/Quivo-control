'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AdminLayout, Button, DashboardHeader, SidebarNav } from '@quivo/design-system';
import { RequireAuth } from '../../src/components/require-auth';
import { useAuth } from '../../src/lib/auth/auth-context';
import { filterNavItemsByRole, NAV_ITEMS } from '../../src/lib/nav-items';

function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const items = filterNavItemsByRole(NAV_ITEMS, user?.rol ?? '').map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    active: pathname === item.href,
    onClick: (event: React.MouseEvent) => {
      event.preventDefault();
      router.push(item.href);
    },
  }));

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <AdminLayout
      sidebar={
        <SidebarNav
          role={user?.rol}
          items={items}
          footer={
            <Button variant="ghost" size="sm" fullWidth onClick={handleLogout}>
              Cerrar sesión
            </Button>
          }
        />
      }
      header={<DashboardHeader title="Panel administrativo" subtitle={user?.email} />}
    >
      {children}
    </AdminLayout>
  );
}

export default function DashboardRouteLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DashboardShell>{children}</DashboardShell>
    </RequireAuth>
  );
}
