import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn();
const del = vi.fn();
const file = vi.fn((_: string) => ({ save, delete: del }));
const bucket = vi.fn((_: string) => ({ file }));
vi.mock('@google-cloud/storage', () => ({ Storage: vi.fn(() => ({ bucket })) }));

const { StorageService } = await import('./storage.service.js');
const BUCKET = 'quivo-test-media';
const dirLocal = fileURLToPath(new URL('../../../media/', import.meta.url));

describe('StorageService (GCS)', () => {
  beforeEach(() => {
    process.env.GCS_MEDIA_BUCKET = BUCKET;
    vi.clearAllMocks();
    save.mockResolvedValue(undefined);
    del.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete process.env.GCS_MEDIA_BUCKET;
  });

  it('sube con nombre prefijo/uuid.ext, cacheControl inmutable y URL pública', async () => {
    const s = new StorageService();
    const r = await s.subir({ buffer: Buffer.from('x'), contentType: 'image/jpeg', prefijo: 'vehiculos' });
    expect(r.objeto).toMatch(/^vehiculos\/[0-9a-f-]{36}\.jpg$/);
    expect(r.url).toBe(`https://storage.googleapis.com/${BUCKET}/${r.objeto}`);
    expect(bucket).toHaveBeenCalledWith(BUCKET);
    expect(save).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'image/jpeg',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      }),
    );
  });

  it('borra un objeto propio por URL', async () => {
    const s = new StorageService();
    const obj = 'vehiculos/123e4567-e89b-12d3-a456-426614174000.jpg';
    await s.borrar(`https://storage.googleapis.com/${BUCKET}/${obj}`);
    expect(file).toHaveBeenCalledWith(obj);
    expect(del).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('ignora URLs de otro bucket o de otro host y rutas con saltos', async () => {
    const s = new StorageService();
    const obj = 'vehiculos/123e4567-e89b-12d3-a456-426614174000.jpg';
    await s.borrar(`https://storage.googleapis.com/otro-bucket/${obj}`);
    await s.borrar(`https://evil.example.com/${BUCKET}/${obj}`);
    await s.borrar(`https://storage.googleapis.com/${BUCKET}/../x/${obj}`);
    await s.borrar(null);
    expect(file).not.toHaveBeenCalled();
  });

  it('traga un 404 y no lanza ante otros errores', async () => {
    const s = new StorageService();
    const obj = 'lineas/123e4567-e89b-12d3-a456-426614174000.png';
    del.mockRejectedValueOnce({ code: 404 });
    await expect(s.borrar(obj)).resolves.toBeUndefined();
    del.mockRejectedValueOnce(new Error('boom'));
    await expect(s.borrar(obj)).resolves.toBeUndefined();
  });
});

describe('StorageService (disco local)', () => {
  const creados: string[] = [];
  beforeEach(() => {
    delete process.env.GCS_MEDIA_BUCKET;
    vi.clearAllMocks();
  });
  afterEach(() => {
    for (const o of creados.splice(0)) rmSync(join(dirLocal, o), { force: true });
  });

  it('sin bucket guarda en disco y devuelve ruta relativa /v1/media', async () => {
    const s = new StorageService();
    const r = await s.subir({ buffer: Buffer.from('abc'), contentType: 'image/png', prefijo: 'lineas' });
    creados.push(r.objeto);
    expect(r.url).toBe(`/v1/media/${r.objeto}`);
    expect(readFileSync(join(dirLocal, r.objeto)).toString()).toBe('abc');
    expect(save).not.toHaveBeenCalled();
    await s.borrar(r.url);
    expect(existsSync(join(dirLocal, r.objeto))).toBe(false);
    await expect(s.borrar(r.url)).resolves.toBeUndefined();
  });

  describe('con MEDIA_PUBLIC_BASE_URL', () => {
    afterEach(() => {
      delete process.env.MEDIA_PUBLIC_BASE_URL;
    });

    it('devuelve URL absoluta (sin barra doble) y borrar la acepta, igual que la relativa', async () => {
      process.env.MEDIA_PUBLIC_BASE_URL = 'http://localhost:4000/';
      const s = new StorageService();
      const r = await s.subir({ buffer: Buffer.from('abc'), contentType: 'image/jpeg', prefijo: 'vehiculos' });
      creados.push(r.objeto);
      expect(r.url).toBe(`http://localhost:4000/v1/media/${r.objeto}`);
      await s.borrar(r.url);
      expect(existsSync(join(dirLocal, r.objeto))).toBe(false);

      const r2 = await s.subir({ buffer: Buffer.from('abc'), contentType: 'image/jpeg', prefijo: 'vehiculos' });
      creados.push(r2.objeto);
      await s.borrar(`/v1/media/${r2.objeto}`); // URL relativa ya guardada
      expect(existsSync(join(dirLocal, r2.objeto))).toBe(false);
    });

    it('ignora otros orígenes y saltos de directorio', async () => {
      process.env.MEDIA_PUBLIC_BASE_URL = 'http://localhost:4000';
      const s = new StorageService();
      const r = await s.subir({ buffer: Buffer.from('abc'), contentType: 'image/png', prefijo: 'lineas' });
      creados.push(r.objeto);
      const id = r.objeto.split('/')[1];
      await s.borrar(`http://evil.example.com/v1/media/${r.objeto}`);
      await s.borrar(`http://localhost:4000/v1/media/../media/lineas/${id}`);
      await s.borrar(`http://localhost:4000/v1/media/lineas/../../x/${id}`);
      expect(existsSync(join(dirLocal, r.objeto))).toBe(true);
    });
  });
});
