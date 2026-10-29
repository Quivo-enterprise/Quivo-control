import { useState } from 'react';
import { Alert, Button, DatePicker, Input, Modal, Select } from '@quivo/design-system';
import {
  ETIQUETA_PARADA_SALIDA,
  detalleInfraccion,
  etiquetaTipoInfraccion,
  fechaActualBolivia,
  rangoCumplimiento,
  reglaInicialSancion,
  type Infraccion,
  type ParadaSalida,
  type Regla,
  type Turno,
} from '@quivo/shared';
import { infraccionesApi } from '../../../src/lib/api/infracciones';
import { mensajeError } from './map-builders';
import { fechaDesdeDiaLocal } from '../../../src/lib/fecha-local';
import { reglasSancionables } from '../../../src/lib/en-vivo/alertas';
import { HORARIOS } from '../rotaciones/rotacion-constants';

const TURNOS = HORARIOS.map((h) => (h.value === 'noche' ? { ...h, label: 'Noche (desde las 17:00)' } : h));
const PARADAS = (Object.entries(ETIQUETA_PARADA_SALIDA) as [ParadaSalida, string][]).map(([value, label]) => ({ label, value }));

/**
 * "Sancionar" una infracción = agendar una sanción compensatoria. El hecho (regla, chofer, motivo,
 * fecha y evidencia) es de solo lectura: lo fija el servidor desde la infracción; acá solo se elige
 * cuándo y cómo se cumple.
 */
export function ModalSancionar(props: {
  token: string | null;
  inf: Infraccion;
  /** Reglas de todos los sindicatos que ve el usuario: se filtran a las activas del de la infracción. */
  reglas: Regla[];
  placa: string;
  conductor: string;
  /** IDs de los PC en el orden del panel (numeración "PC N"). */
  idsPc: readonly string[];
  onClose: () => void;
  onCreada: () => void;
}) {
  const { token, inf, reglas, placa, conductor, idsPc, onClose, onCreada } = props;
  const reglasActivas = reglasSancionables(reglas, inf.sindicatoId);
  const regla = reglasActivas.find((r) => r.id === reglaInicialSancion(inf, reglasActivas));
  const { min, max } = rangoCumplimiento(fechaActualBolivia().toISOString().slice(0, 10));
  const [dia, setDia] = useState(min);
  const [vueltas, setVueltas] = useState('1');
  const [turno, setTurno] = useState<Turno>('noche');
  const [parada, setParada] = useState<ParadaSalida>('salomon_romero');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Medianoche UTC del día elegido: el JSON no depende de la zona del navegador (el servidor toma el día en UTC).
  const fechaCumplimiento = fechaDesdeDiaLocal(dia) ? new Date(`${dia}T00:00:00Z`) : null;
  const nVueltas = Number(vueltas);
  const valido =
    Boolean(regla) && fechaCumplimiento !== null && dia >= min && dia <= max && Number.isInteger(nVueltas) && nVueltas >= 1 && nVueltas <= 10;

  async function sancionar() {
    if (!token || !valido || !fechaCumplimiento) return;
    setGuardando(true);
    setError(null);
    try {
      await infraccionesApi.sancionar(token, inf.id, { fechaCumplimiento, vueltas: nVueltas, turno, paradaSalida: parada });
      onCreada();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const hecho = inf.inicioTs.toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short', hour12: false });
  return (
    <Modal
      open
      title="Sancionar"
      description="Se agenda una sanción compensatoria; el hecho no se puede modificar."
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={sancionar} disabled={guardando || !valido}>
            {guardando ? 'Guardando...' : 'Sancionar'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {error && (
          <Alert variant="danger" title="No se pudo sancionar">
            {error}
          </Alert>
        )}
        {!regla && (
          <Alert variant="warning" title="Sin regla">
            No hay una regla activa para este tipo de infracción; no se puede sancionar.
          </Alert>
        )}
        <dl style={{ margin: 0, display: 'grid', gap: '0.25rem', fontSize: '0.875rem' }}>
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Regla: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{regla?.nombre ?? etiquetaTipoInfraccion(inf.tipo)}</dd>
          </div>
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Chofer: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{[conductor, placa].filter(Boolean).join(' · ')}</dd>
          </div>
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Hecho: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{hecho}</dd>
          </div>
          <div>
            <dt style={{ display: 'inline', fontWeight: 600 }}>Detalle: </dt>
            <dd style={{ display: 'inline', margin: 0 }}>{detalleInfraccion(inf, idsPc)}</dd>
          </div>
        </dl>
        <DatePicker
          label="Día de cumplimiento"
          value={dia}
          min={min}
          max={max}
          required
          onChange={(e) => setDia(e.target.value)}
        />
        <Input
          label="Vueltas"
          type="number"
          min={1}
          max={10}
          step={1}
          required
          value={vueltas}
          onChange={(e) => setVueltas(e.target.value)}
        />
        <Select label="Turno" options={TURNOS} value={turno} onChange={(e) => setTurno(e.target.value as Turno)} />
        <Select
          label="Parada de salida"
          options={PARADAS}
          value={parada}
          onChange={(e) => setParada(e.target.value as ParadaSalida)}
        />
      </div>
    </Modal>
  );
}
