import { z } from 'zod';

/**
 * Roles del sistema (doc técnico §5). `admin_quivo` no tiene sindicato_id (super-admin).
 */
export const RolSchema = z.enum([
  'admin_quivo',
  'admin_sindicato',
  'operador',
  'supervisor',
  'socio',
  'conductor',
]);

export type Rol = z.infer<typeof RolSchema>;
