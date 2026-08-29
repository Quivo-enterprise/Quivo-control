import { z } from 'zod';

/**
 * Roles del sistema (doc técnico §5). `admin_quivo` no tiene sindicato_id (super-admin).
 * `pasajero` pertenece a la experiencia pública de QUIVO Rutas y nunca debe recibir
 * acceso a los módulos administrativos u operativos de Control.
 */
export const RolSchema = z.enum([
  'admin_quivo',
  'admin_sindicato',
  'operador',
  'supervisor',
  'socio',
  'conductor',
  'pasajero',
]);

export type Rol = z.infer<typeof RolSchema>;
