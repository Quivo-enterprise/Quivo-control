import { describe, expect, it } from 'vitest';
import { construirUrlWhatsApp, mensajeParaConductor } from './whatsapp';
import { LINEAS_MOCK, TRUFIS_MOCK } from './datos';
import { CATALOGO_INFRACCIONES } from './catalogo-infracciones';

describe('construirUrlWhatsApp', () => {
  it('arma la URL de wa.me con solo dígitos y el mensaje codificado', () => {
    const url = construirUrlWhatsApp('59170000001', 'Hola mundo');
    expect(url).toBe('https://wa.me/59170000001?text=Hola%20mundo');
  });

  it('elimina cualquier caracter no numérico del teléfono (espacios, +, guiones)', () => {
    const url = construirUrlWhatsApp('+591 7000-0001', 'x');
    expect(url).toBe('https://wa.me/59170000001?text=x');
  });

  it('codifica correctamente caracteres especiales del mensaje', () => {
    const url = construirUrlWhatsApp('123', 'placa Z12-07 & línea "Z12"');
    expect(url).toBe(`https://wa.me/123?text=${encodeURIComponent('placa Z12-07 & línea "Z12"')}`);
  });
});

describe('mensajeParaConductor', () => {
  const trufi = TRUFIS_MOCK[0]!;
  const linea = LINEAS_MOCK[trufi.lineaId];

  it('menciona la placa y el nombre de la línea sin infracción', () => {
    const mensaje = mensajeParaConductor(trufi, linea);
    expect(mensaje).toContain(trufi.placa);
    expect(mensaje).toContain(linea.nombre);
  });

  it('con infracción activa, menciona también el nombre del tipo de infracción', () => {
    const tipo = CATALOGO_INFRACCIONES[0]!;
    const infraccion = {
      id: 'inf-1',
      trufiId: trufi.id,
      tipoId: tipo.id,
      severidad: tipo.severidad,
      ocurridaEn: new Date().toISOString(),
      estado: 'activa' as const,
    };
    const mensaje = mensajeParaConductor(trufi, linea, infraccion, tipo);
    expect(mensaje).toContain(trufi.placa);
    expect(mensaje).toContain(linea.nombre);
    expect(mensaje).toContain(tipo.nombre);
  });
});
