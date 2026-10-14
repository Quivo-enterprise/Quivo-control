import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  FOTO_VEHICULO_MAX_BYTES,
  type FotoVehiculo,
  type SubirFotoVehiculoMovil,
  type Vehiculo,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { coincideFirma } from '../media/media.service.js';
import { StorageService } from '../storage/storage.service.js';
import { INCLUDE_FOTO_SUBIDA_POR, toVehiculo } from './vehiculos.service.js';

const MSG_SIN_VEHICULO =
  'No tienes una unidad asignada en este momento. Inicia un recorrido para subir la foto del vehículo.';

/**
 * PR C — foto de la unidad. El conductor la sube desde la app (`/mobile/vehiculo/foto`) y el
 * vehículo es SIEMPRE el de su sesión operativa vigente, nunca un id que mande el cliente;
 * el admin la puede quitar (`DELETE /vehiculos/:id/foto`).
 */
@Injectable()
export class VehiculoFotoService {
  private readonly logger = new Logger(VehiculoFotoService.name);

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async subirDesdeMovil(
    sesion: SesionMovilAutenticada,
    { imagenBase64, contentType }: SubirFotoVehiculoMovil,
  ): Promise<FotoVehiculo> {
    const buffer = Buffer.from(imagenBase64, 'base64');
    if (buffer.length === 0 || buffer.length > FOTO_VEHICULO_MAX_BYTES) {
      throw new BadRequestException('Sube una foto JPG o WebP válida de hasta 2 MB.');
    }
    if (!coincideFirma(buffer, contentType)) {
      throw new BadRequestException('El contenido no coincide con el tipo de imagen indicado.');
    }

    const contexto = { rol: 'conductor', sindicatoId: sesion.sindicatoId };
    // Se sube antes de abrir la transacción para no retener el lock de la fila durante la
    // subida de red. Si algo falla antes del commit, el objeto se limpia (ver catch).
    const subida = await this.storage.subir({ buffer, contentType, prefijo: 'vehiculos' });
    const actualizadaEn = new Date();
    // Vehículo resuelto dentro de la transacción; `null` mientras no se llegó a la fila.
    let vehiculoId: string | null = null;
    let anterior: string | null;
    try {
      anterior = await withTenantContext(contexto, async (tx) => {
        // El vehículo sale de la sesión en la base (no del token en memoria): si la sesión ya
        // se cerró/revocó o el vehículo desapareció, no hay unidad a la que asociar la foto.
        // Se valida en la MISMA transacción que bloquea la fila, así no hay ventana entre el
        // chequeo y la escritura.
        const fila = await tx.sesionOperativa.findUnique({
          where: { id: sesion.sesionId },
          select: { vehiculoId: true, estado: true, revokedAt: true },
        });
        if (!fila || fila.revokedAt || fila.estado !== 'activa') {
          throw new ConflictException(MSG_SIN_VEHICULO);
        }
        vehiculoId = fila.vehiculoId;
        // Bloquea la fila antes de leer la URL previa: dos subidas (o subida + borrado admin)
        // concurrentes se serializan y cada una borra exactamente la URL que ella reemplazó.
        const previa = await bloquearFotoVehiculo(tx, fila.vehiculoId);
        if (!previa) throw new ConflictException(MSG_SIN_VEHICULO);
        await tx.vehiculo.update({
          where: { id: fila.vehiculoId },
          data: {
            fotoUrl: subida.url,
            fotoActualizadaEn: actualizadaEn,
            fotoSubidaPorId: sesion.conductorId,
          },
        });
        return previa.fotoUrl;
      });
    } catch (error: unknown) {
      // El error puede llegar con el COMMIT ya aplicado (p. ej. conexión cortada al confirmar):
      // borrar el objeto dejaría la fila apuntando a una URL rota. Se relee la fila y sólo se
      // borra si NO apunta al objeto nuevo; si la relectura falla, mejor un huérfano.
      await this.limpiarSubidaFallida(contexto, vehiculoId, subida);
      throw error;
    }

    // Después del commit y best effort: un fallo acá solo deja un objeto huérfano.
    if (anterior && anterior !== subida.url) await this.storage.borrar(anterior);
    return { fotoUrl: subida.url, fotoActualizadaEn: actualizadaEn.toISOString() };
  }

  private async limpiarSubidaFallida(
    contexto: { rol: string; sindicatoId: string },
    vehiculoId: string | null,
    subida: { url: string; objeto: string },
  ): Promise<void> {
    // Sin vehículo resuelto nunca se llegó al UPDATE: el objeto es seguro de borrar.
    if (vehiculoId === null) return this.storage.borrar(subida.objeto);
    try {
      const fila = await withTenantContext(contexto, (tx) =>
        tx.vehiculo.findUnique({ where: { id: vehiculoId }, select: { fotoUrl: true } }),
      );
      if (fila?.fotoUrl === subida.url) return;
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo verificar la foto del vehículo ${vehiculoId}; se conserva ${subida.objeto} (un huérfano es preferible a una URL rota): ${String(error)}`,
      );
      return;
    }
    await this.storage.borrar(subida.objeto);
  }

  async obtenerDesdeMovil(sesion: SesionMovilAutenticada): Promise<FotoVehiculo | null> {
    const fila = await withTenantContext(
      { rol: 'conductor', sindicatoId: sesion.sindicatoId },
      (tx) =>
        tx.vehiculo.findUnique({
          where: { id: sesion.vehiculoId },
          select: { fotoUrl: true, fotoActualizadaEn: true },
        }),
    );
    if (!fila?.fotoUrl || !fila.fotoActualizadaEn) return null;
    return { fotoUrl: fila.fotoUrl, fotoActualizadaEn: fila.fotoActualizadaEn.toISOString() };
  }

  /** Admin: quita la foto vigente. Devuelve el vehículo (la auditoría necesita `id`/`sindicatoId`). */
  async quitar(actor: AuthenticatedUser, id: string): Promise<Vehiculo> {
    const { actualizado, anterior } = await withTenantContext(
      { rol: actor.rol, sindicatoId: actor.sindicatoId },
      async (tx) => {
        const previo = await bloquearFotoVehiculo(tx, id);
        if (!previo) throw new NotFoundException('Vehículo no encontrado');
        // Sin foto no hay nada que quitar: sin UPDATE, sin borrado y (al lanzar) sin fila de
        // auditoría — `AuditInterceptor` sólo escribe cuando el handler termina bien.
        if (!previo.fotoUrl) throw new NotFoundException('El vehículo no tiene foto');
        const fila = await tx.vehiculo.update({
          where: { id },
          data: { fotoUrl: null, fotoActualizadaEn: null, fotoSubidaPorId: null },
          include: INCLUDE_FOTO_SUBIDA_POR,
        });
        return { actualizado: fila, anterior: previo.fotoUrl };
      },
    );
    await this.storage.borrar(anterior);
    this.logger.log(`Foto del vehículo ${id} quitada por ${actor.userId}`);
    return toVehiculo(actualizado);
  }
}

/** `SELECT ... FOR UPDATE` de la fila del vehículo (bajo RLS: sólo ve las de su tenant). */
async function bloquearFotoVehiculo(
  tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> },
  id: string,
): Promise<{ fotoUrl: string | null } | null> {
  const filas = await tx.$queryRaw<{ fotoUrl: string | null }[]>`
    SELECT "fotoUrl" FROM "vehiculos" WHERE id = ${id} FOR UPDATE`;
  return filas[0] ?? null;
}
