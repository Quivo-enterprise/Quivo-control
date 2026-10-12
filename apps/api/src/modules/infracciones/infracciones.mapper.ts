import { InfraccionSchema, type Infraccion } from '@quivo/shared';

/** Fila de `infracciones` (Prisma) → contrato zod. `detalle` viaja tal cual (jsonb). */
export function toInfraccion(row: {
  id: string;
  sindicatoId: string;
  sesionId: string;
  vehiculoId: string;
  conductorId: string;
  lineaId: string;
  rutaId: string;
  tipo: string;
  gravedad: string;
  reglaId: string | null;
  estado: string;
  inicioTs: Date;
  finTs: Date | null;
  lat: number;
  lng: number;
  detalle: unknown;
  sancionId: string | null;
  atendidaPor: string | null;
  atendidaEn: Date | null;
  nota: string | null;
  createdAt: Date;
}): Infraccion {
  return InfraccionSchema.parse(row);
}
