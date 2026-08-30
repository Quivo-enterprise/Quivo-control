'use client';

import { StatusBadge } from '@quivo/design-system';
import {
  AlertTriangle,
  Bell,
  Building2,
  Bus,
  CheckCircle2,
  Info,
  Scale,
  ShieldAlert,
  Smartphone,
  Sparkles,
  User,
  Users,
} from 'lucide-react';

interface Option {
  label: string;
  value: string;
}

interface ReglaPreviewCardProps {
  values: Record<string, string>;
  sindicatoOptions?: Option[];
}

export function ReglaPreviewCard({ values, sindicatoOptions = [] }: ReglaPreviewCardProps) {
  const nombre = values.nombre?.trim() || 'Nueva Regla o Infracción';
  const tipo = values.tipo?.trim() || 'General / Operación';
  const gravedad = values.gravedad || 'leve';
  const aplicaA = values.aplicaA || 'conductor';
  const descripcion =
    values.descripcion?.trim() ||
    'Describe aquí la tipificación de la falta, causales y alcance sancionatorio para que figure en el estatuto oficial.';
  const estado = values.estado || 'activo';
  const sindicatoId = values.sindicatoId || '';

  const sindicatoLabel =
    sindicatoOptions.find((s) => s.value === sindicatoId)?.label || 'Todos los sindicatos';

  const SujetoIcon = aplicaA === 'conductor' ? User : aplicaA === 'vehiculo' ? Bus : Users;

  return (
    <aside
      className="regla-preview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        width: '100%',
      }}
      aria-label="Vista previa del estatuto o regla"
    >
      {/* ── Cabecera de la Vista Previa ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: '0.65rem',
          borderBottom: '1px solid var(--qv-border-glass)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sparkles size={16} style={{ color: 'var(--qv-color-primary)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800, color: '#ffffff' }}>
              Vista previa en tiempo real
            </h3>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)' }}>
              Actualización instantánea según los campos del formulario
            </span>
          </div>
        </div>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.55rem',
            borderRadius: '999px',
            fontSize: '0.6875rem',
            fontWeight: 700,
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.35)',
          }}
        >
          <span
            style={{
              width: '0.45rem',
              height: '0.45rem',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 6px #10b981',
            }}
          />
          EN VIVO
        </span>
      </div>

      {/* ── Tarjeta Oficial del Estatuto / Regla ── */}
      <div
        style={{
          padding: '1.25rem',
          borderRadius: 'var(--qv-radius-xl)',
          background: 'var(--qv-surface-glass)',
          backdropFilter: 'blur(24px) saturate(190%)',
          WebkitBackdropFilter: 'blur(24px) saturate(190%)',
          border: '1px solid var(--qv-border-glass)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow de acento según gravedad */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background:
              gravedad === 'gravisima'
                ? 'linear-gradient(90deg, #ef4444, #f43f5e)'
                : gravedad === 'grave'
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : 'linear-gradient(90deg, #10b981, #34d399)',
            boxShadow:
              gravedad === 'gravisima'
                ? '0 0 12px rgba(239, 68, 68, 0.8)'
                : gravedad === 'grave'
                  ? '0 0 12px rgba(245, 158, 11, 0.8)'
                  : '0 0 12px rgba(16, 185, 129, 0.8)',
          }}
        />

        {/* Encabezado de la Tarjeta */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--qv-color-primary)',
                boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)',
                flexShrink: 0,
              }}
            >
              <Scale size={20} />
            </div>
            <div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--qv-text-secondary)',
                }}
              >
                Estatuto Sindical
              </span>
              <h4 style={{ margin: '0.15rem 0 0 0', fontSize: '1rem', fontWeight: 800, color: '#ffffff' }}>
                {nombre}
              </h4>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <GravedadBadgeInline gravedad={gravedad} />
            <StatusBadge
              circle
              status={estado === 'activo' ? 'active' : 'inactive'}
              label={estado.toUpperCase()}
            />
          </div>
        </div>

        {/* Fichas de Metadatos: Tipo, Sujeto y Ámbito */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
            gap: '0.65rem',
          }}
        >
          <div
            style={{
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
              Categoría
            </span>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#ffffff', marginTop: '0.2rem' }}>
              {tipo}
            </div>
          </div>

          <div
            style={{
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
              Aplica a
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
              <SujetoIcon size={14} style={{ color: 'var(--qv-color-primary)' }} />
              <strong style={{ fontSize: '0.8125rem', color: '#ffffff', textTransform: 'capitalize' }}>
                {aplicaA}
              </strong>
            </div>
          </div>

          {sindicatoId && (
            <div
              style={{
                padding: '0.6rem 0.75rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
                border: '1px solid var(--qv-border-glass)',
              }}
            >
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Sindicato
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                <Building2 size={13} style={{ color: 'var(--qv-color-primary)' }} />
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#ffffff',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sindicatoLabel}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Tipificación / Descripción */}
        <div
          style={{
            padding: '0.75rem 0.9rem',
            borderRadius: 'var(--qv-radius-md)',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 75%, transparent)',
            border: '1px solid var(--qv-border-glass)',
          }}
        >
          <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Tipificación y Causales
          </span>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8125rem', color: '#ffffff', lineHeight: 1.5 }}>
            {descripcion}
          </p>
        </div>
      </div>

      {/* ── Simulación de Notificación al Conductor / App Móvil ── */}
      <div
        style={{
          padding: '1rem',
          borderRadius: 'var(--qv-radius-xl)',
          backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 50%, transparent)',
          border: '1px solid var(--qv-border-glass)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Smartphone size={15} style={{ color: 'var(--qv-color-primary)' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--qv-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Simulación en App Móvil de Conductor
          </span>
        </div>

        <div
          style={{
            padding: '0.85rem',
            borderRadius: 'var(--qv-radius-lg)',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 90%, black)',
            border: '1px solid var(--qv-border-glass)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: '50%',
              backgroundColor:
                gravedad === 'gravisima'
                  ? 'rgba(239, 68, 68, 0.2)'
                  : gravedad === 'grave'
                    ? 'rgba(245, 158, 11, 0.2)'
                    : 'rgba(16, 185, 129, 0.2)',
              color:
                gravedad === 'gravisima'
                  ? '#f87171'
                  : gravedad === 'grave'
                    ? '#fbbf24'
                    : '#34d399',
              flexShrink: 0,
            }}
          >
            <Bell size={14} />
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.8125rem', color: '#ffffff' }}>
                Aviso Disciplinario
              </strong>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)' }}>
                Ahora
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-secondary)', lineHeight: 1.35 }}>
              Se ha emitido una observación por{' '}
              <strong style={{ color: '#ffffff' }}>{nombre}</strong> ({gravedad.toUpperCase()}).
            </span>
          </div>
        </div>
      </div>

      {/* ── Guía de Gravedad ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.65rem 0.85rem',
          borderRadius: 'var(--qv-radius-lg)',
          backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 40%, transparent)',
          border: '1px solid var(--qv-border-glass)',
          fontSize: '0.75rem',
          color: 'var(--qv-text-secondary)',
        }}
      >
        <Info size={14} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
        <span>
          {gravedad === 'gravisima'
            ? 'Infracción Gravísima: Aplica inhabilitación operativa o proceso sumario estatutario.'
            : gravedad === 'grave'
              ? 'Infracción Grave: Aplica suspensión temporal de turnos o sanción económica sindical.'
              : 'Infracción Leve: Aplica amonestación verbal o registro preventivo en hoja de ruta.'}
        </span>
      </div>
    </aside>
  );
}

function GravedadBadgeInline({ gravedad }: { gravedad: string }) {
  const g = gravedad?.toLowerCase();
  if (g === 'gravisima' || g === 'gravísima') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '999px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          color: '#f87171',
          border: '1px solid rgba(239, 68, 68, 0.45)',
          boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
        }}
      >
        <ShieldAlert size={12} style={{ color: '#f87171', flexShrink: 0 }} />
        <span>GRAVÍSIMA</span>
      </span>
    );
  }

  if (g === 'grave') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.2rem 0.6rem',
          borderRadius: '999px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          color: '#fbbf24',
          border: '1px solid rgba(245, 158, 11, 0.45)',
          boxShadow: '0 0 10px rgba(245, 158, 11, 0.25)',
        }}
      >
        <AlertTriangle size={12} style={{ color: '#fbbf24', flexShrink: 0 }} />
        <span>GRAVE</span>
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.72rem',
        fontWeight: 700,
        letterSpacing: '0.03em',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        color: '#34d399',
        border: '1px solid rgba(16, 185, 129, 0.45)',
        boxShadow: '0 0 10px rgba(16, 185, 129, 0.25)',
      }}
    >
      <CheckCircle2 size={12} style={{ color: '#34d399', flexShrink: 0 }} />
      <span>LEVE</span>
    </span>
  );
}
