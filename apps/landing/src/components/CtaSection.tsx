'use client';

import { ArrowRight } from 'lucide-react';

export function CtaSection({ onOpenDemoModal }: { onOpenDemoModal: () => void }) {
  return <section className="section"><div className="container"><div className="cta-panel simple-cta"><h2>¿Lo vemos con tu ruta?</h2><p>Escríbenos para coordinar una demostración.</p><button className="btn btn-accent btn-lg" type="button" onClick={onOpenDemoModal}>Quiero una demostración<ArrowRight size={18} aria-hidden="true" /></button></div></div></section>;
}
