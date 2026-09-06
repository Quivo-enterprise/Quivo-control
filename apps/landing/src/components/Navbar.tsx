'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, ArrowUpRight, ChevronRight, Menu, Moon, Sun, X } from 'lucide-react';

interface NavbarProps {
  onOpenDemoModal: () => void;
}

const PAGE_NAV_ITEMS = [
  { label: 'Qué resuelve', href: '#solucion' },
  { label: 'Qué incluye', href: '#caracteristicas' },
  { label: 'Panel', href: '#panel' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'Preguntas', href: '#faq' },
] as const;

const PANEL_URL = process.env.NEXT_PUBLIC_PANEL_URL || 'http://localhost:3100/login';

type Theme = 'light' | 'dark';

export function Navbar({ onOpenDemoModal }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string>(PAGE_NAV_ITEMS[0]!.label);
  const headerRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [indicatorTarget, setIndicatorTarget] = useState<string>(PAGE_NAV_ITEMS[0]!.label);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});
  const navPillRef = useRef<HTMLDivElement>(null);
  const navLinkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  useEffect(() => {
    let storedTheme: string | null = null;
    try { storedTheme = window.localStorage.getItem('quivo-theme'); } catch { /* Use system preference when storage is unavailable. */ }
    const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
    const nextTheme: Theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : preferredTheme;

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
  }, []);

  const setThemeMode = (nextTheme: Theme) => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try { window.localStorage.setItem('quivo-theme', nextTheme); } catch { /* Theme still applies for this visit. */ }
  };

  const toggleTheme = () => setThemeMode(theme === 'dark' ? 'light' : 'dark');
  const closeMobileMenu = () => setMobileMenuOpen(false);

  const moveNavIndicator = useCallback((label: string) => {
    const pill = navPillRef.current;
    const targetLink = navLinkRefs.current[label];

    if (!pill || !targetLink) return;

    const pillRect = pill.getBoundingClientRect();
    const linkRect = targetLink.getBoundingClientRect();

    if (!pillRect.width || !linkRect.width) return;

    setIndicatorTarget(label);
    setIndicatorStyle({
      transform: `translate3d(${linkRect.left - pillRect.left}px, 0, 0)`,
      width: `${linkRect.width}px`,
      opacity: 1,
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      moveNavIndicator(activeLabel);
    });

    const handleResize = () => moveNavIndicator(activeLabel);
    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [moveNavIndicator, activeLabel]);

  useEffect(() => {
    const update = () => {
      const visible = [...PAGE_NAV_ITEMS]
        .filter((item) => (document.querySelector(item.href)?.getBoundingClientRect().top ?? Infinity) <= 150)
        .sort((a, b) => (document.querySelector(b.href)?.getBoundingClientRect().top ?? 0) - (document.querySelector(a.href)?.getBoundingClientRect().top ?? 0))[0];
      setActiveLabel(visible?.label ?? PAGE_NAV_ITEMS[0]!.label);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        headerRef.current?.querySelector<HTMLButtonElement>('.quivo-header__toggle')?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMobileMenuOpen(false);
    };
    const resize = () => { if (window.innerWidth > 1060) setMobileMenuOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', resize);
    };
  }, [mobileMenuOpen]);

  return (
    <header ref={headerRef} className={`quivo-header ${mobileMenuOpen ? 'is-menu-open' : ''}`}>
      <div className="quivo-header__inner">
        <div className="quivo-header__bar">
          <a href="/" className="quivo-header__brand" aria-label="QUIVO - Inicio">
            <span className="brand-logo-wrap">
              <Image
                src="/brand/control/logotipo-amarillo.webp"
                alt="QUIVO Control"
                width={69}
                height={32}
                className="brand-logo brand-logo--control logo--dark-mode"
                priority
                unoptimized
              />
              <Image
                src="/brand/control/logotipo-principal.png"
                alt=""
                width={69}
                height={32}
                className="brand-logo brand-logo--control logo--light-mode"
                aria-hidden="true"
                unoptimized
              />
            </span>
          </a>

          <span className="quivo-header__separator" aria-hidden="true" />

          <nav className="quivo-header__nav" aria-label="Navegación principal">
            <div
              className="quivo-nav-pill"
              ref={navPillRef}
              onMouseLeave={() => moveNavIndicator(activeLabel)}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) moveNavIndicator(activeLabel); }}
            >
              <div className="quivo-nav-indicator" style={indicatorStyle} aria-hidden="true" />
              {PAGE_NAV_ITEMS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  ref={(node) => {
                    navLinkRefs.current[item.label] = node;
                  }}
                  onMouseEnter={() => moveNavIndicator(item.label)}
                  onFocus={() => moveNavIndicator(item.label)}
                  onClick={() => setActiveLabel(item.label)}
                  aria-current={activeLabel === item.label ? 'location' : undefined}
                  className={`quivo-header__link ${activeLabel === item.label ? 'active' : ''} ${indicatorTarget === item.label ? 'is-indicator-target' : ''}`}
                >
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          </nav>

          <span className="quivo-header__separator" aria-hidden="true" />

          <div className="quivo-header__tools">
            <a
              href={PANEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="quivo-tool-btn quivo-login-btn"
            >
              <span>Entrar al panel</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>

            <button
              className="quivo-tool-btn theme-toggle-btn"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            >
              <Sun className="theme-icon theme-icon--sun" size={18} aria-hidden="true" />
              <Moon className="theme-icon theme-icon--moon" size={18} aria-hidden="true" />
              <span className="sr-only">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            </button>

            <button
              type="button"
              className="quivo-header__cta"
              onClick={onOpenDemoModal}
            >
              <span>Quiero una demo</span>
              <ArrowRight className="cta-arrow" size={15} aria-hidden="true" />
            </button>
          </div>

          <button
            className="quivo-header__toggle"
            type="button"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
            aria-expanded={mobileMenuOpen}
            aria-controls="quivo-control-mobile-dropdown"
            aria-label={mobileMenuOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
          >
            {mobileMenuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          </button>
        </div>

        <div className="quivo-header__dropdown-wrapper" hidden={!mobileMenuOpen}>
          <div className="quivo-header__dropdown" id="quivo-control-mobile-dropdown">
            <nav className="quivo-header__dropdown-nav" aria-label="Navegación móvil">
              {PAGE_NAV_ITEMS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="quivo-header__dropdown-link"
                  onClick={closeMobileMenu}
                >
                  <span>{item.label}</span>
                  <ChevronRight className="dropdown-chevron" size={17} aria-hidden="true" />
                </a>
              ))}
            </nav>

            <div className="mobile-tools-bar">
              <button
                className="mobile-theme-btn"
                type="button"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
              >
                {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                <span>{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
              </button>
            </div>

            <div className="mobile-menu-actions">
              <a
                href={PANEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="quivo-header__dropdown-login"
              >
                Entrar al panel
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="quivo-header__dropdown-cta"
                onClick={() => {
                  closeMobileMenu();
                  onOpenDemoModal();
                }}
              >
                Quiero una demo
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
