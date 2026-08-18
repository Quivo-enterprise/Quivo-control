import { PaqueteDiaSchema, type PaqueteDia } from '@quivo/shared';

/** Fila cruda tal como sale de `SELECT ... FROM paquete_dia` (`db/paquete-dia.ts`). */
export interface FilaPaqueteDia {
  asignacion_id: string;
  payload: string;
  vence_at: string;
  descargado_en: string;
}

export interface PaqueteDiaLocal {
  paquete: PaqueteDia;
  vencido: boolean;
  descargadoEn: string;
}

/**
 * Interpreta la fila cruda del paquete del día — separado de `abrirPaqueteDiaDb()` /
 * `expo-sqlite` (mismo motivo que `gps/location-task.ts` está separado de
 * `gps/headless-task.ts`: importar `expo-sqlite` rompe la carga de módulos bajo vitest/Node)
 * para poder testear en Node la parte que de verdad importa: la comparación de identidad.
 *
 * Hallazgo 1 (CRÍTICO, piloto día 1 — ver `docs/plan-v2-app-y-mapa-en-vivo.md` §2.4): la
 * fila de `paquete_dia` sobrevive al logout (`borrarSesionMovil()` solo limpia SecureStore,
 * nunca esta base) y la única validación que existía antes era temporal —`vencido`, contra
 * el `venceAt` de la asignación GUARDADA EN LA FILA—. Si el teléfono se reusa entre turnos
 * (relevo a mitad de jornada, o el mismo conductor al día siguiente sin desloguearse; el
 * diseño depende de que `venceAt` cierre el turno, no de un logout diario) y el primer
 * intento de descarga falla por falta de señal, la fila puede pertenecer a OTRA asignación
 * cuyo `venceAt` todavía no venció. Sin esta comparación, esa fila se serviría como si fuera
 * el paquete de HOY: geofence contra los puntos de control de la ruta equivocada y
 * `cumplimiento_punto_control` referenciando un `puntoControlId` que no corresponde a la
 * asignación real del día.
 *
 * `asignacionIdEsperado` es la asignación de la SESIÓN ACTIVA (`ContextoOperativoMovil.
 * asignacion.id`), NUNCA la de la fila — comparar la fila contra sí misma no detectaría
 * nada. Un mismatch se trata exactamente igual que "no hay caché": el llamador cae a su
 * camino ya soportado para paquete ausente (mostrar el error de red real en el hook de
 * foreground; seguir registrando `gps_point` sin puntos de control en el headless), nunca a
 * servir datos de otra asignación.
 *
 * El parámetro es OBLIGATORIO (sin default) a propósito: fuerza a cualquier caller —
 * presente o futuro— a decidir explícitamente contra qué asignación compara, en vez de
 * poder olvidarlo como pasaba antes.
 */
export function interpretarFilaPaqueteDia(
  row: FilaPaqueteDia | null,
  asignacionIdEsperado: string,
): PaqueteDiaLocal | null {
  if (!row) return null;
  if (row.asignacion_id !== asignacionIdEsperado) return null;

  // `JSON.parse` sin protección tumbaba TODO el tick headless del turno (hallazgo de
  // revisión A2, ver el comentario original en `db/paquete-dia.ts`): un payload corrupto
  // cae al mismo camino ya soportado que un paquete ausente.
  let payloadCrudo: unknown;
  try {
    payloadCrudo = JSON.parse(row.payload);
  } catch {
    return null;
  }

  const parsed = PaqueteDiaSchema.safeParse(payloadCrudo);
  if (!parsed.success) return null;

  return {
    paquete: parsed.data,
    vencido: new Date(row.vence_at).getTime() <= Date.now(),
    descargadoEn: row.descargado_en,
  };
}
