import 'dotenv/config';
import { APIError } from 'better-auth';
import { auth } from '../src/auth.js';

/**
 * Usuarios demo para probar login/refresh reales (QUI-219) sin depender de un backoffice
 * de altas todavía inexistente. Password fija documentada en apps/api/README.md — mismo
 * nivel de exposición que el resto de datos demo del repo (ver también
 * apps/web/src/lib/demo-data.ts). Se crean vía `auth.api.signUpEmail` (no insertando filas
 * a mano) para que Better-Auth siga siendo quien hashea la contraseña.
 */
const SEED_PASSWORD = 'Quivo123!';

const USERS = [
  {
    email: 'admin@quivo.local',
    name: 'Admin QUIVO',
    rol: 'admin_quivo',
    sindicatoId: null,
  },
  {
    email: 'admin@sindicato.local',
    name: 'Admin Sindicato 1º de Mayo',
    rol: 'admin_sindicato',
    sindicatoId: '11111111-1111-4111-8111-111111111111',
  },
] as const;

async function seed(): Promise<void> {
  for (const user of USERS) {
    try {
      await auth.api.signUpEmail({
        body: {
          email: user.email,
          password: SEED_PASSWORD,
          name: user.name,
          rol: user.rol,
          sindicatoId: user.sindicatoId,
        },
      });
      console.log(`Creado: ${user.email} (${user.rol})`);
    } catch (error) {
      if (error instanceof APIError && error.status === 'UNPROCESSABLE_ENTITY') {
        console.log(`Ya existía, se omite: ${user.email}`);
        continue;
      }
      throw error;
    }
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Error corriendo el seed', error);
    process.exit(1);
  });
