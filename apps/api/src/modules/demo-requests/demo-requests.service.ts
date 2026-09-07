import { randomUUID } from 'node:crypto';
import { prisma } from '@quivo/db';
import type { CreateDemoRequest } from './demo-request.schema.js';

const DEFAULT_WHATSAPP_NUMBER = '59168482323';

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildDemoRequestMessage(input: CreateDemoRequest): string {
  const lineCountLabel = input.lineCount === 1 ? 'línea' : 'líneas';
  const vehicles = input.vehicleCount
    ? ` y aproximadamente ${input.vehicleCount} vehículos`
    : '';

  return `Hola QUIVO. Soy ${normalizeText(input.name)}, de ${normalizeText(input.line)} en ${normalizeText(input.city)}. Tenemos ${input.lineCount} ${lineCountLabel}${vehicles}. Quiero coordinar una demostración de QUIVO Control.`;
}

export function buildDemoRequestWhatsAppUrl(message: string): string {
  const number = (process.env.DEMO_WHATSAPP_NUMBER ?? DEFAULT_WHATSAPP_NUMBER).replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export class DemoRequestsService {
  async create(input: CreateDemoRequest) {
    const message = buildDemoRequestMessage(input);

    // Los campos del formulario ya fueron validados por Zod. El honeypot permite
    // responder sin llenar la tabla si un bot lo completa, sin revelar el motivo.
    if (!input.website?.trim()) {
      await prisma.demoRequest.create({
        data: {
          id: randomUUID(),
          name: normalizeText(input.name),
          line: normalizeText(input.line),
          city: normalizeText(input.city),
          lineCount: input.lineCount,
          vehicleCount: input.vehicleCount,
          source: 'landing',
        },
      });
    }

    return {
      ok: true as const,
      message,
      whatsappUrl: buildDemoRequestWhatsAppUrl(message),
    };
  }
}
