'use client';

import { useState } from 'react';
import {
  BanderitaBadge,
  BanderitaIcon,
  type TipoPatronBanderita,
  parsearDistintivoBanderita,
} from '@quivo/design-system';
import {
  Activity,
  Bus,
  Compass,
  FileText,
  Hash,
  Info,
  Layers,
  Map as MapIcon,
  MapPin,
  Navigation,
  Palette,
  Radio,
  Shapes,
  Sparkles,
  Type,
} from 'lucide-react';

interface LineaBoxPreviewProps {
  values: Record<string, string>;
}

export const VARIANTES_BANDERITA: Array<{
  patron: TipoPatronBanderita;
  label: string;
  descripcion: string;
}> = [
  {
    patron: 'solida',
    label: 'Color puro',
    descripcion: 'Sólida con el color primario de la línea',
  },
  {
    patron: 'mitad_horizontal',
    label: 'Mitad (50/50)',
    descripcion: 'Bicolor horizontal con colores oficiales',
  },
  {
    patron: 'franja_arriba_pequena',
    label: 'Franja superior delgada',
    descripcion: 'Franja delgada arriba de acento',
  },
  {
    patron: 'franja_abajo_pequena',
    label: 'Franja inferior delgada',
    descripcion: 'Franja delgada abajo de acento',
  },
  {
    patron: 'mitad_vertical',
    label: 'Dividida vertical',
    descripcion: 'Bicolor vertical izquierda/derecha',
  },
  {
    patron: 'diagonal',
    label: 'Diagonal',
    descripcion: 'Bicolor con corte en diagonal',
  },
  {
    patron: 'tricolor',
    label: 'Tricolor',
    descripcion: 'Tres franjas horizontales',
  },
];

export function LineaBoxPreview({ values }: LineaBoxPreviewProps) {
  const [activeTab, setActiveTab] = useState<'cartel' | 'mapa'>('cartel');

  const primary = values.color || '#3226b4';
  const secondary = values.colorSecundario || '#fd9e15';
  const tertiary = values.colorTerciario || '#10b981';
  const textColor = values.colorTexto || '#ffffff';
  const background = values.colorFondo || '#f8fafc';
  const code = values.nombreCorto || values.codigo || '120';
  const marker = values.distintivoValor?.trim() || '';
  const hasMarker = marker.length > 0;
  const isBanderita = values.distintivoTipo === 'banderita' || marker.toLowerCase().includes('bander');
  const parsedDistintivo = parsearDistintivoBanderita(marker);

  const roofSign = values.cartelSuperior || 'TIQUIPAYA · UNIVALLE';
  const name = values.nombre || 'Línea 120';
  const destinations = roofSign
    .split(/\s*(?:↔|→|⇄|·|\||—|–)\s*/)
    .map((destination) => destination.trim())
    .filter(Boolean);
  const bannerTop = values.cartelTitulo || destinations[0] || roofSign;
  const bannerBottom =
    values.cartelDetalle || destinations.slice(1).join(' · ') || values.lema || 'RUTA URBANA';
  const bannerFormat = values.cartelFormato || 'doble_clasico';
  const numberPosition = values.cartelNumeroPosicion || 'izquierda';
  const logoPosition = values.cartelLogoPosicion || 'ninguno';
  const numberColor = values.cartelColorNumero || primary;
  const titleColor = values.cartelColorTitulo || primary;
  const detailColor = values.cartelColorDetalle || secondary;
  const borderColor = values.cartelColorBorde || '#64748b';
  const showsLogo = Boolean(values.logoUrl && logoPosition !== 'ninguno');

  return (
    <aside className="line-box-preview" aria-label="Vista previa de la línea y simulación en mapa">
      {/* ── Header: Vista previa + badge En vivo ── */}
      <div className="line-box-preview__header" style={{ marginBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Vista previa</h3>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-muted)' }}>
              Identidad visual y presencia cartográfica
            </span>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.2rem 0.6rem',
              borderRadius: 'var(--qv-radius-full)',
              fontSize: '0.68rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: 'color-mix(in srgb, var(--qv-color-success, #22c55e) 15%, transparent)',
              color: 'var(--qv-color-success, #16a34a)',
              border: '1px solid color-mix(in srgb, var(--qv-color-success, #22c55e) 35%, transparent)',
            }}
            aria-label="En vivo"
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--qv-color-success, #22c55e)',
                animation: 'qv-live-pulse 1.6s ease-in-out infinite',
                flexShrink: 0,
              }}
            />
            En vivo
          </span>
        </div>
      </div>

      {/* Selector de Modo de Vista Previa: [ Letrero ] [ En Mapa en Vivo ] */}
      <div
        style={{
          display: 'flex',
          gap: '0.35rem',
          padding: '0.25rem',
          borderRadius: 'var(--qv-radius-md)',
          backgroundColor: 'color-mix(in srgb, var(--qv-surface-soft) 80%, transparent)',
          border: '1px solid var(--qv-border-glass)',
          marginBottom: '0.85rem',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('cartel')}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            padding: '0.4rem 0.6rem',
            borderRadius: 'var(--qv-radius-sm)',
            fontSize: '0.72rem',
            fontWeight: activeTab === 'cartel' ? 800 : 600,
            cursor: 'pointer',
            border: activeTab === 'cartel' ? '1px solid var(--qv-color-primary)' : '1px solid transparent',
            backgroundColor: activeTab === 'cartel' ? 'var(--qv-surface-card)' : 'transparent',
            color: activeTab === 'cartel' ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
            transition: 'all var(--qv-transition-fast)',
            boxShadow: activeTab === 'cartel' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          <Layers size={13} />
          <span>Cartel y Techo</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mapa')}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            padding: '0.4rem 0.6rem',
            borderRadius: 'var(--qv-radius-sm)',
            fontSize: '0.72rem',
            fontWeight: activeTab === 'mapa' ? 800 : 600,
            cursor: 'pointer',
            border: activeTab === 'mapa' ? '1px solid var(--qv-color-primary)' : '1px solid transparent',
            backgroundColor: activeTab === 'mapa' ? 'var(--qv-surface-card)' : 'transparent',
            color: activeTab === 'mapa' ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
            transition: 'all var(--qv-transition-fast)',
            boxShadow: activeTab === 'mapa' ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          <MapIcon size={13} />
          <span>Vehículo en Mapa</span>
        </button>
      </div>

      {/* ── MODO 1: Maqueta del Cartel de Techo ── */}
      {activeTab === 'cartel' && (
        <div
          className="trufi-sign-preview"
          style={{
            background: `linear-gradient(145deg, ${background}, color-mix(in srgb, ${primary} 7%, white))`,
            borderColor: `${primary}2e`,
          }}
        >
          <span className="trufi-sign-preview__caption">
            Maqueta del cartel · vista frontal aislada
          </span>
          <div className="trufi-sign-preview__workbench">
            <div
              className={`trufi-sign-preview__banner trufi-sign-preview__banner--${bannerFormat} trufi-sign-preview__banner--number-${numberPosition}`}
              style={{ borderColor, boxShadow: `0 0.42rem 0.8rem ${borderColor}30` }}
            >
              {showsLogo && logoPosition === 'izquierda' ? (
                <span className="trufi-sign-preview__logo">
                  <img src={values.logoUrl} alt="" />
                </span>
              ) : null}
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
              {showsLogo && logoPosition === 'derecha' ? (
                <span className="trufi-sign-preview__logo">
                  <img src={values.logoUrl} alt="" />
                </span>
              ) : null}
            </div>
          </div>
          <div className="trufi-sign-preview__reading">
            <span>
              <Info size={14} aria-hidden="true" /> Letrero de techo
            </span>
            <strong>
              {bannerTop} · {bannerBottom}
            </strong>
          </div>
        </div>
      )}

      {/* ── MODO 2: Simulación del Vehículo en Mapa en Vivo ── */}
      {activeTab === 'mapa' && (
        <div
          style={{
            position: 'relative',
            borderRadius: 'var(--qv-radius-lg)',
            border: `1px solid color-mix(in srgb, ${primary} 40%, var(--qv-border-glass))`,
            backgroundColor: '#0c121e',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: `0 4px 18px color-mix(in srgb, ${primary} 15%, transparent)`,
          }}
        >
          {/* Cabecera del Mapa en Vivo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(12px)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              zIndex: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Compass size={13} style={{ color: primary }} />
              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Simulador Radar en Mapa
              </span>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.65rem',
                color: '#34d399',
                fontWeight: 700,
              }}
            >
              <Radio size={11} className="animate-pulse" />
              <span>38 km/h</span>
            </div>
          </div>

          {/* Lienzo Cartográfico Simulado */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '210px',
              backgroundColor: '#090e17',
              backgroundImage: `
                radial-gradient(circle at 50% 50%, color-mix(in srgb, ${primary} 12%, transparent) 0%, transparent 70%),
                linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
              `,
              backgroundSize: '100% 100%, 20px 20px, 20px 20px',
              overflow: 'hidden',
            }}
          >
            {/* Calles y Vías Urbanas Simuladas con Coordenadas Normalizadas */}
            <svg
              viewBox="0 0 400 210"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              {/* Calles secundarias de fondo */}
              <line x1="0" y1="45" x2="400" y2="45" stroke="#1e293b" strokeWidth="2" />
              <line x1="0" y1="150" x2="400" y2="150" stroke="#1e293b" strokeWidth="2" />
              <line x1="75" y1="0" x2="75" y2="210" stroke="#1e293b" strokeWidth="2" />
              <line x1="315" y1="0" x2="315" y2="210" stroke="#1e293b" strokeWidth="2" />

              {/* Traza de Ruta Asignada en el Color de la Línea */}
              <path
                d="M 25 175 C 110 165 145 130 200 105 C 255 80 300 55 375 42"
                fill="none"
                stroke={primary}
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray="6 3"
                style={{
                  filter: `drop-shadow(0 0 7px ${primary})`,
                }}
              />

              {/* Puntos de Control / Paradas */}
              <circle cx="45" cy="170" r="4.5" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
              <circle cx="360" cy="45" r="4.5" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
            </svg>

            {/* Cursor Direccional del Vehículo: Cápsula Suave Centrada Exactamente sobre la Línea */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) rotate(-24deg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 20,
                filter: `drop-shadow(0 4px 12px rgba(0,0,0,0.7)) drop-shadow(0 0 10px ${primary})`,
              }}
              title={`Línea ${code} en rumbo norte-este`}
            >
              {/* Onda de Radar Pulsante */}
              <div
                style={{
                  position: 'absolute',
                  inset: '-8px -12px',
                  borderRadius: '999px',
                  border: `1.5px solid ${primary}`,
                  backgroundColor: `color-mix(in srgb, ${primary} 22%, transparent)`,
                  animation: 'qv-live-pulse 1.8s ease-in-out infinite',
                  pointerEvents: 'none',
                }}
              />

              {/* Cápsula SVG con Contornos Suaves, Esquinas Redondeadas y solo la Línea en el Interior */}
              <svg
                width={Math.max(56, Math.max(20, code.length * 8.5) + 36)}
                height="28"
                viewBox={`0 0 ${Math.max(56, Math.max(20, code.length * 8.5) + 36)} 28`}
                fill="none"
                style={{ overflow: 'visible', flexShrink: 0 }}
              >
                {(() => {
                  const codeLen = code.length;
                  const textSpan = Math.max(20, codeLen * 8.5);
                  const totalLength = Math.max(56, textSpan + 32);
                  const radius = 12;
                  const leftArcCenter = radius + 2;
                  const bodyRight = totalLength - 15;
                  const tipX = totalLength - 2;
                  const shoulderX = bodyRight + 6;
                  const centerX = (2 + tipX) / 2;

                  const pathSmooth = `
                    M ${leftArcCenter} 2
                    L ${bodyRight} 2
                    Q ${bodyRight + 4} 2 ${shoulderX} 6
                    L ${tipX - 3} 12
                    Q ${tipX} 14 ${tipX - 3} 16
                    L ${shoulderX} 22
                    Q ${bodyRight + 4} 26 ${bodyRight} 26
                    L ${leftArcCenter} 26
                    A ${radius} ${radius} 0 0 1 ${leftArcCenter} 2
                    Z
                  `.replace(/\s+/g, ' ').trim();

                  return (
                    <>
                      {/* Cuerpo de la Cápsula Aerodinámica con Fillets y Esquinas Redondeadas */}
                      <path
                        d={pathSmooth}
                        fill={primary}
                        stroke={secondary || '#ffffff'}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {/* Código de la Línea centrado geométricamente con distancias homogéneas */}
                      <text
                        x={centerX}
                        y="18.5"
                        fill={textColor || '#ffffff'}
                        fontSize="12"
                        fontWeight="900"
                        fontFamily="var(--qv-font-body, system-ui, sans-serif)"
                        textAnchor="middle"
                        letterSpacing="0.5px"
                      >
                        {code}
                      </text>
                    </>
                  );
                })()}
              </svg>
            </div>

            {/* Tarjeta Emergente de Pasajero / Telemetría Flotante */}
            <div
              style={{
                position: 'absolute',
                bottom: '0.45rem',
                left: '0.5rem',
                right: '0.5rem',
                padding: '0.45rem 0.65rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                zIndex: 15,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                <div
                  style={{
                    width: '1.75rem',
                    height: '1.75rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: primary,
                    color: textColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '0.72rem',
                    flexShrink: 0,
                    border: `1px solid ${secondary || 'transparent'}`,
                  }}
                >
                  {code}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <strong style={{ fontSize: '0.72rem', color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {bannerTop} ➔ {bannerBottom}
                  </strong>
                  <span style={{ fontSize: '0.62rem', color: 'var(--qv-text-secondary)' }}>
                    Próx: Av. América (en 2 min)
                  </span>
                </div>
              </div>

              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: '#34d399',
                  backgroundColor: 'rgba(52, 211, 153, 0.12)',
                  padding: '0.15rem 0.4rem',
                  borderRadius: 'var(--qv-radius-sm)',
                  border: '1px solid rgba(52, 211, 153, 0.25)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                En horario
              </span>
            </div>
          </div>

          {/* Pie informativo de la simulación */}
          <div
            style={{
              padding: '0.45rem 0.75rem',
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.68rem',
              color: 'var(--qv-text-secondary)',
            }}
          >
            <span>Así verán los pasajeros este vehículo en la app</span>
            <Sparkles size={12} style={{ color: primary }} />
          </div>
        </div>
      )}

      {/* Identidad de la Línea y Banderita Actual */}
      <div className="line-box-preview__identity">
        {values.logoUrl ? (
          <img src={values.logoUrl} alt="" className="line-box-preview__logo" />
        ) : (
          <span className="line-box-preview__logo-fallback" style={{ background: primary, color: textColor }}>
            {code.slice(0, 3)}
          </span>
        )}
        <div style={{ flex: 1 }}>
          <span className="line-box-preview__identity-label">Línea configurada</span>
          <strong>{name}</strong>
            {hasMarker ? (
              isBanderita ? (
                <BanderitaBadge
                  texto={marker}
                  patron={parsedDistintivo.patron}
                  colorPrimario={primary}
                  colorSecundario={secondary}
                />
              ) : values.distintivoTipo === 'cartel' ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card))',
                    border: `1.5px solid ${primary}`,
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: primary,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                  }}
                >
                  <FileText size={12} />
                  <span>CARTEL: {marker}</span>
                </span>
              ) : values.distintivoTipo === 'numero' ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--qv-radius-full)',
                    backgroundColor: primary,
                    color: textColor,
                    fontSize: '0.72rem',
                    fontWeight: 800,
                  }}
                >
                  <Hash size={12} />
                  <span>{marker}</span>
                </span>
              ) : values.distintivoTipo === 'simbolo' ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--qv-radius-full)',
                    backgroundColor: 'color-mix(in srgb, #f59e0b 20%, transparent)',
                    border: '1px solid #f59e0b',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#f59e0b',
                  }}
                >
                  <Shapes size={12} />
                  <span>{marker}</span>
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: 'color-mix(in srgb, var(--qv-text-secondary) 15%, transparent)',
                    border: '1px solid var(--qv-border-glass)',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--qv-text-primary)',
                  }}
                >
                  <Type size={12} />
                  <span>{marker}</span>
                </span>
              )
            ) : (
              <small style={{ color: 'var(--qv-text-muted)' }}>Sin distintivo secundario (estándar)</small>
            )}
        </div>
      </div>

      {/* Rótulo y Colores de la Línea con efecto apilado */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.65rem 0.85rem',
          borderRadius: 'var(--qv-radius-md)',
          backgroundColor: 'var(--qv-surface-glass)',
          border: '1px solid var(--qv-border-glass)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--qv-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <Palette size={14} style={{ color: 'var(--qv-color-primary)' }} /> Paleta de Marca
        </span>
        <div
          style={{
            position: 'relative',
            width: tertiary ? '3.25rem' : secondary ? '2.5rem' : '1.85rem',
            height: '1.85rem',
            flexShrink: 0,
          }}
          aria-label={`Colores: ${primary}, ${secondary}, ${tertiary}`}
        >
          {tertiary && (
            <div
              style={{
                position: 'absolute',
                left: '1.4rem',
                top: 0,
                width: '1.85rem',
                height: '1.85rem',
                borderRadius: '50%',
                backgroundColor: tertiary,
                border: '2px solid var(--qv-border-glass)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                zIndex: 0,
              }}
              title={`Apoyo: ${tertiary}`}
            />
          )}
          {secondary && (
            <div
              style={{
                position: 'absolute',
                left: '0.7rem',
                top: 0,
                width: '1.85rem',
                height: '1.85rem',
                borderRadius: '50%',
                backgroundColor: secondary,
                border: '2px solid var(--qv-border-glass)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                zIndex: 1,
              }}
              title={`Secundario: ${secondary}`}
            />
          )}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '1.85rem',
              height: '1.85rem',
              borderRadius: '50%',
              backgroundColor: primary,
              border: '2px solid var(--qv-border-glass)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              zIndex: 2,
            }}
            title={`Primario: ${primary}`}
          />
        </div>
      </div>
    </aside>
  );
}
