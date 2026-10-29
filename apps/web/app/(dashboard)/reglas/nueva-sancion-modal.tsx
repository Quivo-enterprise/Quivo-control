import { useState } from 'react';
import { Alert, Button, DatePicker, Input, Modal, Select, TextArea } from '@quivo/design-system';
import type { Conductor, Regla, Socio, SujetoTipo, Vehiculo } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { sancionesApi } from '../../../src/lib/api/sanciones';
import { fechaDesdeDiaLocal } from '../../../src/lib/fecha-local';

export const SUJETO_TIPOS: { label: string; value: SujetoTipo }[] = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
  { label: 'Socio', value: 'socio' },
];

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

export function NuevaSancionModal(props: {
  token: string | null;
  sindicatoId: string;
  reglas: Regla[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  socios: Socio[];
  onClose: () => void;
  onCreada: () => void;
}) {
  const {
    token,
    sindicatoId,
    reglas,
    vehiculos,
    conductores,
    socios,
    onClose,
    onCreada,
  } = props;
  const [reglaId, setReglaId] = useState(reglas[0]?.id ?? '');
  const [sujetoTipo, setSujetoTipo] = useState<SujetoTipo>('vehiculo');
  const [sujetoId, setSujetoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fechaHecho, setFechaHecho] = useState('');
  const [evidenciaRef, setEvidenciaRef] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opcionesSujeto =
    sujetoTipo === 'vehiculo'
      ? vehiculos.map((v) => ({ label: v.placa, value: v.id }))
      : sujetoTipo === 'conductor'
        ? conductores.map((c) => ({ label: c.nombre, value: c.id }))
        : socios.map((s) => ({ label: s.nombre, value: s.id }));

  async function guardar() {
    if (!token || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho) return;
    const fecha = fechaDesdeDiaLocal(fechaHecho);
    if (!fecha) {
      setError('La fecha del hecho no es válida.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await sancionesApi.crear(token, {
        sindicatoId,
        reglaId,
        sujetoTipo,
        sujetoId,
        motivo: motivo.trim(),
        fechaHecho: fecha,
        evidenciaRef: evidenciaRef.trim() || undefined,
      });
      onCreada();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Nueva sanción"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={guardando || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho}
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {error && (
          <Alert variant="danger" title="No se pudo guardar">
            {error}
          </Alert>
        )}
        <Select
          label="Regla"
          options={reglas.map((r) => ({ label: `${r.nombre} — [${r.gravedad.toUpperCase()}]`, value: r.id }))}
          value={reglaId}
          onChange={(e) => setReglaId(e.target.value)}
        />
        <Select
          label="Tipo de sujeto"
          options={SUJETO_TIPOS}
          value={sujetoTipo}
          onChange={(e) => {
            setSujetoTipo(e.target.value as SujetoTipo);
            setSujetoId('');
          }}
        />
        <Select
          label="Sujeto"
          options={opcionesSujeto}
          value={sujetoId}
          onChange={(e) => setSujetoId(e.target.value)}
        />
        <TextArea label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <DatePicker
          label="Fecha del hecho"
          value={fechaHecho}
          onChange={(e) => setFechaHecho(e.target.value)}
        />
        <Input
          label="Referencia de evidencia (opcional)"
          value={evidenciaRef}
          onChange={(e) => setEvidenciaRef(e.target.value)}
          helperText="Vinculación automática a datos de recorrido llega con M3 — por ahora es texto libre."

        />
      </div>
    </Modal>
  );
}
