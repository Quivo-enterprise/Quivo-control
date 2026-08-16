import type { Logger } from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Aplica `mapear` a cada fila de un listado leído de la base, tolerando filas que no
 * pasan su schema Zod: la fila corrupta se omite del resultado (en vez de tumbar el
 * endpoint entero con un `ZodError` sin capturar) y se deja rastro ruidoso en el log —
 * id de la fila + qué campo(s) fallaron y por qué — para que sea diagnosticable.
 *
 * Nace del incidente de `VehiculosService.listar()` (noche previa al piloto, QUI-366):
 * una fila con datos placeholder (`placa: 'PILOTO001'`, `color: 'PLACEHOLDER'`) hacía
 * `VehiculoSchema.parse()` explotar dentro de un `.map()`, y como no había try/catch se
 * caía el listado completo con un 500 genérico para cualquier cuenta que viera esa fila.
 *
 * Solo atrapa `ZodError`: cualquier otro error que lance `mapear` (bug real, error de
 * infraestructura, etc.) se re-lanza tal cual — omitir silenciosamente algo que no es
 * "esta fila no cumple el schema" escondería bugs reales detrás de un listado incompleto.
 *
 * OJO: esto es solo para datos ya persistidos que se leen de vuelta. NO usar sobre input
 * del usuario (bodies de POST/PATCH) — ahí un dato inválido SÍ debe rechazar el request
 * completo con 400 (ver `ZodValidationPipe`).
 */
export function mapearTolerante<Fila extends { id: string }, T>(
  filas: readonly Fila[],
  mapear: (fila: Fila) => T,
  logger: Logger,
  entidad: string,
): T[] {
  const resultado: T[] = [];
  for (const fila of filas) {
    try {
      resultado.push(mapear(fila));
    } catch (error) {
      if (!(error instanceof ZodError)) {
        throw error;
      }
      const detalle = error.issues
        .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
        .join('; ');
      logger.error(`${entidad} ${fila.id} inválido, omitido del listado: ${detalle}`);
    }
  }
  return resultado;
}
