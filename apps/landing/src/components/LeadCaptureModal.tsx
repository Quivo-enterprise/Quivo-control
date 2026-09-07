'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

export function LeadCaptureModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [city, setCity] = useState('');
  const [lineCount, setLineCount] = useState('');
  const [vehicleCount, setVehicleCount] = useState('');
  const [ready, setReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    setReady(false);
    setIsSubmitting(false);
    setSubmitError('');
    setSubmittedMessage('');
    setWhatsappUrl('');
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [isOpen]);

  const message = `Hola QUIVO. Soy ${name.trim()}, de ${line.trim()} en ${city.trim()}. Tenemos ${lineCount} ${Number(lineCount) === 1 ? 'línea' : 'líneas'}${vehicleCount ? ` y aproximadamente ${vehicleCount} vehículos` : ''}. Quiero coordinar una demostración de QUIVO Control.`;
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  const whatsappNumber = (process.env.NEXT_PUBLIC_DEMO_WHATSAPP_NUMBER ?? '59168482323').replace(/\D/g, '');
  const fallbackWhatsAppUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  async function submitDemoRequest(): Promise<void> {
    setIsSubmitting(true);
    setSubmitError('');

    try {
      if (!apiUrl) throw new Error('La API pública aún no está configurada.');

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${apiUrl}/v1/public/demo-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            line,
            city,
            lineCount: Number(lineCount),
            vehicleCount: vehicleCount ? Number(vehicleCount) : undefined,
            website: '',
          }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as
          | { message?: string; whatsappUrl?: string }
          | null;
        if (!response.ok || !result?.whatsappUrl) throw new Error('La API rechazó la solicitud.');
        setSubmittedMessage(result.message ?? message);
        setWhatsappUrl(result.whatsappUrl);
      } finally {
        window.clearTimeout(timeout);
      }
    } catch {
      setSubmittedMessage(message);
      setWhatsappUrl(fallbackWhatsAppUrl);
      setSubmitError('No pudimos registrar la solicitud en este momento. Puedes continuar por WhatsApp y enviaremos tus datos desde allí.');
    } finally {
      setReady(true);
      setIsSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="modal-content demo-dialog" aria-labelledby="demo-title"
      onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar ventana"><X size={20} /></button>
      <h2 id="demo-title">{ready ? (submitError ? 'Puedes continuar por WhatsApp' : 'Solicitud registrada') : 'Solicita una demostración'}</h2>
      {ready ? (
        <div>
          <p>{submitError || 'Guardamos tus datos para que nuestro equipo pueda preparar la demostración. Abre WhatsApp para coordinar el siguiente paso.'}</p>
          <blockquote className="demo-preview">{submittedMessage || message}</blockquote>
          <a className="btn btn-accent" href={whatsappUrl || fallbackWhatsAppUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />Continuar en WhatsApp</a>
          <button className="btn btn-secondary" type="button" onClick={() => setReady(false)}>Editar mensaje</button>
        </div>
      ) : (
        <form onInput={(event) => {
          if (event.target instanceof HTMLInputElement) event.target.setCustomValidity('');
        }} onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          for (const id of ['demo-name', 'demo-line', 'demo-city']) {
            const input = form.elements.namedItem(id) as HTMLInputElement;
            input.setCustomValidity(input.value.trim() ? '' : 'Completa este campo; no uses solo espacios.');
          }
          if (form.reportValidity()) void submitDemoRequest();
        }}>
          <p>Cuéntanos quién eres y qué línea quieres ordenar. Registraremos la solicitud y prepararemos un mensaje para coordinar contigo por WhatsApp.</p>
          <div className="form-group"><label htmlFor="demo-name">Tu nombre</label><input autoComplete="name" id="demo-name" className="form-input" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="¿Cómo te llamas?" /></div>
          <div className="form-group"><label htmlFor="demo-line">Nombre de tu línea</label><input autoComplete="organization" id="demo-line" className="form-input" required maxLength={160} value={line} onChange={(event) => setLine(event.target.value)} placeholder="Ej. Línea 5" /></div>
          <div className="form-group"><label htmlFor="demo-city">Ciudad</label><input autoComplete="address-level2" id="demo-city" className="form-input" required maxLength={100} value={city} onChange={(event) => setCity(event.target.value)} placeholder="Ej. Cochabamba" /></div>
          <div className="form-group"><label htmlFor="demo-lines">Cantidad de líneas</label><input id="demo-lines" className="form-input" type="number" inputMode="numeric" min={1} max={10000} step={1} required value={lineCount} onChange={(event) => setLineCount(event.target.value)} /></div>
          <div className="form-group"><label htmlFor="demo-vehicles">Vehículos aproximados (opcional)</label><input id="demo-vehicles" className="form-input" type="number" inputMode="numeric" min={1} max={100000} step={1} value={vehicleCount} onChange={(event) => setVehicleCount(event.target.value)} /></div>
          <input aria-hidden="true" autoComplete="off" id="demo-website" name="website" tabIndex={-1} type="text" value="" onChange={() => undefined} style={{ display: 'none' }} />
          <button type="submit" className="btn btn-accent" disabled={isSubmitting}>{isSubmitting ? 'Registrando solicitud…' : 'Solicitar mi demostración'}</button>
          <p className="photo-credit">También puedes escribir directamente a <a href="mailto:negocios@myquivo.com">negocios@myquivo.com</a>.</p>
        </form>
      )}
    </dialog>
  );
}
