import type { ContextoEnVivo } from '@quivo/shared';

type PcContexto = ContextoEnVivo['puntosControl'][number];

/**
 * Orden EFECTIVO de los PC de la vuelta, igual que la app del chofer (numeración "Punto de control N"
 * = índice + 1). Espejo de `ordenEfectivoPuntos` en apps/mobile/src/features/operacion/progreso-vuelta.ts:
 * mantener en sincronía. El PC `espera` (Molinos) solo cuenta si la variante de la vuelta lo designa;
 * entonces va tras el `retorno` si su `orden` es menor que el del retorno, o en su `orden`.
 */
// shortcut: copia de `ordenEfectivoPuntos` (apps/mobile), puede divergir; moverla a packages/shared e importarla
// desde ambos la próxima vez que se toque la app (requiere OTA).
export function pcsEfectivos(
  contexto: Pick<ContextoEnVivo, 'puntosControl' | 'puntoEsperaPorVariante'>,
  varianteId: string | null | undefined,
): PcContexto[] {
  const ordenados = [...contexto.puntosControl].sort((a, b) => a.orden - b.orden);
  const idEspera = varianteId ? (contexto.puntoEsperaPorVariante[varianteId] ?? null) : null;
  const espera = ordenados.find((p) => p.rol === 'espera' && p.id === idEspera);
  const base = ordenados.filter((p) => p.rol !== 'espera');
  if (!espera) return base;
  const idxRetorno = base.findIndex((p) => p.rol === 'retorno');
  if (idxRetorno >= 0 && espera.orden < base[idxRetorno]!.orden) {
    return [...base.slice(0, idxRetorno + 1), espera, ...base.slice(idxRetorno + 1)];
  }
  return ordenados.filter((p) => p.rol !== 'espera' || p.id === espera.id);
}
