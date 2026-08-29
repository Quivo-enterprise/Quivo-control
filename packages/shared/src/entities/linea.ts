import { z } from 'zod';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';
import { EstadoPublicacionSchema, MobilityCityIdSchema } from '../public-mobility.js';

const colorHexSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Usa un color hexadecimal de 6 dígitos');
const nullableColorHexSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  colorHexSchema.nullable(),
);
const nullableTextSchema = (max: number) =>
  z.preprocess((value) => (value === '' ? null : value), z.string().trim().max(max).nullable());
const nullableUrlSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().url('Ingresa una URL válida.').max(500).nullable(),
);

export const LineaDistintivoTipoSchema = z.enum([
  'banderita',
  'cartel',
  'numero',
  'texto',
  'simbolo',
]);
export type LineaDistintivoTipo = z.infer<typeof LineaDistintivoTipoSchema>;

export const LineaCartelFormatoSchema = z.enum(['doble_clasico', 'simple', 'tres_lineas']);
export const LineaCartelNumeroPosicionSchema = z.enum(['izquierda', 'derecha']);
export const LineaCartelLogoPosicionSchema = z.enum(['ninguno', 'izquierda', 'derecha']);
const nullableCartelFormatoSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  LineaCartelFormatoSchema.nullable(),
);
const nullableCartelNumeroPosicionSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  LineaCartelNumeroPosicionSchema.nullable(),
);
const nullableCartelLogoPosicionSchema = z.preprocess(
  (value) => (value === '' ? null : value),
  LineaCartelLogoPosicionSchema.nullable(),
);

export const LineaSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  cityId: MobilityCityIdSchema.optional(),
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(200),
  color: z.string().max(30).nullable(),
  colorSecundario: nullableColorHexSchema,
  colorTexto: nullableColorHexSchema,
  colorTerciario: nullableColorHexSchema.optional(),
  colorFondo: nullableColorHexSchema.optional(),
  nombreCorto: z.string().max(40).nullable(),
  lema: z.string().max(160).nullable(),
  descripcion: z.string().max(1000).nullable(),
  logoUrl: nullableUrlSchema.optional(),
  distintivoTipo: LineaDistintivoTipoSchema.nullable().optional(),
  distintivoValor: nullableTextSchema(80).optional(),
  cartelSuperior: nullableTextSchema(120).optional(),
  cartelFormato: nullableCartelFormatoSchema.optional(),
  cartelTitulo: nullableTextSchema(60).optional(),
  cartelDetalle: nullableTextSchema(80).optional(),
  cartelNumeroPosicion: nullableCartelNumeroPosicionSchema.optional(),
  cartelLogoPosicion: nullableCartelLogoPosicionSchema.optional(),
  cartelColorTitulo: nullableColorHexSchema.optional(),
  cartelColorDetalle: nullableColorHexSchema.optional(),
  cartelColorNumero: nullableColorHexSchema.optional(),
  cartelColorBorde: nullableColorHexSchema.optional(),
  publicStatus: EstadoPublicacionSchema,
  publishedAt: z.string().datetime().nullable(),
});
export type Linea = z.infer<typeof LineaSchema>;

export const CrearLineaSchema = LineaSchema.omit({
  id: true,
  publicStatus: true,
  publishedAt: true,
  color: true,
  colorSecundario: true,
  colorTexto: true,
  colorTerciario: true,
  colorFondo: true,
  nombreCorto: true,
  lema: true,
  descripcion: true,
  logoUrl: true,
  distintivoTipo: true,
  distintivoValor: true,
  cartelSuperior: true,
  cartelFormato: true,
  cartelTitulo: true,
  cartelDetalle: true,
  cartelNumeroPosicion: true,
  cartelLogoPosicion: true,
  cartelColorTitulo: true,
  cartelColorDetalle: true,
  cartelColorNumero: true,
  cartelColorBorde: true,
}).extend({
  color: z.string().max(30).nullable().optional(),
  colorSecundario: nullableColorHexSchema.optional(),
  colorTexto: nullableColorHexSchema.optional(),
  colorTerciario: nullableColorHexSchema.optional(),
  colorFondo: nullableColorHexSchema.optional(),
  nombreCorto: z.string().max(40).nullable().optional(),
  lema: z.string().max(160).nullable().optional(),
  descripcion: z.string().max(1000).nullable().optional(),
  logoUrl: nullableUrlSchema.optional(),
  distintivoTipo: LineaDistintivoTipoSchema.nullable().optional(),
  distintivoValor: nullableTextSchema(80).optional(),
  cartelSuperior: nullableTextSchema(120).optional(),
  cartelFormato: nullableCartelFormatoSchema.optional(),
  cartelTitulo: nullableTextSchema(60).optional(),
  cartelDetalle: nullableTextSchema(80).optional(),
  cartelNumeroPosicion: nullableCartelNumeroPosicionSchema.optional(),
  cartelLogoPosicion: nullableCartelLogoPosicionSchema.optional(),
  cartelColorTitulo: nullableColorHexSchema.optional(),
  cartelColorDetalle: nullableColorHexSchema.optional(),
  cartelColorNumero: nullableColorHexSchema.optional(),
  cartelColorBorde: nullableColorHexSchema.optional(),
});
export type CrearLinea = z.infer<typeof CrearLineaSchema>;

export const ActualizarLineaSchema = LineaSchema.omit({
  id: true,
  sindicatoId: true,
  publicStatus: true,
  publishedAt: true,
}).partial();
export type ActualizarLinea = z.infer<typeof ActualizarLineaSchema>;

export const LINEA_BRAND_DEFAULTS = {
  primary: '#3226B4',
  secondary: '#FD9E15',
  tertiary: '#0F766E',
  background: '#F8FAFC',
  text: '#FFFFFF',
} as const;

export interface LineaBrandSource {
  codigo?: string;
  nombre?: string;
  color?: string | null;
  colorSecundario?: string | null;
  colorTexto?: string | null;
  colorTerciario?: string | null;
  colorFondo?: string | null;
  nombreCorto?: string | null;
  lema?: string | null;
  logoUrl?: string | null;
  distintivoTipo?: LineaDistintivoTipo | null;
  distintivoValor?: string | null;
  cartelSuperior?: string | null;
  cartelFormato?: z.infer<typeof LineaCartelFormatoSchema> | null;
  cartelTitulo?: string | null;
  cartelDetalle?: string | null;
  cartelNumeroPosicion?: z.infer<typeof LineaCartelNumeroPosicionSchema> | null;
  cartelLogoPosicion?: z.infer<typeof LineaCartelLogoPosicionSchema> | null;
  cartelColorTitulo?: string | null;
  cartelColorDetalle?: string | null;
  cartelColorNumero?: string | null;
  cartelColorBorde?: string | null;
}

export interface LineaBrand {
  primary: string;
  secondary: string;
  tertiary: string;
  background: string;
  text: string;
  shortName: string;
  tagline: string;
  logoUrl: string;
  markerType: LineaDistintivoTipo;
  markerValue: string;
  roofSign: string;
}

export function resolverMarcaLinea(linea: LineaBrandSource): LineaBrand {
  return {
    primary: linea.color || LINEA_BRAND_DEFAULTS.primary,
    secondary: linea.colorSecundario || LINEA_BRAND_DEFAULTS.secondary,
    tertiary: linea.colorTerciario || LINEA_BRAND_DEFAULTS.tertiary,
    background: linea.colorFondo || LINEA_BRAND_DEFAULTS.background,
    text: linea.colorTexto || LINEA_BRAND_DEFAULTS.text,
    shortName: linea.nombreCorto || linea.codigo || linea.nombre || 'Línea',
    tagline: linea.lema || '',
    logoUrl: linea.logoUrl || '',
    markerType: linea.distintivoTipo || 'numero',
    markerValue: linea.distintivoValor || linea.nombreCorto || linea.codigo || 'Línea',
    roofSign: linea.cartelSuperior || '',
  };
}
