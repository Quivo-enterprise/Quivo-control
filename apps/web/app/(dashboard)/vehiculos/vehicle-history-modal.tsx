import { Alert, Button, Loader, Modal } from '@quivo/design-system';
import type { HistorialEstadoVehiculo, Vehiculo } from '@quivo/shared';
import { NOMBRE_ESTADO } from './vehicle-state-modal';

export function VehicleHistoryModal({
  vehicle,
  rows,
  isLoading,
  error,
  onClose,
}: {
  vehicle: Vehiculo | null;
  rows: HistorialEstadoVehiculo[];
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={vehicle !== null}
      title="Historial de estados"
      description={vehicle ? `Trazabilidad de ${vehicle.placaNormalizada}` : undefined}
      onClose={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      {error && (
        <Alert variant="danger" title="No se pudo cargar">
          {error}
        </Alert>
      )}
      {isLoading ? (
        <Loader label="Cargando historial..." />
      ) : rows.length === 0 && !error ? (
        <p className="vehicle-history-empty">Este vehículo todavía no tiene cambios registrados.</p>
      ) : (
        <ol className="vehicle-history">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="vehicle-history__marker" aria-hidden="true" />
              <div>
                <strong>
                  {row.estadoDesde ? `${NOMBRE_ESTADO[row.estadoDesde]} → ` : ''}
                  {NOMBRE_ESTADO[row.estadoHasta]}
                </strong>
                <time dateTime={row.createdAt}>
                  {new Intl.DateTimeFormat('es-BO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(row.createdAt))}
                </time>
                {row.motivo && <p>{row.motivo}</p>}
                {row.observacion && <p>Observación: {row.observacion}</p>}
                {row.retornoEstimado && (
                  <p>
                    Retorno estimado:{' '}
                    <time dateTime={row.retornoEstimado}>
                      {new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium' }).format(
                        new Date(row.retornoEstimado),
                      )}
                    </time>
                  </p>
                )}
                <small>
                  Responsable: {row.actorId} · Origen: {row.origen}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
