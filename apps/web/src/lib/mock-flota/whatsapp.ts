import type { InfraccionMock, InfraccionTipo, LineaMock, TrufiMock } from './tipos';

/**
 * Construcción de la URL de `wa.me` para el botón de WhatsApp de la ficha del trufi
 * (Decisión 9 del plan). Mismo patrón que `buildDemoRequestWhatsAppUrl`
 * (`apps/api/src/modules/demo-requests/demo-requests.service.ts`), reescrito acá porque el
 * web no depende de la API para nada de este módulo mock.
 */
export function construirUrlWhatsApp(numero: string, mensaje: string): string {
  const digitos = numero.replace(/\D/g, '');
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Mensaje en español para el conductor: menciona placa, línea y, si hay una infracción
 * activa, también el nombre de la infracción.
 */
export function mensajeParaConductor(
  trufi: TrufiMock,
  linea: LineaMock,
  infraccion?: InfraccionMock,
  tipo?: InfraccionTipo,
): string {
  const saludo = `Hola ${trufi.conductorNombre}, le escribimos de QUIVO Control sobre el vehículo ${trufi.placa} de la línea ${linea.nombre}.`;

  if (infraccion && tipo) {
    return `${saludo} Se registró la infracción "${tipo.nombre}". Por favor comuníquese a la brevedad.`;
  }

  return `${saludo} Necesitamos coordinar con usted, por favor comuníquese a la brevedad.`;
}
