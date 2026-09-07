import type { ActualizarLinea, CrearLinea, EstadoPublicacion, Linea } from '@quivo/shared';
import { apiFetch } from './client';
import { mobilityPublicationsApi } from './mobility-publications';

export const lineasApi = {
  listar: (token: string) => apiFetch<Linea[]>('/lineas', token),
  crear: (token: string, data: CrearLinea) =>
    apiFetch<Linea>('/lineas', token, { method: 'POST', body: data }),
  actualizar: (token: string, id: string, data: ActualizarLinea) =>
    apiFetch<Linea>(`/lineas/${id}`, token, { method: 'PATCH', body: data }),
  actualizarPublicacion: (token: string, id: string, status: EstadoPublicacion) =>
    mobilityPublicationsApi.actualizar(token, 'lineas', id, status),
};

export async function subirLogoLinea(token: string, file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('El símbolo debe ser una imagen PNG, JPG o WebP.');
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('El símbolo debe pesar como máximo 2 MB.');

  const contenido = await leerComoDataUrl(file);
  const response = await apiFetch<{ url: string }>('/media/lineas/logo', token, {
    method: 'POST',
    body: { mimeType: file.type, contenido },
  });
  return response.url;
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
