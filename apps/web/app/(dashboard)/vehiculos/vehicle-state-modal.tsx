import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, FormField, Input, Modal, Select } from '@quivo/design-system';
import {
  CambiarEstadoVehiculoSchema,
  type CambiarEstadoVehiculo,
  type EstadoVehiculo,
  type Vehiculo,
} from '@quivo/shared';

export const NOMBRE_ESTADO: Record<EstadoVehiculo, string> = {
  pendiente: 'Pendiente',
  activo: 'Activo',
  inactivo: 'Inactivo',
  suspendido: 'Suspendido',
  mantenimiento: 'Mantenimiento',
};

const TRANSICIONES: Record<EstadoVehiculo, EstadoVehiculo[]> = {
  pendiente: ['activo', 'inactivo'],
  activo: ['inactivo', 'suspendido', 'mantenimiento'],
  inactivo: ['activo'],
  suspendido: ['activo', 'inactivo'],
  mantenimiento: ['activo', 'inactivo'],
};

export function VehicleStateModal({
  vehicle,
  onClose,
  onSave,
}: {
  vehicle: Vehiculo | null;
  onClose: () => void;
  onSave: (data: CambiarEstadoVehiculo) => Promise<void>;
}) {
  const opciones = vehicle ? TRANSICIONES[vehicle.estado] : [];
  const [estado, setEstado] = useState<EstadoVehiculo | ''>('');
  const [motivo, setMotivo] = useState('');
  const [observacion, setObservacion] = useState('');
  const [retornoEstimado, setRetornoEstimado] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!vehicle) return;
    setEstado(TRANSICIONES[vehicle.estado][0] ?? '');
    setMotivo('');
    setObservacion('');
    setRetornoEstimado('');
    setErrors({});
    setFormError(null);
  }, [vehicle]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const parsed = CambiarEstadoVehiculoSchema.safeParse({
      estado,
      motivo: motivo || null,
      observacion: observacion || null,
      retornoEstimado: retornoEstimado ? `${retornoEstimado}T12:00:00.000Z` : null,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setIsSaving(true);
    try {
      await onSave(parsed.data);
    } catch (error: unknown) {
      setFormError(error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={vehicle !== null}
      title="Cambiar estado"
      description={
        vehicle
          ? `${vehicle.placaNormalizada} · Estado actual: ${NOMBRE_ESTADO[vehicle.estado]}`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" form="vehicle-state-form" disabled={isSaving}>
            {isSaving ? 'Guardando...' : 'Confirmar cambio'}
          </Button>
        </>
      }
    >
      {formError && (
        <Alert variant="danger" title="No se pudo cambiar">
          {formError}
        </Alert>
      )}
      <form id="vehicle-state-form" className="vehicle-state-form" onSubmit={submit}>
        <FormField label="Nuevo estado" htmlFor="vehicle-new-state" required error={errors.estado}>
          <Select
            id="vehicle-new-state"
            options={opciones.map((value) => ({ value, label: NOMBRE_ESTADO[value] }))}
            value={estado}
            onChange={(event) => setEstado(event.target.value as EstadoVehiculo)}
            fullWidth
          />
        </FormField>
        {estado !== 'activo' && (
          <FormField label="Motivo" htmlFor="vehicle-state-reason" required error={errors.motivo}>
            <Input
              id="vehicle-state-reason"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              maxLength={200}
              fullWidth
            />
          </FormField>
        )}
        <FormField
          label="Observación"
          htmlFor="vehicle-state-observation"
          error={errors.observacion}
        >
          <Input
            id="vehicle-state-observation"
            value={observacion}
            onChange={(event) => setObservacion(event.target.value)}
            maxLength={500}
            fullWidth
          />
        </FormField>
        {estado === 'mantenimiento' && (
          <FormField
            label="Retorno estimado"
            htmlFor="vehicle-return-date"
            error={errors.retornoEstimado}
          >
            <Input
              id="vehicle-return-date"
              type="date"
              value={retornoEstimado}
              onChange={(event) => setRetornoEstimado(event.target.value)}
              fullWidth
            />
          </FormField>
        )}
        {estado === 'activo' && (
          <Alert variant="info" title="Validación de activación">
            El backend comprobará placa, propietario, tipo, marca, modelo, color y capacidad antes
            de activar.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
