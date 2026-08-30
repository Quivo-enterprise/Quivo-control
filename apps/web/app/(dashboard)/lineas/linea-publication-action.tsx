import { useState } from 'react';
import { Tooltip } from '@quivo/design-system';
import { Globe } from 'lucide-react';
import type { EstadoPublicacion, Linea } from '@quivo/shared';
import { lineasApi } from '../../../src/lib/api/lineas';

const SIGUIENTE_ESTADO: Record<EstadoPublicacion, EstadoPublicacion | null> = {
  borrador: 'validado',
  validado: 'publicado',
  publicado: 'validado',
  archivado: 'borrador',
};

const ETIQUETA_TRANSICION: Record<EstadoPublicacion, string> = {
  borrador: 'Validar',
  validado: 'Publicar',
  publicado: 'Quitar de la app',
  archivado: 'Reabrir',
};

export function estadoPublicoEtiqueta(status: EstadoPublicacion) {
  return status === 'publicado'
    ? 'Visible'
    : status === 'validado'
      ? 'Lista para publicar'
      : 'No visible';
}

export function LineaPublicationAction({
  linea,
  token,
  onUpdated,
}: {
  linea: Linea;
  token: string;
  onUpdated: (publication: { status: EstadoPublicacion; publishedAt: string | null }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextStatus = SIGUIENTE_ESTADO[linea.publicStatus];

  if (!nextStatus) return null;

  const label = saving ? 'Actualizando...' : ETIQUETA_TRANSICION[linea.publicStatus];

  const updatePublication = async () => {
    setSaving(true);
    setError(null);
    try {
      const publication = await lineasApi.actualizarPublicacion(token, linea.id, nextStatus);
      onUpdated(publication);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la publicación.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Tooltip content={error ? `Error: ${error}` : `${label} en la app pública`}>
        <button
          type="button"
          className="qv-action-pill-btn"
          onClick={updatePublication}
          disabled={saving || !token}
          aria-label={label}
        >
          <Globe size={13} />
        </button>
      </Tooltip>
      <span className="qv-action-pill-divider" />
    </>
  );
}
