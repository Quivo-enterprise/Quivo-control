'use client';

import { StatusBadge } from '@quivo/design-system';
import {
  Award,
  Building2,
  CheckCircle2,
  CreditCard,
  FileBadge,
  QrCode,
  ShieldCheck,
  Sparkles,
  User,
  UserCheck,
} from 'lucide-react';

interface Option {
  label: string;
  value: string;
}

interface ConductorPreviewCardProps {
  values: Record<string, string>;
  sindicatoOptions?: Option[];
}

export function ConductorPreviewCard({ values, sindicatoOptions = [] }: ConductorPreviewCardProps) {
  const nombre = values.nombre?.trim() || 'Nombre del Conductor';
  const ci = values.documentoIdentidad?.trim() || '—';
  const licencia = values.licenciaConducir?.trim() || '—';
  const estado = values.estado || 'activo';
  const sindicatoId = values.sindicatoId || '';

  const sindicatoLabel =
    sindicatoOptions.find((s) => s.value === sindicatoId)?.label || 'Todos los sindicatos';

  const iniciales = nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'CD';

  return (
    <aside
      className="conductor-preview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        width: '100%',
      }}
      aria-label="Vista previa de la credencial del conductor"
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
              Credencial Digital del Conductor
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

      {/* ── Carnet Digital Oficial ── */}
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

        {/* Identificación del Conductor */}
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
              fontSize: '1.25rem',
              fontWeight: 800,
              boxShadow: '0 4px 16px rgba(50, 38, 180, 0.4)',
              flexShrink: 0,
            }}
          >
            {iniciales}
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
              Conductor Habilitado
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

        {/* Fichas de Documentación Oficial */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
              Cédula de Identidad
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.25rem' }}>
              <CreditCard size={14} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
              <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>{ci}</strong>
            </div>
          </div>

          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
              border: '1px solid var(--qv-border-glass)',
            }}
          >
            <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
              Licencia de Conducir
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.25rem' }}>
              <FileBadge size={14} style={{ color: 'var(--qv-color-accent)', flexShrink: 0 }} />
              <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>{licencia}</strong>
            </div>
          </div>
        </div>

        {/* Sindicato y Validez */}
        {sindicatoId && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--qv-radius-md)',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 65%, transparent)',
              border: '1px solid var(--qv-border-glass)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Sindicato Asignado
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
                <Building2 size={14} style={{ color: 'var(--qv-color-primary)' }} />
                <strong style={{ fontSize: '0.8125rem', color: 'var(--qv-text-primary)' }}>{sindicatoLabel}</strong>
              </div>
            </div>
            <ShieldCheck size={18} style={{ color: '#34d399' }} />
          </div>
        )}
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
        <UserCheck size={16} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
        <span>
          Datos validados conforme a la normativa de transporte urbano y registro oficial de conductores.
        </span>
      </div>
    </aside>
  );
}
