'use client';

import Image from 'next/image';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';

export function HeroSection({ onOpenDemoModal }: { onOpenDemoModal: () => void }) {
  return (
    <section className="hero-section hero-simple" id="solucion">
      <div className="container">
        <div className="hero-grid hero-120-grid">
          <div className="hero-content">
            <h1 className="hero-title">Controla tus trufis,<br /><span className="gradient-text-accent">en tiempo real.</span></h1>
            <p className="hero-120-lead">QUIVO Control reúne ubicación, recorridos y estado de cada vehículo en un solo panel.</p>
            <button className="btn btn-accent btn-lg" onClick={onOpenDemoModal} type="button">Quiero una demostración<ArrowRight size={18} aria-hidden="true" /></button>
            <div className="hero-120-proof"><span><CheckCircle2 size={15} />Trufis en vivo</span><span><CheckCircle2 size={15} />Una vista para toda tu operación</span></div>
          </div>
          <figure className="hero-120-visual">
            <div className="hero-120-photo-grid hero-120-photo-grid--line120 hero-120-photo-grid--photo-only">
              <Image src="/brand/vehicles/cochabamba/linea-120-tiquipaya.webp" alt="Foto de demostración de un trufi de la Línea 120" width={1280} height={720} priority unoptimized />
            </div>
            <figcaption><span><Circle size={9} fill="currentColor" />Caso visual de QUIVO Control</span><small>Línea 120 · Cochabamba</small></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
