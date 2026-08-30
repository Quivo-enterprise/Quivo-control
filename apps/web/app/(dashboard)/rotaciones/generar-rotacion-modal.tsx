import { useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Input, Modal } from '@quivo/design-system';
import type { Turno } from '@quivo/shared';
import { Clock, Moon, Route, Sparkles, Sun, Sunrise } from 'lucide-react';
import { HORARIOS } from './rotacion-constants';
import type { RutaConLinea } from './use-rotaciones';

interface GenerarRotacionModalProps {
  open: boolean;
  onClose: () => void;
  rutas: RutaConLinea[];
  generando: boolean;
  onGenerar: (params: {
    periodo: string;
    fechaInicio: string;
    fechaFin: string;
    horarios: Turno[];
    rutasSeleccionadas: string[];
  }) => Promise<void>;
}

export function GenerarRotacionModal({
  open,
  onClose,
  rutas,
  generando,
  onGenerar,
}: GenerarRotacionModalProps) {
  const [periodo, setPeriodo] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [horariosSeleccionados, setHorariosSeleccionados] = useState<Turno[]>([
    'manana',
    'tarde',
  ]);
  const [rutasSeleccionadas, setRutasSeleccionadas] = useState<string[]>(
    rutas.map((r) => r.id),
  );

  const rangoFechasInvalido = Boolean(fechaInicio && fechaFin && fechaFin < fechaInicio);
  const formularioInvalido =
    !periodo.trim() ||
    !fechaInicio ||
    !fechaFin ||
    rangoFechasInvalido ||
    rutasSeleccionadas.length === 0 ||
    horariosSeleccionados.length === 0;

  const toggleHorario = (horario: Turno) => {
    setHorariosSeleccionados((prev) =>
      prev.includes(horario) ? prev.filter((h) => h !== horario) : [...prev, horario],
    );
  };

  const toggleRuta = (rutaId: string) => {
    setRutasSeleccionadas((prev) =>
      prev.includes(rutaId) ? prev.filter((r) => r !== rutaId) : [...prev, rutaId],
    );
  };

  const toggleTodasRutas = () => {
    if (rutasSeleccionadas.length === rutas.length) {
      setRutasSeleccionadas([]);
    } else {
      setRutasSeleccionadas(rutas.map((r) => r.id));
    }
  };

  const handleGenerar = async () => {
    if (formularioInvalido) return;
    await onGenerar({
      periodo: periodo.trim(),
      fechaInicio,
      fechaFin,
      horarios: horariosSeleccionados,
      rutasSeleccionadas,
    });
  };

  return (
    <Modal
      open={open}
      title="Generar Nueva Rotación de Turnos"
      description="El sistema distribuirá automáticamente la flota entre las fechas, turnos y recorridos seleccionados de forma equitativa (Round-Robin)."
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.625rem', justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="ghost" onClick={onClose} disabled={generando}>
            Cancelar
          </Button>
          <Button onClick={handleGenerar} disabled={formularioInvalido || generando}>
            <Sparkles size={15} style={{ marginRight: '6px' }} />
            {generando ? 'Generando asignaciones...' : 'Generar borrador'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {rangoFechasInvalido && (
          <Alert variant="warning" title="Rango de fechas inválido">
            La fecha de finalización debe ser igual o posterior a la fecha de inicio.
          </Alert>
        )}

        <div>
          <Input
            label="Identificador del Período"
            placeholder="Ej.: 2026-09 o Semana 36"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            helperText="Nombre o código con el que se identificará este cronograma."
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <DatePicker
            label="Fecha de Inicio"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
          <DatePicker
            label="Fecha de Fin"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
          />
        </div>

        <div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--qv-text-primary)',
              marginBottom: '0.4rem',
            }}
          >
            <Clock size={14} style={{ color: 'var(--qv-color-primary)' }} />
            <span>Turnos Operativos Habilitados</span>
          </label>
          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            {HORARIOS.map((h) => {
              const selected = horariosSeleccionados.includes(h.value);
              const ShiftIcon =
                h.value === 'manana' ? Sunrise : h.value === 'tarde' ? Sun : Moon;
              return (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => toggleHorario(h.value)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.4rem 0.85rem',
                    borderRadius: 'var(--qv-radius-full)',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    border: selected ? '1px solid var(--qv-color-primary)' : '1px solid var(--qv-border-glass)',
                    backgroundColor: selected
                      ? 'color-mix(in srgb, var(--qv-color-primary) 15%, var(--qv-surface-card))'
                      : 'var(--qv-surface-card)',
                    color: selected ? 'var(--qv-color-primary)' : 'var(--qv-text-secondary)',
                    cursor: 'pointer',
                    transition: 'all var(--qv-transition-fast)',
                  }}
                >
                  <ShiftIcon size={14} style={{ color: selected ? 'var(--qv-color-primary)' : 'var(--qv-text-muted)' }} />
                  <span>{h.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.4rem',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--qv-text-primary)',
              }}
            >
              <Route size={14} style={{ color: 'var(--qv-color-primary)' }} />
              <span>Rutas a Cubrir ({rutasSeleccionadas.length}/{rutas.length})</span>
            </label>
            <Button size="sm" variant="ghost" onClick={toggleTodasRutas}>
              {rutasSeleccionadas.length === rutas.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
            </Button>
          </div>

          {rutas.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--qv-text-muted)' }}>
              No hay rutas registradas en este sindicato. Crea rutas antes de generar la rotación.
            </p>
          ) : (
            <div
              style={{
                maxHeight: '10rem',
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))',
                gap: '0.5rem',
                padding: '0.5rem',
                borderRadius: 'var(--qv-radius-md)',
                backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                border: '1px solid var(--qv-border-glass)',
              }}
            >
              {rutas.map((r) => (
                <Checkbox
                  key={r.id}
                  label={`${r.linea.codigo} — ${r.sentido.toUpperCase()}`}
                  checked={rutasSeleccionadas.includes(r.id)}
                  onChange={() => toggleRuta(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
