'use client';

import React from 'react';
import { Quote, Star } from 'lucide-react';

const TESTIMONIALS = [
  {
    name: 'Don Fausto Quispe',
    role: 'Secretario de sindicato',
    city: 'La Paz - El Alto',
    quote:
      'Antes había dudas sobre cada recorrido. Ahora todos vemos el mismo registro y es mucho más fácil conversar.',
    metric: 'Menos reclamos',
  },
  {
    name: 'Ramiro Vargas',
    role: 'Fiscal de ruta',
    city: 'Cochabamba',
    quote:
      'Ahora puedo ver si un vehículo llegó a cada punto de la ruta. Eso nos ayuda a ordenar el trabajo y a detectar un problema a tiempo.',
    metric: 'Recorridos visibles',
  },
  {
    name: 'Javier Mamani',
    role: 'Conductor de minibús',
    city: 'La Paz',
    quote:
      'Pensé que iba a ser complicado. Inicio mi turno, guardo el teléfono y la app registra el recorrido. Si no hay señal, lo guarda y listo.',
    metric: 'Funciona sin señal',
  },
];

export function Testimonials() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-header">
          <span className="badge badge-glow-amber">
            <Quote size={14} />
            Lo que dicen quienes trabajan en transporte
          </span>
          <h2>
            Una forma más simple de{' '}
            <span className="gradient-text-accent">trabajar juntos</span>
          </h2>
          <p>
            Directivas, fiscales y conductores que ahora tienen la misma información sobre cada
            recorrido.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '24px',
          }}
        >
          {TESTIMONIALS.map((item, index) => (
            <div key={index} className="glass-card" style={{ padding: '36px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={16} fill="#fd9e15" color="#fd9e15" />
                  ))}
                </div>

                <p style={{ color: 'var(--text-muted)', fontSize: '1rem', fontStyle: 'italic', lineHeight: 1.65, marginBottom: '24px' }}>
                  "{item.quote}"
                </p>
              </div>

              <div>
                <div
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(253, 158, 21, 0.1)',
                    border: '1px solid rgba(253, 158, 21, 0.25)',
                    color: 'var(--brand-accent)',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    marginBottom: '16px',
                    display: 'inline-block',
                  }}
                >
                  ✓ {item.metric}
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                  <div style={{ fontFamily: 'var(--qv-font-display)', fontWeight: 700, color: 'var(--text-main)', fontSize: '1.05rem' }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {item.role} • {item.city}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
