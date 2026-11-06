import { z } from 'zod';

/**
 * Roles del sistema (doc técnico §5). `admin_quivo` no tiene sindicato_id (super-admin).
 * `delegado`: delegado del sindicato desde el celular (un solo sindicato); solo Hoy, En vivo,
 * Alertas y Salidas. `pasajero` pertenece a la experiencia pública de QUIVO Rutas y nunca debe recibir
 * acceso a los módulos administrativos u operativos de Control.
 */
export const RolSchema = z.enum([
  'admin_quivo',
  'admin_sindicato',
  'operador',
  'delegado',
  'supervisor',
  'socio',
  'conductor',
  'pasajero',
]);

export type Rol = z.infer<typeof RolSchema>;
