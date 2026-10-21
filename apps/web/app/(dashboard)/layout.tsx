'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AdminLayout,
  SegmentedControl,
  SidebarNav,
  type SidebarNavSection,
} from '@quivo/design-system';
import {
  AlertTriangle,
  Building2,
  Bus,
  FileBarChart,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MapPin,
  ListOrdered,
  Radio,
  RotateCw,
  Scale,
  ShieldAlert,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { BrandLogo } from '../../src/components/brand-logo';
import { RequireAuth } from '../../src/components/require-auth';
import { useAuth } from '../../src/lib/auth/auth-context';
import { filterNavItemsByRole, groupNavItemsBySection, NAV_ITEMS } from '../../src/lib/nav-items';

function getNavIcon(iconName?: string) {
  const size = 18;
  const strokeWidth = 1.9;
  switch (iconName) {
    case 'LayoutDashboard':
      return <LayoutDashboard size={size} strokeWidth={strokeWidth} />;
    case 'ListOrdered':
      return <ListOrdered size={size} strokeWidth={strokeWidth} />;
    case 'Radio':
      return <Radio size={size} strokeWidth={strokeWidth} />;
    case 'Building2':
      return <Building2 size={size} strokeWidth={strokeWidth} />;
    case 'Users':
      return <Users size={size} strokeWidth={strokeWidth} />;
    case 'Bus':
      return <Bus size={size} strokeWidth={strokeWidth} />;
    case 'UserCheck':
      return <UserCheck size={size} strokeWidth={strokeWidth} />;
    case 'GitBranch':
      return <GitBranch size={size} strokeWidth={strokeWidth} />;
    case 'MapPin':
      return <MapPin size={size} strokeWidth={strokeWidth} />;
    case 'RotateCw':
      return <RotateCw size={size} strokeWidth={strokeWidth} />;
    case 'Scale':
      return <Scale size={size} strokeWidth={strokeWidth} />;
    case 'FileBarChart':
      return <FileBarChart size={size} strokeWidth={strokeWidth} />;
    case 'ShieldAlert':
      return <ShieldAlert size={size} strokeWidth={strokeWidth} />;
    case 'AlertTriangle':
      return <AlertTriangle size={size} strokeWidth={strokeWidth} />;
    case 'UserCog':
      return <UserCog size={size} strokeWidth={strokeWidth} />;
    default:
      return <Sparkles size={size} strokeWidth={strokeWidth} />;
  }
}

function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout, isDevBypass, switchDevBypassRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Si la ruta es '/en-vivo', se renderiza a pantalla completa sin la barra lateral
  if (pathname === '/en-vivo') {
    return <div className="qv-live-standalone-shell">{children}</div>;
  }

  const allowedItems = filterNavItemsByRole(NAV_ITEMS, user?.rol ?? '');
  const groupedSections = groupNavItemsBySection(allowedItems);

  const sections: SidebarNavSection[] = groupedSections.map((sec) => ({
    title: sec.title,
    items: sec.items.map((item) => {
      const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
      const isLiveItem = item.id === 'en-vivo';

      return {
        id: item.id,
        label: item.label,
        href: item.href,
        active: isActive,
        icon: getNavIcon(item.iconName),
        target: isLiveItem ? '_blank' : undefined,
        rel: isLiveItem ? 'noopener noreferrer' : undefined,
        badge: isLiveItem ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.1rem 0.45rem',
              fontSize: '0.625rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              borderRadius: '999px',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-success) 14%, transparent)',
              color: 'var(--qv-color-success)',
              border: '1px solid color-mix(in srgb, var(--qv-color-success) 30%, transparent)',
            }}
          >
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: 'var(--qv-color-success)',
                boxShadow: '0 0 6px var(--qv-color-success)',
              }}
            />
            Live
          </span>
        ) : undefined,
        onClick: (event: React.MouseEvent) => {
          if (isLiveItem) {
            return;
          }
          event.preventDefault();
          router.push(item.href);
        },
      };
    }),
  }));

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const userInitial = (user?.email?.[0] ?? 'U').toUpperCase();

  return (
    <AdminLayout
      sidebar={
        <SidebarNav
          brand={<BrandLogo variant="logotipo" height={26} />}
          sections={sections}
          footer={
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {/* Tarjeta de usuario activa */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.45rem 0.55rem',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 6%, var(--qv-surface-card))',
                  border: '1px solid color-mix(in srgb, var(--qv-border-subtle) 80%, transparent)',
                  borderRadius: 'var(--qv-radius-md)',
                }}
              >
                <div
                  style={{
                    width: '1.85rem',
                    height: '1.85rem',
                    borderRadius: '50%',
                    backgroundColor: 'var(--qv-color-primary)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    flexShrink: 0,
                    boxShadow: '0 2px 6px color-mix(in srgb, var(--qv-color-primary) 30%, transparent)',
                  }}
                >
                  {userInitial}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--qv-text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={user?.email}
                  >
                    {user?.email ?? 'Sesión activa'}
                  </span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--qv-text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {user?.rol === 'admin_quivo' ? 'Admin Central' : 'Admin Sindicato'}
                  </span>
                </div>
              </div>

              {isDevBypass ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <p
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      opacity: 0.65,
                      margin: 0,
                      paddingLeft: '0.2rem',
                    }}
                  >
                    Simular rol (demo)
                  </p>
                  <SegmentedControl
                    size="sm"
                    value={user?.rol ?? 'admin_quivo'}
                    onValueChange={switchDevBypassRole}
                    items={[
                      { value: 'admin_quivo', label: 'Admin QUIVO' },
                      { value: 'admin_sindicato', label: 'Sindicato' },
                    ]}
                  />
                </div>
              ) : null}

              <button
                type="button"
                className="qv-sidebar__logout"
                onClick={handleLogout}
              >
                <LogOut size={14} />
                <span>Cerrar sesión</span>
              </button>
            </div>
          }
        />
      }
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

