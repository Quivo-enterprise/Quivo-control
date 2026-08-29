'use client';

import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../utils.js';
import { Alert, Button } from './primitives.js';
import { Input } from './form.js';

/* ---------------------------------------------------------------------------------------
 * AdminLayout — shell del panel: sidebar fija + header + contenido.
 * ------------------------------------------------------------------------------------- */

export interface AdminLayoutProps {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function AdminLayout({ sidebar, header, children }: AdminLayoutProps) {
  return (
    <div className="qv-admin-layout">
      <aside className="qv-admin-layout__sidebar">{sidebar}</aside>
      <div className="qv-admin-layout__main">
        <div className="qv-admin-layout__header">{header}</div>
        <main className="qv-admin-layout__content">{children}</main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * SidebarNav
 * ------------------------------------------------------------------------------------- */

const ROLE_LABEL: Record<string, string> = {
  admin_quivo: 'Administrador QUIVO',
  admin_sindicato: 'Administrador de sindicato',
  operador: 'Operador',
  supervisor: 'Supervisor',
  socio: 'Socio',
  conductor: 'Conductor',
};

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  active?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface SidebarNavProps {
  brand: ReactNode;
  role?: string;
  items: SidebarNavItem[];
  footer?: ReactNode;
}

export function SidebarNav({ brand, role, items, footer }: SidebarNavProps) {
  return (
    <nav className="qv-sidebar" aria-label="Navegación principal">
      <div className="qv-sidebar__brand">{brand}</div>
      {role && <span className="qv-sidebar__role">{ROLE_LABEL[role] ?? role}</span>}
      <ul className="qv-sidebar__nav">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              className={cx('qv-sidebar__link', item.active && 'qv-sidebar__link--active')}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.onClick}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      {footer && <div className="qv-sidebar__footer">{footer}</div>}
    </nav>
  );
}

/* ---------------------------------------------------------------------------------------
 * DashboardHeader / PageHeader
 * ------------------------------------------------------------------------------------- */

export interface DashboardHeaderProps {
  title: string;
  subtitle?: string;
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
  return (
    <header className="qv-dashboard-header">
      <h1 className="qv-dashboard-header__title">{title}</h1>
      {subtitle && <span className="qv-dashboard-header__subtitle">{subtitle}</span>}
    </header>
  );
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="qv-page-header">
      <div className="qv-page-header__copy">
        <h1 className="qv-page-header__title">{title}</h1>
        {subtitle && <p className="qv-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="qv-page-header__actions">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * AuthLayout
 * ------------------------------------------------------------------------------------- */

export interface AuthLayoutProps {
  logo: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthLayout({ logo, title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="qv-auth-layout">
      <div className="qv-auth-layout__brand" aria-hidden="true">
        <div className="qv-auth-layout__brand-inner">
          <div className="qv-auth-layout__logo">{logo}</div>
          <p className="qv-auth-layout__tagline">
            Control operativo en tiempo real para sindicatos de transporte.
          </p>
        </div>
      </div>
      <div className="qv-auth-layout__panel">
        <div className="qv-auth-layout__card">
          <div className="qv-auth-layout__card-header">
            <div className="qv-auth-layout__card-logo">{logo}</div>
            <h1 className="qv-auth-layout__title">{title}</h1>
            {subtitle && <p className="qv-auth-layout__subtitle">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * LoginForm
 * ------------------------------------------------------------------------------------- */

export interface LoginFormProps {
  onSubmit: (email: string, password: string) => void;
  loading?: boolean;
  error?: string;
  onForgotPasswordClick?: () => void;
}

export function LoginForm({ onSubmit, loading, error, onForgotPasswordClick }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(email, password);
  }

  return (
    <form className="qv-login-form" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert variant="danger" title="No se pudo iniciar sesión">
          {error}
        </Alert>
      )}
      <Input
        label="Correo electrónico"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        fullWidth
        required
      />
      <Input
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        fullWidth
        required
      />
      {onForgotPasswordClick && (
        <button type="button" className="qv-login-form__forgot" onClick={onForgotPasswordClick}>
          ¿Olvidaste tu contraseña?
        </button>
      )}
      <Button type="submit" fullWidth disabled={loading}>
        {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------------------------------
 * SegmentedControl
 * ------------------------------------------------------------------------------------- */

export interface SegmentedControlItem {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  size?: 'sm' | 'md';
  value: string;
  onValueChange: (value: string) => void;
  items: SegmentedControlItem[];
}

export function SegmentedControl({ size = 'md', value, onValueChange, items }: SegmentedControlProps) {
  return (
    <div className={cx('qv-segmented', `qv-segmented--${size}`)} role="radiogroup">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          className={cx('qv-segmented__item', item.value === value && 'qv-segmented__item--active')}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * Tabs — solo la lista de disparadores (`role="tablist"`/`role="tab"`); el panel lo decide
 * cada página (ver `/reglas`, que alterna `<ReglasTab />`/`<SancionesTab />` por fuera).
 * ------------------------------------------------------------------------------------- */

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onValueChange, className }: TabsProps) {
  return (
    <div className={cx('qv-tabs', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className={cx('qv-tabs__tab', item.value === value && 'qv-tabs__tab--active')}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
