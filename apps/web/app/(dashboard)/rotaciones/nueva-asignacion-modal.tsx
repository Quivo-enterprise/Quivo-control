import { useState } from 'react';
import { Alert, Button, DatePicker, Input, Modal, Select } from '@quivo/design-system';
import type { Conductor, Turno, Vehiculo } from '@quivo/shared';
import { HORARIOS } from './rotacion-constants';
import { mensajeError, type RotacionConAsignaciones, type RutaConLinea } from './use-rotaciones';
import { rotacionesApi } from '../../../src/lib/api/rotaciones';

export function NuevaAsignacionModal(props: {
  token: string | null;
  rotacion: RotacionConAsignaciones;
  rutas: RutaConLinea[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { token, rotacion, rutas, vehiculos, conductores, onClose, onGuardado } = props;
  const [vehiculoId, setVehiculoId] = useState(vehiculos[0]?.id ?? '');
  const [rutaId, setRutaId] = useState(rutas[0]?.id ?? '');
  const [conductorId, setConductorId] = useState('');
  const [fecha, setFecha] = useState('');
  const [horario, setHorario] = useState<Turno>('manana');
  const [orden, setOrden] = useState('1');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!token || !vehiculoId || !rutaId || !fecha) return;
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.crearAsignacion(token, rotacion.id, {
        vehiculoId,
        rutaId,
        conductorId: conductorId || undefined,
        fecha: new Date(fecha),
        horario,
        orden: Number(orden),
      });
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Agregar asignación"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !vehiculoId || !rutaId || !fecha}>
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
          label="Vehículo"
          options={vehiculos.map((v) => ({ label: v.placa, value: v.id }))}
          value={vehiculoId}
          onChange={(e) => setVehiculoId(e.target.value)}
        />
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
        <DatePicker label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <Select
          label="Horario"
          options={HORARIOS}
          value={horario}
          onChange={(e) => setHorario(e.target.value as Turno)}
        />
        <Input
          label="Orden"
          type="number"
          value={orden}
          onChange={(e) => setOrden(e.target.value)}
        />
      </div>
    </Modal>
  );
}
