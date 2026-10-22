import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import {
  PuntoControlSchema,
  type RolPuntoControl,
  type ActualizarPuntoControl,
  type CrearPuntoControl,
  type PuntoControl,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';
import { validarCercaniaARuta } from '../../common/geo/proximidad-ruta.js';

interface PuntoControlRow {
  id: string;
  rutaId: string;
  orden: number;
  coord: string; // GeoJSON como texto (ST_AsGeoJSON devuelve `text`).
  radioToleranciaM: number;
  obligatorio: boolean;
  estado: string;
  rol: string | null;
  esperaMin: number | null;
}

/**
 * `rol`/`esperaMin` (docs/plan-molinos-designacion.md) definen cómo cuenta las vueltas el
 * worker y qué espera Molinos: solo los admins los editan (`operador` puede crear/editar el
 * resto del punto, que es CRUD_NUCLEO). Coherencia (espeja los CHECK de la tabla, para dar un
 * 400 en español y no un 500): `esperaMin` solo con `rol = 'espera'`; en un `espera`, `null` = salida libre (sin espera mínima).
 */
function validarRolEspera(
  actor: AuthenticatedUser,
  data: { rol?: RolPuntoControl | null; esperaMin?: number | null },
  actual: { rol: string | null; esperaMin: number | null },
): { rol: string | null; esperaMin: number | null; cambia: boolean } {
  const tocaRol = data.rol !== undefined || data.esperaMin !== undefined;
  if (tocaRol && actor.rol === 'operador') {
    throw new ForbiddenException('Solo un administrador puede configurar el rol y la espera de un punto de control');
  }
  const rol = data.rol !== undefined ? data.rol : actual.rol;
  // Al sacar el rol `espera`, la espera se limpia sola (el CHECK la prohíbe sin rol espera).
  const esperaMin =
    data.esperaMin !== undefined ? data.esperaMin : rol === 'espera' ? actual.esperaMin : null;
  if (tocaRol && rol !== 'espera' && esperaMin) {
    throw new BadRequestException('esperaMin solo aplica a un punto de control con rol "espera"');
  }
  return { rol, esperaMin: esperaMin ?? null, cambia: tocaRol };
}

/**
 * RF-34..39 (QUI-226) — solo la gestión del punto; la validación de cumplimiento en
 * recorrido real (RF-39, contra `radioToleranciaM`) es de M3 (worker de tracking). Mismo
 * patrón que paradas.service.ts: sin RLS propia (hereda tenant vía rutaId → linea), `coord`
 * es GEOGRAPHY(POINT) → SQL crudo.
 */
@Injectable()
export class ControlPointsService {
  async listarPorRuta(actor: AuthenticatedUser, rutaId: string): Promise<PuntoControl[]> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      const rows = await tx.$queryRaw<PuntoControlRow[]>`
        SELECT id, "rutaId", orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio, estado, rol, "esperaMin"
        FROM puntos_control WHERE "rutaId" = ${rutaId} ORDER BY orden ASC
      `;
      return rows.map(toPuntoControl);
    });
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const row = await obtenerFila(tx, id);
      await asegurarRutaVisible(tx, row.rutaId);
      return toPuntoControl(row);
    });
  }

  async crear(actor: AuthenticatedUser, rutaId: string, data: CrearPuntoControl): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRutaVisible(tx, rutaId);
      await validarCercaniaARuta(tx, rutaId, data.coord);
      const { rol, esperaMin } = validarRolEspera(actor, data, { rol: null, esperaMin: null });

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, rol, "esperaMin", "createdAt", "updatedAt")
        VALUES (
          ${id}, ${rutaId}, ${data.orden},
          ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
          ${data.radioToleranciaM}, ${data.obligatorio}, ${data.estado}, ${rol}, ${esperaMin}, now(), now()
        )
      `;
      return toPuntoControl(await obtenerFila(tx, id));
    });
  }

  async actualizar(
    actor: AuthenticatedUser,
    id: string,
    data: ActualizarPuntoControl,
  ): Promise<PuntoControl> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const anterior = await obtenerFila(tx, id);
      await asegurarRutaVisible(tx, anterior.rutaId);
      const nuevoRol = validarRolEspera(actor, data, anterior);

      if (data.coord) {
        await validarCercaniaARuta(tx, anterior.rutaId, data.coord);
        await tx.$executeRaw`
          UPDATE puntos_control
          SET coord = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(data.coord)}), 4326)::geography,
              "updatedAt" = now()
          WHERE id = ${id}
        `;
      }
      if (data.orden !== undefined) {
        await tx.$executeRaw`UPDATE puntos_control SET orden = ${data.orden}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (data.radioToleranciaM !== undefined) {
        await tx.$executeRaw`
          UPDATE puntos_control SET "radioToleranciaM" = ${data.radioToleranciaM}, "updatedAt" = now() WHERE id = ${id}
        `;
      }
      if (data.obligatorio !== undefined) {
        await tx.$executeRaw`
          UPDATE puntos_control SET obligatorio = ${data.obligatorio}, "updatedAt" = now() WHERE id = ${id}
        `;
      }
      if (data.estado !== undefined) {
        await tx.$executeRaw`UPDATE puntos_control SET estado = ${data.estado}, "updatedAt" = now() WHERE id = ${id}`;
      }
      if (nuevoRol.cambia) {
        await tx.$executeRaw`
          UPDATE puntos_control
          SET rol = ${nuevoRol.rol}, "esperaMin" = ${nuevoRol.esperaMin},
              -- La base de la fila de salida solo vale en la terminal (CHECK): se limpia al cambiar el rol.
              "frecuenciaSalidaMin" = CASE WHEN ${nuevoRol.rol}::text = 'terminal' THEN "frecuenciaSalidaMin" END,
              "updatedAt" = now()
          WHERE id = ${id}
        `;
      }

      return toPuntoControl(await obtenerFila(tx, id));
    });
  }
}

async function obtenerFila(tx: Prisma.TransactionClient, id: string): Promise<PuntoControlRow> {
  const rows = await tx.$queryRaw<PuntoControlRow[]>`
    SELECT id, "rutaId", orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio, estado, rol, "esperaMin"
    FROM puntos_control WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) {
    throw new NotFoundException('Punto de control no encontrado');
  }
  return row;
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function toPuntoControl(row: PuntoControlRow): PuntoControl {
  return PuntoControlSchema.parse({ ...row, coord: JSON.parse(row.coord) });
}
