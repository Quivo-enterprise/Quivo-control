'use client';

import {
  BanderitaBadge,
  Button,
  Modal,
  StatusBadge,
  type StatusBadgeStatus,
  parsearDistintivoBanderita,
} from '@quivo/design-system';
import type { Linea } from '@quivo/shared';
import { Flag, Globe, Info, Palette, RefreshCcw } from 'lucide-react';
import { estadoPublicoEtiqueta } from './linea-publication-action';

const ESTADO_BADGE_MAP: Record<Linea['publicStatus'], StatusBadgeStatus> = {
  publicado: 'active',
  validado: 'warning',
  borrador: 'idle',
  archivado: 'inactive',
};

export function LineaDetailsModal({
  linea,
  sindicatoNombre,
  onClose,
  onChangeState,
}: {
  linea: Linea | null;
  sindicatoNombre?: string;
  onClose: () => void;
  onChangeState?: (linea: Linea) => void;
}) {
  if (!linea) return null;

  const primary = linea.color || '#3226b4';
  const secondary = linea.colorSecundario || '#fd9e15';
  const tertiary = linea.colorTerciario || '#10b981';
  const background = linea.colorFondo || '#f8fafc';
  const code = linea.nombreCorto || linea.codigo || '120';
  const marker = linea.distintivoValor?.trim() || '';
  const hasMarker = marker.length > 0;
  const isBanderita = linea.distintivoTipo === 'banderita' || marker.toLowerCase().includes('bander');
  const parsedDistintivo = parsearDistintivoBanderita(marker);

  const roofSign = linea.cartelSuperior || 'TIQUIPAYA · UNIVALLE';
  const destinations = roofSign
    .split(/\s*(?:↔|→|⇄|·|\||—|–)\s*/)
    .map((d) => d.trim())
    .filter(Boolean);
  const bannerTop = linea.cartelTitulo || destinations[0] || roofSign;
  const bannerBottom =
    linea.cartelDetalle || destinations.slice(1).join(' · ') || linea.lema || 'RUTA URBANA';
  const bannerFormat = linea.cartelFormato || 'doble_clasico';
  const numberPosition = linea.cartelNumeroPosicion || 'izquierda';
  const logoPosition = linea.cartelLogoPosicion || 'ninguno';
  const numberColor = linea.cartelColorNumero || primary;
  const titleColor = linea.cartelColorTitulo || primary;
  const detailColor = linea.cartelColorDetalle || secondary;
  const borderColor = linea.cartelColorBorde || '#64748b';
  const showsLogo = Boolean(linea.logoUrl && logoPosition !== 'ninguno');

  return (
    <Modal
      open={Boolean(linea)}
      title="Ficha Técnica de la Línea"
      description={`Consulta de identidad visual, señalización y letrero de la Línea ${linea.codigo}`}
      className="qv-modal--wide"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {onChangeState && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onClose();
                  onChangeState(linea);
                }}
              >
                <RefreshCcw size={14} style={{ marginRight: '0.35rem' }} />
                Cambiar estado
              </Button>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        {/* Columna Izquierda: Identidad, Distintivo y Paleta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Cabecera Principal de Identidad */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--qv-radius-lg)',
              background: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            {/* Badge Grande de Línea */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '3.5rem',
                height: '2.75rem',
                padding: '0 0.75rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: primary,
                border: `2px solid ${secondary}`,
                color: linea.colorTexto ?? '#ffffff',
                fontFamily: 'var(--qv-font-display)',
                fontWeight: 800,
                fontSize: '1.25rem',
                letterSpacing: '0.04em',
                boxShadow: '0 3px 10px rgba(0,0,0,0.25)',
                flexShrink: 0,
              }}
            >
              {code}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--qv-text-primary)' }}>
                  {linea.nombre}
                </h4>
                <StatusBadge
                  circle
                  status={ESTADO_BADGE_MAP[linea.publicStatus]}
                  label={`App: ${estadoPublicoEtiqueta(linea.publicStatus)}`}
                />
              </div>
              {linea.lema && (
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--qv-text-muted)', fontStyle: 'italic' }}>
                  "{linea.lema}"
                </p>
              )}
              {sindicatoNombre && (
                <small style={{ display: 'block', marginTop: '0.15rem', color: 'var(--qv-text-secondary)', fontSize: '0.72rem' }}>
                  Sindicato: <strong>{sindicatoNombre}</strong>
                </small>
              )}
            </div>
          </div>

          {/* Señalización y Banderita */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.75rem 0.9rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'color-mix(in srgb, var(--qv-surface-soft) 80%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--qv-text-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <Flag size={13} style={{ color: 'var(--qv-color-primary)' }} />
              Distintivo y Señalización
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
              {hasMarker ? (
                isBanderita ? (
                  <BanderitaBadge
                    texto={marker}
                    patron={parsedDistintivo.patron}
                    colorPrimario={primary}
                    colorSecundario={secondary}
                  />
                ) : (
                  <span
                    style={{
                      padding: '0.2rem 0.55rem',
                      borderRadius: 'var(--qv-radius-full)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))',
                      color: 'var(--qv-color-primary)',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                    }}
                  >
                    {marker}
                  </span>
                )
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-muted)' }}>
                  Sin distintivo de banderita
                </span>
              )}

              {linea.cartelSuperior && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--qv-text-secondary)',
                    padding: '0.15rem 0.45rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: 'var(--qv-surface-card)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  Recorrido: <strong>{linea.cartelSuperior}</strong>
                </span>
              )}
            </div>
          </div>

          {/* Paleta de Colores Oficiales */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.75rem 0.9rem',
              borderRadius: 'var(--qv-radius-md)',
              background: 'var(--qv-surface-glass)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--qv-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <Palette size={13} style={{ color: 'var(--qv-color-primary)' }} />
              Paleta de Marca Oficial
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.4rem' }}>
              {[
                { label: 'Primario', color: primary },
                { label: 'Secundario', color: secondary },
                { label: 'Terciario', color: tertiary },
                { label: 'Texto', color: linea.colorTexto || '#ffffff' },
                { label: 'Fondo', color: background },
              ].map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.25rem 0.45rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: 'var(--qv-surface-card)',
                    border: '1px solid var(--qv-border-glass)',
                  }}
                >
                  <span
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      backgroundColor: c.color,
                      border: '1px solid var(--qv-border-glass)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <small style={{ fontSize: '0.62rem', color: 'var(--qv-text-muted)', lineHeight: 1 }}>
                      {c.label}
                    </small>
                    <strong style={{ fontSize: '0.68rem', color: 'var(--qv-text-primary)' }}>
                      {c.color}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Cartel de Techo y Estado en App */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Maqueta del Cartel de Techo */}
          <div
            className="trufi-sign-preview"
            style={{
              background: `linear-gradient(145deg, ${background}, color-mix(in srgb, ${primary} 7%, white))`,
              borderColor: `${primary}2e`,
              minHeight: 'auto',
              padding: '0.85rem',
            }}
          >
            <span className="trufi-sign-preview__caption">
              Maqueta oficial del cartel de techo · vista frontal
            </span>
            <div className="trufi-sign-preview__workbench" style={{ margin: '0.6rem 0' }}>
              <div
                className={`trufi-sign-preview__banner trufi-sign-preview__banner--${bannerFormat} trufi-sign-preview__banner--number-${numberPosition}`}
                style={{ borderColor, boxShadow: `0 0.42rem 0.8rem ${borderColor}30` }}
              >
                {showsLogo && logoPosition === 'izquierda' && linea.logoUrl && (
                  <span className="trufi-sign-preview__logo">
                    <img src={linea.logoUrl} alt="" />
                  </span>
                )}
                <span
                  className="trufi-sign-preview__number"
                  style={{ borderColor, color: numberColor }}
                >
                  {code}
                </span>
                <div className="trufi-sign-preview__destinations">
                  <strong className="trufi-sign-preview__destination-top" style={{ color: titleColor }}>
                    {bannerTop.toUpperCase()}
                  </strong>
                  <strong
                    className="trufi-sign-preview__destination-bottom"
                    style={{ color: detailColor }}
                  >
                    {bannerBottom.toUpperCase()}
                  </strong>
                </div>
                {showsLogo && logoPosition === 'derecha' && linea.logoUrl && (
                  <span className="trufi-sign-preview__logo">
                    <img src={linea.logoUrl} alt="" />
                  </span>
                )}
              </div>
            </div>
            <div className="trufi-sign-preview__reading">
              <span>
                <Info size={13} aria-hidden="true" /> Letrero de techo
              </span>
              <strong>
                {bannerTop} · {bannerBottom}
              </strong>
            </div>
          </div>

          {/* Estado de Publicación en App */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 0.9rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Globe size={15} style={{ color: 'var(--qv-color-primary)' }} />
              <div>
                <strong style={{ fontSize: '0.78rem', display: 'block' }}>Estado en App de Pasajeros</strong>
                <small style={{ fontSize: '0.7rem', color: 'var(--qv-text-muted)' }}>
                  {linea.publicStatus === 'publicado'
                    ? `Publicada y visible para usuarios${linea.publishedAt ? ` desde ${new Date(linea.publishedAt).toLocaleDateString()}` : ''}.`
                    : linea.publicStatus === 'validado'
                      ? 'Validada operativamente, lista para publicar.'
                      : 'En borrador (no visible para pasajeros).'}
                </small>
              </div>
            </div>
            <StatusBadge
              circle
              status={ESTADO_BADGE_MAP[linea.publicStatus]}
              label={estadoPublicoEtiqueta(linea.publicStatus)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
