'use client';

import React from 'react';
import Image from 'next/image';
import { PhotoCredit } from './PhotoCredit';
import {
  ArrowUpRight,
  Facebook,
  FileText,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Music2,
  ShieldCheck,
  Youtube,
} from 'lucide-react';

interface FooterProps {
  onOpenDemoModal: () => void;
}

const SOCIAL_LINKS = [
  {
    label: 'LinkedIn',
    handle: '@quivobo',
    href: 'https://www.linkedin.com/company/quivobo/',
    icon: Linkedin,
    tone: 'linkedin',
  },
  {
    label: 'Facebook',
    handle: '@quivo_bolivia',
    href: 'https://www.facebook.com/share/1Gy87pF4JA/',
    icon: Facebook,
    tone: 'facebook',
  },
  {
    label: 'Instagram',
    handle: '@quivo_bolivia',
    href: 'https://www.instagram.com/quivo_bolivia',
    icon: Instagram,
    tone: 'instagram',
  },
  {
    label: 'TikTok',
    handle: '@quivobolivia',
    href: 'https://www.tiktok.com/@quivobolivia',
    icon: Music2,
    tone: 'tiktok',
  },
  {
    label: 'YouTube',
    handle: '@quivobolivia',
    href: 'https://youtube.com/@quivobolivia',
    icon: Youtube,
    tone: 'youtube',
  },
] as const;

const PAGE_LINKS = [
  { label: 'Qué resuelve', href: '#solucion' },
  { label: 'Qué incluye', href: '#caracteristicas' },
  { label: 'Panel en vivo', href: '#panel' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'Preguntas frecuentes', href: '#faq' },
] as const;

const LOCATION = {
  label: 'Cochabamba, Bolivia',
  href: 'https://maps.app.goo.gl/pynFEL3h6Mm4P5sS7',
  embedUrl: 'https://www.google.com/maps/embed?origin=mfe&pb=!1m3!2m1!1s-17.366049%2C-66.159053!6i15',
} as const;

export function Footer({ onOpenDemoModal }: FooterProps) {
  return (
    <footer id="contacto" className="footer">

      <div className="container">
        <div className="footer-content">
          <div className="footer-brand">
            <a href="https://quivobo.com" className="footer-logo-container" aria-label="QUIVO - Web principal">
              <Image
                src="/brand/global/quivo-wordmark-dark.webp"
                alt="QUIVO"
                width={154}
                height={46}
                className="footer-logo logo-dark-only"
                unoptimized
              />
              <Image
                src="/brand/global/quivo-wordmark-light.webp"
                alt=""
                width={154}
                height={46}
                className="footer-logo logo-light-only"
                aria-hidden="true"
                unoptimized
              />
            </a>

            <p className="footer-tagline">Tecnología que entiende personas.</p>
            <a className="simple-text-link" href="https://quivobo.com">Quiero conocer QUIVO <ArrowUpRight size={16} aria-hidden="true" /></a>

            <div className="footer-social-column">
              <div className="section-title-wrap">
                <h4>Síguenos</h4>
              </div>

              <div className="qv-glass-capsule social-vertical-capsule-dock">
                {SOCIAL_LINKS.map((social, index) => {
                  const Icon = social.icon;

                  return (
                    <React.Fragment key={social.label}>
                      {index > 0 && <div className="social-row-divider" aria-hidden="true" />}
                      <a
                        href={social.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="social-capsule-row"
                        aria-label={`${social.label} ${social.handle}`}
                      >
                        <span className={`social-icon-btn social-${social.tone}`}>
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <span className="social-row-meta">
                          <span className="social-row-name">{social.label}</span>
                          <strong className="social-row-handle">{social.handle}</strong>
                        </span>
                        <ArrowUpRight className="social-row-arrow" size={15} aria-hidden="true" />
                      </a>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="footer-links-grid">
            <div className="footer-section-capsule">
              <div className="section-title-wrap">
                <h4>Contacto</h4>
              </div>

              <div className="qv-glass-capsule footer-contact-capsule-dock">
                <a className="footer-contact-card footer-contact-card--mail" href="mailto:negocios@myquivo.com">
                  <span className="contact-card-avatar-wrap">
                    <span className="contact-card-avatar">
                      <Mail size={18} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="contact-card-text">
                    <span className="contact-card-type">Correo electrónico</span>
                    <strong className="contact-card-val">negocios@myquivo.com</strong>
                  </span>
                  <ArrowUpRight className="contact-card-arrow" size={15} aria-hidden="true" />
                </a>

                <div className="contact-dock-divider" aria-hidden="true" />

                <a
                  className="footer-contact-card footer-contact-card--wa"
                  href="https://wa.me/59168482323"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="contact-card-avatar-wrap">
                    <span className="contact-card-avatar">
                      <MessageCircle size={18} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="contact-card-text">
                    <span className="contact-card-type">WhatsApp</span>
                    <strong className="contact-card-val">+591 68482323</strong>
                  </span>
                  <ArrowUpRight className="contact-card-arrow" size={15} aria-hidden="true" />
                </a>

                <div className="contact-dock-divider" aria-hidden="true" />

                <div className="footer-mini-map-card">
                  <div className="mini-map-header">
                    <span className="mini-map-icon-box">
                      <MapPin size={16} aria-hidden="true" />
                    </span>
                    <span className="mini-map-info">
                      <span className="mini-map-label">Sede central</span>
                      <strong className="mini-map-title">{LOCATION.label}</strong>
                    </span>
                  </div>

                  <div className="mini-map-canvas-wrap">
                    <iframe
                      className="mini-map-iframe"
                      src={LOCATION.embedUrl}
                      title="Ubicación de QUIVO en Google Maps"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    <a
                      href={LOCATION.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mini-map-click-overlay"
                      title="Abrir ubicación en Google Maps"
                      aria-label="Abrir mapa en pantalla completa"
                    ><span className="map-open-label"><MapPin size={16} aria-hidden="true" />Ver ubicación<ArrowUpRight size={14} aria-hidden="true" /></span></a>
                  </div>
                </div>
              </div>
            </div>

            <div className="footer-section-capsule">
              <div className="section-title-wrap">
                <h4>Legal</h4>
              </div>

              <div className="qv-glass-capsule footer-links-capsule-dock">
                <a className="capsule-nav-row" href="https://app.myquivo.com/politica-privacidad">
                  <span className="capsule-nav-icon">
                    <ShieldCheck size={16} aria-hidden="true" />
                  </span>
                  <span className="capsule-nav-label">Política de privacidad</span>
                  <ArrowUpRight className="capsule-nav-arrow" size={15} aria-hidden="true" />
                </a>

                <div className="contact-dock-divider" aria-hidden="true" />

                <a className="capsule-nav-row" href="https://app.myquivo.com/terminos">
                  <span className="capsule-nav-icon">
                    <FileText size={16} aria-hidden="true" />
                  </span>
                  <span className="capsule-nav-label">Términos y condiciones</span>
                  <ArrowUpRight className="capsule-nav-arrow" size={15} aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="footer-section-capsule">
              <div className="section-title-wrap">
                <h4>Explorar</h4>
              </div>

              <div className="qv-glass-capsule footer-links-capsule-dock">
                {PAGE_LINKS.map((link, index) => (
                  <React.Fragment key={link.label}>
                    {index > 0 && <div className="contact-dock-divider" aria-hidden="true" />}
                    <a className="capsule-nav-row" href={link.href}>
                      <span className="capsule-nav-bullet" aria-hidden="true" />
                      <span className="capsule-nav-label">{link.label}</span>
                      <ArrowUpRight className="capsule-nav-arrow" size={15} aria-hidden="true" />
                    </a>
                  </React.Fragment>
                ))}

                <div className="contact-dock-divider" aria-hidden="true" />

                <button
                  className="capsule-nav-row capsule-nav-row--highlight"
                  type="button"
                  onClick={onOpenDemoModal}
                >
                  <span className="capsule-nav-bullet" aria-hidden="true" />
                  <span className="capsule-nav-label">Contacto</span>
                  <ArrowUpRight className="capsule-nav-arrow" size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p className="copyright-text">© {new Date().getFullYear()} QUIVO. Todos los derechos reservados.</p>
          <PhotoCredit />
        </div>
      </div>
    </footer>
  );
}
