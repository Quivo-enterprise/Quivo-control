import { useState } from 'react';
import { Alert, Button, ConfirmDialog, Modal, Select } from '@quivo/design-system';
import type { Asignacion, Conductor, Turno, Vehiculo } from '@quivo/shared';
import { HORARIOS } from './rotacion-constants';
import { mensajeError, type RotacionConAsignaciones, type RutaConLinea } from './use-rotaciones';
import { rotacionesApi } from '../../../src/lib/api/rotaciones';

export function AsignacionModal(props: {
  token: string | null;
  rotacion: RotacionConAsignaciones;
  asignacion: Asignacion;
  rutas: RutaConLinea[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { token, rotacion, asignacion, rutas, vehiculos, conductores, onClose, onGuardado } = props;
  const [rutaId, setRutaId] = useState(asignacion.rutaId);
  const [conductorId, setConductorId] = useState(asignacion.conductorId ?? '');
  const [horario, setHorario] = useState<Turno>(asignacion.horario);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  async function guardar() {
    if (!token) return;
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.actualizarAsignacion(token, rotacion.id, asignacion.id, {
        rutaId,
        conductorId: conductorId || null,
        horario,
      });
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar() {
    if (!token) return;
    setConfirmarQuitar(false);
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.eliminarAsignacion(token, rotacion.id, asignacion.id);
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Modal
        open
        title={`Editar asignación — ${vehiculos.find((v) => v.id === asignacion.vehiculoId)?.placa ?? ''}`}
        onClose={onClose}
        footer={
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Button variant="danger" onClick={() => setConfirmarQuitar(true)} disabled={guardando}>
              Quitar
            </Button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="ghost" onClick={onClose} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
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
            label="Ruta"
            options={rutas.map((r) => ({ label: `${r.linea.codigo} — ${r.sentido}`, value: r.id }))}
            value={rutaId}
            onChange={(e) => setRutaId(e.target.value)}
          />
          <Select
            label="Conductor"
            options={[
              { label: 'Sin conductor', value: '' },
              ...conductores.map((c) => ({ label: c.nombre, value: c.id })),
            ]}
            value={conductorId}
            onChange={(e) => setConductorId(e.target.value)}
          />
          <Select
            label="Horario"
            options={HORARIOS}
            value={horario}
            onChange={(e) => setHorario(e.target.value as Turno)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmarQuitar}
        title="Quitar asignación"
        message="Esta asignación se elimina de la rotación. Esta acción no se puede deshacer."
        variant="danger"
        confirmLabel={guardando ? 'Quitando...' : 'Quitar'}
        onConfirm={quitar}
        onCancel={() => setConfirmarQuitar(false)}
      />
    </>
  );
}
