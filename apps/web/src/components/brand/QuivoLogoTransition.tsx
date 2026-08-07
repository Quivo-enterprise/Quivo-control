'use client';

import React, { useImperativeHandle, useRef, forwardRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

// Registrar plugin (obligatorio para React en GSAP 3.12+)
gsap.registerPlugin(useGSAP);

export type QuivoLogoTransitionProps = {
  autoplay?: boolean;
  loop?: boolean;
  delay?: number;
  className?: string;
  onComplete?: () => void;
};

export type QuivoLogoTransitionRef = {
  play: () => void;
  pause: () => void;
  restart: () => void;
  reverse: () => void;
};

// Paths oficiales extraídos de la fuente/logo original.
const PATH_Q = "M162,53 L29,187 L29,698 L162,832 L449,833 L607,988 L723,871 L625,769 L693,699 L693,186 L560,53 Z M257,217 L466,217 L507,257 L507,627 L467,667 L255,667 L215,626 L215,258 Z";
const PATH_U = "M778,53 L778,695 L917,832 L1283,831 L1420,694 L1420,53 L1235,53 L1235,625 L1190,668 L1003,667 L964,628 L963,53 Z";
const PATH_I = "M1507,52 L1504,830 L1689,832 L1690,54 Z";
const PATH_V = "M1758,52 L2032,830 L2202,832 L2479,53 L2287,53 L2117,572 L1950,55 Z";
const PATH_O = "M2623,53 L2490,186 L2490,699 L2623,832 L3022,831 L3154,699 L3154,186 L3021,53 Z M2717,217 L2926,217 L2968,259 L2968,627 L2928,667 L2719,668 L2676,627 L2675,260 Z";

const QuivoLogoTransition = forwardRef<QuivoLogoTransitionRef, QuivoLogoTransitionProps>(
  ({ autoplay = true, loop = false, delay = 0, className = '', onComplete }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<gsap.core.Timeline | null>(null);
    
    // Estado para accesibilidad
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mediaQuery.matches);
      
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }, []);

    useGSAP(
      () => {
        // Aseguramos de no duplicar la timeline
        if (timelineRef.current) timelineRef.current.kill();

        const tl = gsap.timeline({
          paused: !autoplay,
          repeat: loop ? -1 : 0,
          delay: delay,
          onComplete: () => {
            if (onComplete) onComplete();
          },
        });
        
        timelineRef.current = tl;

        if (reducedMotion) {
          // --- VERSIÓN ACCESIBLE (Movimiento reducido) ---
          // Simplemente aparece el logo completo, y luego hace un crossfade simple.
          tl.set('.quivo-svg', { opacity: 0 })
            .to('.quivo-svg', { opacity: 1, duration: 0.3 })
            .to(['.letter-u', '.letter-i', '.letter-v'], {
              opacity: 0,
              duration: 0.3,
              delay: 0.3,
            })
            // En movimiento reducido, simplemente las movemos sin blur ni efectos extraños
            .to('.letter-q', { x: 877, duration: 0.4 }, '<')
            .to('.letter-o', { x: -883, duration: 0.4 }, '<');
            
          return;
        }

        // --- VERSIÓN MOTION DESIGN COMPLETA ---

        // ESTADO INICIAL CERO
        gsap.set('.quivo-svg', { opacity: 0, scale: 0.96, y: 10 });
        gsap.set(['.letter-u', '.letter-i', '.letter-v'], { transformOrigin: '50% 50%' });
        gsap.set('.qo-group', { transformOrigin: '50% 50%' });

        // FASE 1: APARICIÓN (0.00s a 0.45s)
        tl.to('.quivo-svg', {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.45,
          ease: 'power2.out',
        }, 0);

        // FASE 2: PAUSA (0.45s a 0.85s) - Implícito en la línea de tiempo.

        // FASE 3: RETIRO U, I, V (Inicia en 0.85s, duración ~0.4s por letra)
        const retireTime = 0.85;
        
        // I desaparece primero
        tl.to('.letter-i', {
          opacity: 0,
          scale: 0.84,
          filter: 'blur(3px)',
          y: 5,
          duration: 0.35,
          ease: 'power2.in',
        }, retireTime);

        // U desaparece 50ms después
        tl.to('.letter-u', {
          opacity: 0,
          scale: 0.84,
          filter: 'blur(3px)',
          x: 6, // se mueve un poco al centro
          y: 4,
          duration: 0.35,
          ease: 'power2.in',
        }, retireTime + 0.05);

        // V desaparece 100ms después
        tl.to('.letter-v', {
          opacity: 0,
          scale: 0.84,
          filter: 'blur(3px)',
          x: -6, // se mueve un poco al centro
          y: 4,
          duration: 0.35,
          ease: 'power2.in',
        }, retireTime + 0.1);

        // FASE 4: CONVERGENCIA Q y O (Inicia en 1.00s)
        const convergenceTime = 1.00;
        
        // La Q viaja a la derecha (x=877 calculado según viewBox para simetría)
        tl.to('.letter-q', {
          x: 877,
          duration: 0.75,
          ease: 'power3.inOut',
        }, convergenceTime);

        // La O viaja a la izquierda (inicia 30ms después por naturalidad)
        tl.to('.letter-o', {
          x: -883,
          duration: 0.72,
          ease: 'power3.inOut',
        }, convergenceTime + 0.03);

        // FASE 5: AJUSTE Y ENSAMBLE FINAL (Overshoot en 1.70s)
        // Escalamos el grupo contenedor de Q y O
        const overshootTime = 1.70;
        tl.to('.qo-group', {
          scale: 1.025,
          y: -1.5,
          duration: 0.15,
          ease: 'power2.out',
        }, overshootTime)
        .to('.qo-group', {
          scale: 1,
          y: 0,
          duration: 0.20,
          ease: 'back.out(1.3)',
        }, overshootTime + 0.15);

      },
      { scope: containerRef, dependencies: [reducedMotion, autoplay, loop, delay] }
    );

    // API imperativa
    useImperativeHandle(ref, () => ({
      play: () => timelineRef.current?.play(),
      pause: () => timelineRef.current?.pause(),
      restart: () => timelineRef.current?.restart(),
      reverse: () => timelineRef.current?.reverse(),
    }));

    return (
      <div 
        ref={containerRef} 
        className={`relative flex items-center justify-center w-full max-w-[640px] mx-auto ${className}`}
      >
        <svg
          className="quivo-svg w-full h-auto text-[var(--quivo-orange,#FF9900)] will-change-transform"
          viewBox="0 0 3179 1013"
          fill="currentColor"
          role="img"
          aria-label="QUIVO"
        >
          <title>QUIVO</title>
          <g id="quivo-logo-stage">
            {/* Letras que desaparecen */}
            <g className="letter-u">
              <path d={PATH_U} />
            </g>
            <g className="letter-i">
              <path d={PATH_I} />
            </g>
            <g className="letter-v">
              <path d={PATH_V} />
            </g>

            {/* Grupo final QO que recibe el overshoot final */}
            <g className="qo-group">
              <g className="letter-q">
                <path fillRule="evenodd" d={PATH_Q} />
              </g>
              <g className="letter-o">
                <path fillRule="evenodd" d={PATH_O} />
              </g>
            </g>
          </g>
        </svg>
      </div>
    );
  }
);

QuivoLogoTransition.displayName = 'QuivoLogoTransition';

export default QuivoLogoTransition;
