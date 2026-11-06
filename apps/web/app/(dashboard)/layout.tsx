'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AdminLayout,
  MOBILE_QUERY,
  ROLE_LABEL,
  SegmentedControl,
  SidebarNav,
  type MobileTab,
  type SidebarNavSection,
} from '@quivo/design-system';
import { Ellipsis, LogOut } from 'lucide-react';
import { BrandLogo } from '../../src/components/brand-logo';
import { RequireAuth } from '../../src/components/require-auth';
import { getNavIcon } from '../../src/lib/nav-icons';
import { useAuth } from '../../src/lib/auth/auth-context';
import { filterNavItemsByRole, groupNavItemsBySection, isNavActive, isRouteAllowedForRole, masActivo, MOBILE_TAB_ITEMS, NAV_ITEMS } from '../../src/lib/nav-items';
import { textoAlertasAbiertas } from '../../src/lib/en-vivo/alertas';
import { useInfraccionesHoy } from '../../src/lib/en-vivo/use-en-vivo';
import { useEsMovil } from '../../src/lib/use-es-movil';

function DashboardShell({ children }: { children: ReactNode }) {
  const { user, token, logout, isDevBypass, switchDevBypassRole } = useAuth();
  const esMovil = useEsMovil();
  // Mismo query key que Hoy y Alertas (caché compartida); sin token no consulta: ni en escritorio ni sin permiso a /alertas.
  const puedeAlertas = isRouteAllowedForRole(NAV_ITEMS, '/alertas', user?.rol ?? '');
  const alertasHoy = useInfraccionesHoy(esMovil && puedeAlertas ? token : null, 30_000); // misma cadencia que En vivo: la query key es compartida y gana el observer más rápido
  const abiertas = alertasHoy.data?.filter((i) => i.estado === 'abierta').length ?? 0;
  const pathname = usePathname();
  const router = useRouter();
  const isLive = pathname === '/en-vivo';

  const allowedItems = filterNavItemsByRole(NAV_ITEMS, user?.rol ?? '');
  const groupedSections = groupNavItemsBySection(allowedItems);

  const sections: SidebarNavSection[] = groupedSections.map((sec) => ({
    title: sec.title,
    items: sec.items.map((item) => {
      const isActive = isNavActive(pathname, item.href);
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
            // En PWA standalone o móvil `_blank` saca de la app: navegar en la misma ventana.
            if (window.matchMedia(`(display-mode: standalone), ${MOBILE_QUERY}`).matches) {
              event.preventDefault();
              router.push(item.href);
            }
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

  // Solo clic izquierdo simple: Ctrl/Cmd/Shift/Alt y clic medio conservan el comportamiento del navegador.
  const irA = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href);
  };

  const mobileTabs: MobileTab[] = [...filterNavItemsByRole(MOBILE_TAB_ITEMS, user?.rol ?? '').map((item) => ({
    id: item.id,
    label: item.label,
    href: item.href,
    icon: getNavIcon(item.iconName, 24, 2),
    active: isNavActive(pathname, item.href),
    ...(item.id === 'alertas' && { badge: abiertas, badgeLabel: textoAlertasAbiertas(abiertas) }),
    onClick: irA(item.href),
  })), {
    id: 'mas',
    label: 'Más',
    href: '/mas',
    icon: <Ellipsis size={24} strokeWidth={2} />,
    active: masActivo(pathname, user?.rol ?? ''),
    onClick: irA('/mas'),
  }];

  const activeItem = sections.flatMap((s) => s.items).find((i) => i.active);

  const userInitial = (user?.email?.[0] ?? 'U').toUpperCase();

  return (
    <AdminLayout
      // '/en-vivo' va a pantalla completa sin sidebar en escritorio: `bare` deja solo la tabbar en móvil.
      bare={isLive}
      mobileTabs={mobileTabs}
      // En móvil la home se llama "Hoy" (pestaña y encabezado); en escritorio sigue "Dashboard".
      mobileTitle={pathname === '/' ? 'Hoy' : (activeItem?.label ?? 'Quivo')}
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
                    {ROLE_LABEL[user?.rol ?? ''] ?? user?.rol}
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
      {isLive ? <main className="qv-live-standalone-shell">{children}</main> : children}
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

