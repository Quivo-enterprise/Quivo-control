import { Prisma } from '@quivo/db';

/**
 * Fragmento SQL "la vuelta NO está vacía" (misma definición que `esVueltaVacia` en
 * ingesta-worker/vueltas.ts, negada): designada, con retorno, con algún otro PC o con llegada a la
 * espera. El trigger `vueltas_cerrar_con_sesion` ya no borra: un logout sin `fin_recorrido` y sin lote
 * tardío deja una `abierta_al_cierre` vacía, y las consultas que cuentan o resumen vueltas la excluyen
 * con esto. `alias` es el de la tabla `vueltas` en la consulta (identificador fijo, no entrada del usuario).
 */
export function vueltaNoVacia(alias: string): Prisma.Sql {
  if (!/^[a-z_]+$/i.test(alias)) throw new Error('alias SQL inválido');
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}."varianteId" IS NOT NULL OR ${a}."pasoRetornoTs" IS NOT NULL
    OR ${a}."ultimoPcTs" IS NOT NULL OR ${a}."esperaLlegadaTs" IS NOT NULL)`;
}

/** Vuelta que cuenta: la en curso (aunque recién abierta está vacía) o cualquier otra no vacía. */
export function vueltaContable(alias: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}.estado = 'en_curso' OR ${vueltaNoVacia(alias)})`;
}
