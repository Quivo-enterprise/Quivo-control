import { describe, expect, it } from 'vitest';
import {
  buildDemoRequestMessage,
  buildDemoRequestWhatsAppUrl,
} from './demo-requests.service.js';

describe('demo request message', () => {
  it('genera un mensaje legible con singular y espacios normalizados', () => {
    const message = buildDemoRequestMessage({
      name: '  Ana   Pérez ',
      line: 'Línea 120',
      city: 'Cochabamba',
      lineCount: 1,
      website: '',
    });

    expect(message).toBe(
      'Hola QUIVO. Soy Ana Pérez, de Línea 120 en Cochabamba. Tenemos 1 línea. Quiero coordinar una demostración de QUIVO Control.',
    );
  });

  it('codifica el mensaje para WhatsApp', () => {
    const url = buildDemoRequestWhatsAppUrl('Hola QUIVO');
    expect(url).toBe('https://wa.me/59168482323?text=Hola%20QUIVO');
  });
});
