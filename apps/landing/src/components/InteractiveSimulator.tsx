'use client';

import React, { useState } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Zap,
  Check,
  Radio,
} from 'lucide-react';

interface Checkpoint {
  id: number;
  name: string;
  programmedTime: string;
  geoRadius: string;
}

const CHECKPOINTS: Checkpoint[] = [
  { id: 1, name: 'Parada inicial (Obelisco)', programmedTime: '08:00:00', geoRadius: '150 m' },
  { id: 2, name: 'Cruce Villa (Av. Busch)', programmedTime: '08:14:00', geoRadius: '120 m' },
  { id: 3, name: 'Curva de control (Tranca)', programmedTime: '08:28:00', geoRadius: '150 m' },
  { id: 4, name: 'Terminal Sur (Llegada)', programmedTime: '08:42:00', geoRadius: '180 m' },
];

export function InteractiveSimulator() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [timingMode, setTimingMode] = useState<'on_time' | 'late' | 'early' | 'skipped'>('on_time');
  const [eventsLog, setEventsLog] = useState<
    Array<{
      step: number;
      pointName: string;
      realTime: string;
      diff: string;
      status: 'success' | 'warning' | 'danger';
      penalty: string;
    }>
  >([
    {
      step: 1,
      pointName: 'Parada inicial (Obelisco)',
      realTime: '08:00:04',
      diff: '+4 seg (A tiempo)',
      status: 'success',
      penalty: 'Paso registrado correctamente',
    },
  ]);

  const handleNextCheckpoint = () => {
    if (currentStep >= CHECKPOINTS.length) return;

    const nextStep = currentStep + 1;
    const targetPoint = CHECKPOINTS[nextStep - 1]!;

    let realTime = targetPoint.programmedTime;
    let diff = '0 min';
    let status: 'success' | 'warning' | 'danger' = 'success';
    let penalty = 'Paso registrado';

    if (timingMode === 'on_time') {
      realTime = targetPoint.programmedTime;
      diff = 'A tiempo (0 seg)';
      status = 'success';
      penalty = 'A tiempo: todo bien';
    } else if (timingMode === 'late') {
      const [h, m, s] = targetPoint.programmedTime.split(':').map(Number);
      const newM = (m! + 4).toString().padStart(2, '0');
      realTime = `${String(h).padStart(2, '0')}:${newM}:${String(s).padStart(2, '0')}`;
      diff = '+4 minutos (Retraso)';
      status = 'warning';
      penalty = 'Llegó tarde: se aplica la regla de la línea';
    } else if (timingMode === 'early') {
      const [h, m, s] = targetPoint.programmedTime.split(':').map(Number);
      const newM = Math.max(0, m! - 3).toString().padStart(2, '0');
      realTime = `${String(h).padStart(2, '0')}:${newM}:${String(s).padStart(2, '0')}`;
      diff = '-3 minutos (Llegó antes)';
      status = 'warning';
      penalty = 'Llegó antes: revisa la regla de la línea';
    } else if (timingMode === 'skipped') {
      realTime = 'NO REGISTRADO';
      diff = 'No pasó por el punto';
      status = 'danger';
      penalty = 'La directiva recibe un aviso para revisarlo';
    }

    setCurrentStep(nextStep);
    setEventsLog((prev) => [
      ...prev,
      {
        step: nextStep,
        pointName: targetPoint.name,
        realTime,
        diff,
        status,
        penalty,
      },
    ]);
  };

  const handleReset = () => {
    setCurrentStep(1);
    setEventsLog([
      {
        step: 1,
        pointName: 'Parada inicial (Obelisco)',
        realTime: '08:00:04',
        diff: '+4 seg (A tiempo)',
        status: 'success',
        penalty: 'Paso registrado correctamente',
      },
    ]);
  };

  const progressPercent = ((currentStep - 1) / (CHECKPOINTS.length - 1)) * 100;

  return (
    <section className="section" id="simulador">
      <div className="container">
        <div className="section-header">
          <span className="badge badge-glow-primary">
            <Zap size={14} />
            Mira cómo funciona
          </span>
          <h2>
            Un recorrido queda registrado{' '}
            <span className="gradient-text-accent">paso a paso</span>
          </h2>
          <p>
            Avanza el vehículo y mira qué puede ver la directiva: dónde pasó, a qué hora llegó y
            si necesita atención. Este ejemplo usa datos ficticios.
          </p>
        </div>

        <div className="simulator-card">
          {/* Barra superior de controles del simulador */}
          <div className="sim-controls-bar">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="pulse-indicator" />
                <span style={{ fontFamily: 'var(--qv-font-display)', fontWeight: 700, fontSize: '1.1rem' }}>
                  Vehículo: 1111AAA • Minibús
                </span>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '4px' }}>
                Línea 120 • Turno de mañana • Conductor: Juan Condori
              </div>
            </div>

            {/* Selector de comportamiento / Timing */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Qué quieres simular:</span>
              <button
                type="button"
                onClick={() => setTimingMode('on_time')}
                className={`btn btn-sm ${timingMode === 'on_time' ? 'btn-primary' : 'btn-secondary'}`}
              >
                A tiempo
              </button>
              <button
                type="button"
                onClick={() => setTimingMode('late')}
                className={`btn btn-sm ${timingMode === 'late' ? 'btn-accent' : 'btn-secondary'}`}
              >
                4 minutos tarde
              </button>
              <button
                type="button"
                onClick={() => setTimingMode('skipped')}
                className={`btn btn-sm ${timingMode === 'skipped' ? 'btn-primary' : 'btn-secondary'}`}
                style={timingMode === 'skipped' ? { background: 'var(--status-danger)', borderColor: 'var(--status-danger)' } : {}}
              >
                No pasó por el punto
              </button>
            </div>

            {/* Botones de acción */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={handleNextCheckpoint}
                disabled={currentStep >= CHECKPOINTS.length}
                className="btn btn-accent btn-sm"
                style={{ opacity: currentStep >= CHECKPOINTS.length ? 0.5 : 1 }}
              >
                <Play size={16} />
                <span>Registrar siguiente punto</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="btn btn-secondary btn-sm"
                title="Reiniciar simulador"
                aria-label="Reiniciar simulador"
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          {/* Línea de tiempo interactiva de la ruta */}
          <div className="sim-timeline">
            <div className="sim-timeline-track" />
            <div className="sim-timeline-progress" style={{ width: `${progressPercent}%` }} />

            {CHECKPOINTS.map((cp) => {
              const isCompleted = cp.id < currentStep;
              const isActive = cp.id === currentStep;

              return (
                <div
                  key={cp.id}
                  className={`sim-step-point ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                >
                  <div className="sim-point-circle">
                    {isCompleted ? <Check size={18} /> : cp.id}
                  </div>
                  <div className="sim-point-label">
                    <div>{cp.name.split(' (')[0]}</div>
                    <div className="sim-point-time">Prog: {cp.programmedTime}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Resumen sencillo del punto actual */}
          <div className="sim-output-grid">
            <div className="sim-stat-card">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Punto actual
              </div>
              <div style={{ fontFamily: 'var(--qv-font-display)', fontSize: '1.1rem', fontWeight: 700, marginTop: '4px' }}>
                {CHECKPOINTS[currentStep - 1]?.name}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--status-success)', marginTop: '2px' }}>
                Zona de registro: {CHECKPOINTS[currentStep - 1]?.geoRadius}
              </div>
            </div>

            <div className="sim-stat-card">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Hora registrada
              </div>
              <div style={{ fontFamily: 'var(--qv-font-display)', fontSize: '1.25rem', fontWeight: 800, color: 'var(--brand-accent)', marginTop: '4px' }}>
                {eventsLog[eventsLog.length - 1]?.realTime}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {eventsLog[eventsLog.length - 1]?.diff}
              </div>
            </div>

            <div className="sim-stat-card">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Resultado del paso
              </div>
              <div
                style={{
                  fontFamily: 'var(--qv-font-display)',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  marginTop: '4px',
                  color:
                    eventsLog[eventsLog.length - 1]?.status === 'danger'
                      ? 'var(--status-danger)'
                      : eventsLog[eventsLog.length - 1]?.status === 'warning'
                      ? 'var(--brand-accent)'
                      : 'var(--status-success)',
                }}
              >
                {eventsLog[eventsLog.length - 1]?.penalty}
              </div>
            </div>

            <div className="sim-stat-card">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Conexión
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                <Radio size={16} color="var(--status-success)" />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>GPS del celular activo</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '2px' }}>
                Se guarda aunque no haya internet
              </div>
            </div>
          </div>

          {/* Historial de marcaciones registradas */}
          <div style={{ marginTop: '32px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px' }}>
              REGISTRO DEL RECORRIDO:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {eventsLog.map((ev, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-overlay)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {ev.status === 'success' ? (
                      <CheckCircle2 size={16} color="var(--status-success)" />
                    ) : ev.status === 'warning' ? (
                      <Clock size={16} color="var(--brand-accent)" />
                    ) : (
                      <ShieldAlert size={16} color="var(--status-danger)" />
                    )}
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{ev.pointName}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--qv-font-display)' }}>
                      {ev.realTime}
                    </span>
                    <span
                      className={`badge ${
                        ev.status === 'success'
                          ? 'badge-success'
                          : ev.status === 'warning'
                          ? 'badge-glow-amber'
                          : 'badge-danger'
                      }`}
                      style={{ fontSize: '0.72rem' }}
                    >
                      {ev.diff}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
