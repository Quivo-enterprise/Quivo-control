import type { AdminResetPasswordRequest, UsuarioAdministrativo } from '@quivo/shared';
import { apiFetch } from './client';

/** Reset asistido por `admin_quivo` — ver AuthService.resetPasswordComoAdmin en apps/api
 * para el porqué (sin proveedor de email configurado en el proyecto). */
export const usuariosApi = {
  listar: (token: string) => apiFetch<UsuarioAdministrativo[]>('/auth/admin/users', token),
  resetearPassword: (token: string, data: AdminResetPasswordRequest) =>
    apiFetch<undefined>('/auth/admin/reset-password', token, { method: 'POST', body: data }),
};
