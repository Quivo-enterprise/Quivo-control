import { z } from 'zod';

/** Códigos históricos de expedición usados junto al CI boliviano. El CI nacional nuevo
 * puede no mostrarlos, por eso el dato es opcional. */
export const CODIGOS_EXPEDICION_CI_BOLIVIA = [
  'LP',
  'CB',
  'SC',
  'OR',
  'PT',
  'TJ',
  'CH',
  'BE',
  'PD',
] as const;

export function normalizarNombrePersona(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function normalizarDocumentoIdentidadBolivia(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizarLicenciaConducir(value: string): string {
  return value.normalize('NFKC').toUpperCase().trim().replace(/\s+/g, ' ');
}

/** Nombres humanos Unicode. Se permiten tildes, apóstrofes, guiones y puntos, pero no
 * números ni símbolos que suelen aparecer por errores de captura. */
export const NombrePersonaSchema = z
  .string({ required_error: 'El nombre completo es obligatorio' })
  .transform(normalizarNombrePersona)
  .pipe(
    z
      .string()
      .min(3, 'Ingresa al menos 3 caracteres')
      .max(200, 'El nombre no puede superar 200 caracteres')
      .regex(
        /^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u,
        'Usa solo letras, espacios, apóstrofes, guiones o puntos',
      ),
  );

/**
 * CI boliviano en una representación única:
 *   NUMERO[-COMPLEMENTO][ EXPEDICION]
 *
 * Ejemplos: 1234567, 1234567-1A, 1234567 LP, 1234567-1A LP.
 * El complemento y la expedición son opcionales porque no todas las cédulas los tienen.
 * El rango del número es deliberadamente amplio para admitir registros históricos sin
 * inventar una longitud que SEGIP no establece públicamente como regla universal.
 */
export const DocumentoIdentidadBoliviaSchema = z
  .string({ required_error: 'El CI es obligatorio' })
  .transform(normalizarDocumentoIdentidadBolivia)
  .pipe(
    z
      .string()
      .min(4, 'El CI debe tener al menos 4 dígitos')
      .max(29, 'El CI no puede superar 29 caracteres')
      .regex(
        /^\d{4,15}(?:-[A-Z0-9]{1,10})?(?: (?:LP|CB|SC|OR|PT|TJ|CH|BE|PD))?$/,
        'Formato inválido. Usa número, complemento opcional y expedición; ej.: 1234567-1A LP',
      ),
  );

export const LicenciaConducirBoliviaSchema = z
  .string({ required_error: 'La licencia de conducir es obligatoria' })
  .transform(normalizarLicenciaConducir)
  .pipe(
    z
      .string()
      .min(4, 'La licencia debe tener al menos 4 caracteres')
      .max(50, 'La licencia no puede superar 50 caracteres')
      .regex(
        /^[A-Z0-9][A-Z0-9 ./-]*$/,
        'La licencia solo puede contener letras, números, espacios, puntos, guiones o barras',
      ),
  );
