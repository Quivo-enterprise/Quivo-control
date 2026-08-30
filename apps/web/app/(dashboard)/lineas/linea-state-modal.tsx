'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, FormField, Modal, Select, StatusBadge, type StatusBadgeStatus } from '@quivo/design-system';
import type { EstadoPublicacion, Linea } from '@quivo/shared';
import { Globe, RefreshCcw } from 'lucide-react';
import { lineasApi } from '../../../src/lib/api/lineas';
import { estadoPublicoEtiqueta } from './linea-publication-action';

const ESTADO_OPTIONS: { label: string; value: EstadoPublicacion; description: string }[] = [
  {
    value: 'publicado',
    label: 'Publicado (Visible en app)',
    description: 'La línea es visible para todos los pasajeros en la aplicación móvil.',
  },
  {
    value: 'validado',
    label: 'Validado (Listo para publicar)',
    description: 'La configuración de la línea está revisada y lista para su lanzamiento.',
  },
  {
    value: 'borrador',
    label: 'Borrador (Edición interna)',
    description: 'La línea está en preparación técnica y no se muestra a pasajeros.',
  },
  {
    value: 'archivado',
    label: 'Archivado (Retirado)',
    description: 'La línea queda archivada y deja de operar temporal o definitivamente.',
  },
];

const ESTADO_BADGE_MAP: Record<EstadoPublicacion, StatusBadgeStatus> = {
  publicado: 'active',
  validado: 'warning',
  borrador: 'idle',
  archivado: 'inactive',
};

export function LineaStateModal({
  linea,
  token,
  onClose,
  onUpdated,
}: {
  linea: Linea | null;
  token: string;
  onClose: () => void;
  onUpdated: (publication: { status: EstadoPublicacion; publishedAt: string | null }) => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState<EstadoPublicacion>(
    linea?.publicStatus ?? 'borrador',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!linea) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await lineasApi.actualizarPublicacion(token, linea.id, selectedStatus);
      onUpdated(result);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado de la línea.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(linea)}
      title="Cambiar Estado de la Línea"
      description={`Modifica la disponibilidad de la Línea ${linea.codigo} en la app de pasajeros`}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', width: '100%' }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" form="linea-state-form" size="sm" disabled={isSaving}>
            <RefreshCcw size={14} style={{ marginRight: '0.35rem' }} />
            {isSaving ? 'Guardando...' : 'Aplicar cambio'}
          </Button>
        </div>
      }
    >
      <form id="linea-state-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && (
          <Alert variant="danger" title="Error al actualizar estado">
            {error}
          </Alert>
        )}

        {/* Estado actual */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--qv-radius-md)',
            backgroundColor: 'var(--qv-surface-soft)',
            border: '1px solid var(--qv-border-glass)',
          }}
        >
          <div>
            <small style={{ fontSize: '0.7rem', color: 'var(--qv-text-muted)' }}>Estado actual:</small>
            <strong style={{ display: 'block', fontSize: '0.85rem' }}>Línea {linea.codigo} — {linea.nombre}</strong>
          </div>
          <StatusBadge
            circle
            status={ESTADO_BADGE_MAP[linea.publicStatus]}
            label={estadoPublicoEtiqueta(linea.publicStatus)}
          />
        </div>

        {/* Selector de nuevo estado */}
        <FormField label="Nuevo estado de publicación *" htmlFor="linea-nuevo-estado" required>
          <Select
            id="linea-nuevo-estado"
            options={ESTADO_OPTIONS.map((opt) => ({
              label: opt.label,
              value: opt.value,
            }))}
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value as EstadoPublicacion)}
            fullWidth
          />
        </FormField>

        {/* Tarjeta explicativa del estado seleccionado */}
        <div
          style={{
            padding: '0.65rem 0.85rem',
            borderRadius: 'var(--qv-radius-sm)',
            backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 8%, var(--qv-surface-card))',
            border: '1px solid color-mix(in srgb, var(--qv-color-primary) 20%, transparent)',
            fontSize: '0.75rem',
            color: 'var(--qv-text-secondary)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.45rem',
          }}
        >
          <Globe size={15} style={{ color: 'var(--qv-color-primary)', flexShrink: 0, marginTop: '2px' }} />
          <span>
            {ESTADO_OPTIONS.find((opt) => opt.value === selectedStatus)?.description}
          </span>
        </div>
      </form>
    </Modal>
  );
}
