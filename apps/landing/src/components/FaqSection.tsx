'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  { question: '¿Qué necesito para empezar?', answer: 'Un celular Android por conductor. Te ayudamos a configurar las rutas y los puntos de control.' },
  { question: '¿Y si no hay internet?', answer: 'El celular guarda el registro. Cuando vuelve la conexión, lo envía al panel.' },
  { question: '¿Quién decide los turnos y las reglas?', answer: 'Tu organización. QUIVO ayuda a ordenar y consultar la información.' },
  { question: '¿Cuánto cuesta?', answer: 'Depende de los vehículos y las necesidades de tu línea. Te damos una propuesta antes de contratar.' },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="section-header">
          <h2>
            Preguntas frecuentes
          </h2>

        </div>

        <div className="faq-list">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={index} className={`faq-item ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="faq-question"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${index}`}
                  id={`faq-question-${index}`}
                >
                  <span>{faq.question}</span>
                  <ChevronDown
                    size={20}
                    style={{
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.25s ease',
                      flexShrink: 0,
                      color: isOpen ? 'var(--brand-accent)' : 'var(--text-muted)',
                    }}
                  />
                </button>

                <div hidden={!isOpen} id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} className="faq-answer">{faq.answer}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
