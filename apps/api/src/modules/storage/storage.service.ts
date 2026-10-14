import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSIONES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PREFIJO_URL_LOCAL = '/v1/media/';
// Forma exacta de los objetos que genera `subir`: `prefijo/uuid.ext`, sin saltos de directorio.
const PATRON_OBJETO = /^[a-z0-9_-]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/i;
const ESQUEMA_O_RUTA_ABSOLUTA = /^[a-z][a-z0-9+.-]*:|^\//i;

export interface SubirArchivo {
  buffer: Buffer;
  contentType: string;
  /** Carpeta lógica dentro del bucket (p. ej. `vehiculos`, `lineas`). */
  prefijo: string;
}

export interface ArchivoSubido {
  /**
   * URL de lectura: pública en GCS; con el driver de disco, absoluta si `MEDIA_PUBLIC_BASE_URL`
   * está definida (la web vive en otro origen y no puede resolver una ruta relativa) o ruta
   * relativa `/v1/media/...` si no.
   */
  url: string;
  /** Nombre del objeto dentro del bucket (`prefijo/uuid.ext`). */
  objeto: string;
}

/**
 * Almacenamiento de media. Con `GCS_MEDIA_BUCKET` sube a Google Cloud Storage (bucket de
 * acceso uniforme con lectura pública por URL; la API corre como service account con
 * objectAdmin vía ADC). Sin la variable (desarrollo local y tests) cae a disco local, el
 * mismo directorio `apps/api/media/` que usaban los logos de línea antes de este servicio:
 * en Cloud Run ese disco es efímero, por eso en producción siempre debe estar el bucket.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucketName = process.env.GCS_MEDIA_BUCKET?.trim() || null;
  private readonly storage = this.bucketName ? new Storage() : null;
  /** Origen público de la API para armar URLs del driver de disco; sin barra final. */
  private readonly baseLocal = process.env.MEDIA_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || null;
  private readonly directorioLocal = fileURLToPath(new URL('../../../media/', import.meta.url));

  get usaGcs(): boolean {
    return this.bucketName !== null;
  }

  async subir({ buffer, contentType, prefijo }: SubirArchivo): Promise<ArchivoSubido> {
    const extension = EXTENSIONES[contentType];
    if (!extension) throw new Error(`Tipo de contenido no soportado: ${contentType}`);
    const prefijoLimpio = prefijo.replace(/^\/+|\/+$/g, '');
    const objeto = `${prefijoLimpio}/${randomUUID()}.${extension}`;

    if (this.storage && this.bucketName) {
      await this.storage.bucket(this.bucketName).file(objeto).save(buffer, {
        contentType,
        resumable: false,
        metadata: { cacheControl: CACHE_CONTROL },
      });
      return { url: `https://storage.googleapis.com/${this.bucketName}/${objeto}`, objeto };
    }

    await mkdir(join(this.directorioLocal, prefijoLimpio), { recursive: true });
    await writeFile(join(this.directorioLocal, objeto), buffer, { flag: 'wx' });
    return { url: `${this.baseLocal ?? ''}${PREFIJO_URL_LOCAL}${objeto}`, objeto };
  }

  /**
   * Borra un objeto por su nombre o por su URL pública. Solo toca objetos del almacenamiento
   * configurado (una URL ajena se ignora) y un 404 no es error. Pensado para limpieza best
   * effort: nunca lanza.
   */
  async borrar(urlOObjeto: string | null | undefined): Promise<void> {
    if (!urlOObjeto) return;
    const objeto = this.resolverObjeto(urlOObjeto);
    if (!objeto) return;
    try {
      if (this.storage && this.bucketName) {
        await this.storage.bucket(this.bucketName).file(objeto).delete({ ignoreNotFound: true });
      } else {
        await unlink(join(this.directorioLocal, objeto));
      }
    } catch (error: unknown) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 404 || code === 'ENOENT') return;
      this.logger.warn(`No se pudo borrar el objeto ${objeto}: ${String(error)}`);
    }
  }

  /** Nombre de objeto si `valor` apunta al almacenamiento configurado; si no, `null`. */
  private resolverObjeto(valor: string): string | null {
    let candidato: string | null = null;
    // Con el driver de disco se aceptan la ruta relativa (URLs ya guardadas) y la absoluta
    // con la base configurada; el resultado igual pasa por el regex estricto de abajo.
    const prefijosUrl = this.bucketName
      ? [`https://storage.googleapis.com/${this.bucketName}/`]
      : this.baseLocal
        ? [`${this.baseLocal}${PREFIJO_URL_LOCAL}`, PREFIJO_URL_LOCAL]
        : [PREFIJO_URL_LOCAL];
    const prefijoUrl = prefijosUrl.find((p) => valor.startsWith(p));
    if (prefijoUrl) candidato = valor.slice(prefijoUrl.length);
    else if (!ESQUEMA_O_RUTA_ABSOLUTA.test(valor)) candidato = valor;
    if (!candidato) return null;
    candidato = candidato.split('?')[0] ?? '';
    return PATRON_OBJETO.test(candidato) ? candidato : null;
  }
}
