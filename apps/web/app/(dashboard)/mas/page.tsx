'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, ROLE_LABEL, SegmentedControl } from '@quivo/design-system';
import { ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { getNavIcon } from '../../../src/lib/nav-icons';
import { itemsParaMas, NAV_ITEMS, rutaInicialParaRol } from '../../../src/lib/nav-items';
import { useEsMovil } from '../../../src/lib/use-es-movil';

/** Página solo del celular (reemplaza al drawer): en escritorio la sidebar ya lo cubre y `/mas` vuelve al aterrizaje del rol. */
export default function MasPage() {
  const { user, logout, isDevBypass, switchDevBypassRole } = useAuth();
  const esMovil = useEsMovil();
  const router = useRouter();

  // Solo se redirige si la página se abrió en escritorio: girar el celular (>720 px) no debe sacar al usuario.
  const abiertaEnMovil = useRef(esMovil);
  const rol = user?.rol ?? '';

  useEffect(() => {
    if (!esMovil && !abiertaEnMovil.current) router.replace(rutaInicialParaRol(NAV_ITEMS, rol));
  }, [esMovil, router, rol]);

  if (!esMovil && !abiertaEnMovil.current) return null;

  const items = itemsParaMas(rol);
  const email = user?.email ?? 'Sesión activa';

  return (
    <>
      <PageHeader title="Más" />
      <div className="qv-mas-user">
        <div className="qv-mas-user__av" aria-hidden="true">{(user?.email?.[0] ?? 'U').toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <p className="qv-mas-user__name">{email}</p>
          <p className="qv-mas-user__meta">{ROLE_LABEL[rol] ?? rol}</p>
        </div>
      </div>

      {items.length > 0 && (
        <ul className="qv-mas-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} prefetch={false} className="qv-mas-list__link">
                <span className="qv-mas-list__ico" aria-hidden="true">{getNavIcon(item.iconName, 18, 2)}</span>
                {item.label}
                <span className="qv-mas-list__go">
                  {/* /rutas en celular es solo lectura (la edición de trazado es de escritorio). */}
                  {item.id === 'rutas' && <span className="qv-mas-list__tag">Solo lectura</span>}
                  <ChevronRight size={18} aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isDevBypass && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Simular rol (demo)</p>
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
      )}

      <button
        type="button"
        className="qv-mas-logout"
        onClick={() => {
          logout();
          router.push('/login');
        }}
      >
        <LogOut size={18} aria-hidden="true" />
        Cerrar sesión
      </button>
    </>
  );
}
