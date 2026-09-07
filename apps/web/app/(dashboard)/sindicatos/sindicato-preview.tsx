'use client';

import { StatusBadge } from '@quivo/design-system';
import {
  Building2,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

interface SindicatoPreviewCardProps {
  values: Record<string, string>;
}

export function SindicatoPreviewCard({ values }: SindicatoPreviewCardProps) {
  const nombre = values.nombre?.trim() || 'Nombre del Sindicato';
  const estado = values.estado || 'activo';

  return (
    <aside
      className="sindicato-preview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        width: '100%',
      }}
      aria-label="Vista previa del sindicato"
    >
      {/* ── Header ── */}
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
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 800, color: 'var(--qv-text-primary)' }}>
              Identidad del Sindicato
            </h3>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)' }}>
              Actualización instantánea según los datos ingresados
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

      {/* ── Tarjeta Digital de Sindicato ── */}
      <div
        style={{
          padding: '1.35rem',
          borderRadius: 'var(--qv-radius-xl)',
          background: 'var(--qv-surface-glass)',
          backdropFilter: 'blur(24px) saturate(190%)',
          WebkitBackdropFilter: 'blur(24px) saturate(190%)',
          border: '1px solid var(--qv-border-glass)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.15rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow de acento superior */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background:
              estado === 'activo'
                ? 'linear-gradient(90deg, #3226b4, #06b6d4)'
                : 'linear-gradient(90deg, #64748b, #475569)',
          }}
        />

        {/* Identificación del Sindicato */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '3.5rem',
              height: '3.5rem',
              borderRadius: 'var(--qv-radius-xl)',
              background: 'linear-gradient(135deg, var(--qv-color-primary), #06b6d4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 16px rgba(50, 38, 180, 0.4)',
              flexShrink: 0,
            }}
          >
            <Building2 size={24} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--qv-text-secondary)',
              }}
            >
              Organización de Transporte
            </span>
            <h4
              style={{
                margin: '0.15rem 0 0 0',
                fontSize: '1.05rem',
                fontWeight: 800,
                color: 'var(--qv-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nombre}
            </h4>
            <div style={{ marginTop: '0.35rem' }}>
              <StatusBadge
                circle
                status={estado === 'activo' ? 'active' : 'inactive'}
                label={estado.toUpperCase()}
              />
            </div>
          </div>
        </div>

        {/* Información Operativa */}
        <div
          style={{
            padding: '0.75rem 0.85rem',
            borderRadius: 'var(--qv-radius-md)',
            backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
            border: '1px solid var(--qv-border-glass)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)', fontWeight: 600 }}>
              Operador Habilitado en Quivo Control
            </span>
          </div>
          <ShieldCheck size={18} style={{ color: '#34d399' }} />
        </div>
      </div>

      {/* ── Verificación Regulatoria ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.75rem 0.85rem',
          borderRadius: 'var(--qv-radius-lg)',
          backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 40%, transparent)',
          border: '1px solid var(--qv-border-glass)',
          fontSize: '0.75rem',
          color: 'var(--qv-text-secondary)',
        }}
      >
        <Users size={16} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
        <span>
          Organización sindical registrada para la gestión de flota, asignación de turnos y control estatutario.
        </span>
      </div>
    </aside>
  );
}
