'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { HeroSection } from '@/components/HeroSection';
import { FeaturesBento } from '@/components/FeaturesBento';
import { FleetPanelPreview } from '@/components/FleetPanelPreview';
import { HowItWorks } from '@/components/HowItWorks';
import { FaqSection } from '@/components/FaqSection';
import { CtaSection } from '@/components/CtaSection';
import { Footer } from '@/components/Footer';
import { LeadCaptureModal } from '@/components/LeadCaptureModal';

export default function LandingPage() {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);

  const handleOpenDemoModal = () => {
    setIsDemoModalOpen(true);
  };

  const handleCloseDemoModal = () => {
    setIsDemoModalOpen(false);
  };

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      <a href="#contenido" className="skip-link">Ir al contenido</a>
      {/* Fondos atmosféricos y rejilla de alta tecnología */}

      {/* Navegación Superior */}
      <Navbar onOpenDemoModal={handleOpenDemoModal} />
      <main id="contenido" tabIndex={-1}>

      {/* Hero Principal con Consola en Vivo */}
      <HeroSection onOpenDemoModal={handleOpenDemoModal} />

      <HowItWorks />

      {/* Bento Grid de Características Clave */}
      <FeaturesBento />

      <FleetPanelPreview onOpenDemoModal={handleOpenDemoModal} />

      {/* Preguntas Frecuentes */}
      <FaqSection />

      {/* Sección Final de Llamado a la Acción */}
      <CtaSection onOpenDemoModal={handleOpenDemoModal} />
      </main>

      {/* Pie de Página */}
      <Footer onOpenDemoModal={handleOpenDemoModal} />

      {/* Modal de Captura de Prospectos / Solicitud de Piloto */}
      <LeadCaptureModal
        isOpen={isDemoModalOpen}
        onClose={handleCloseDemoModal}
      />
    </div>
  );
}
