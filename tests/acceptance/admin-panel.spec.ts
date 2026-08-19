import { expect, test, type Page } from '@playwright/test';
import { prisma, withTenantContext } from '@quivo/db';

const ADMIN_QUIVO = {
  email: 'admin@quivo.local',
  password: 'Quivo123!',
};

const ADMIN_SINDICATO = {
  email: 'admin@sindicato.local',
  password: 'Quivo123!',
};

async function login(page: Page, credentials: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(credentials.email);
  await page.getByLabel('Contraseña').fill(credentials.password);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Panel administrativo' })).toBeVisible();
}

async function navigate(page: Page, label: string, pathname: string) {
  await page.getByText(label, { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${pathname === '/' ? '' : pathname}/?$`));
}

// El endpoint de login limita a cinco intentos por minuto y este archivo, entre los dos
// `describe` de abajo, hace exactamente cinco. `mode: 'serial'` dentro de cada `describe`
// solo serializa esos tests entre sí — con `fullyParallel: true` (playwright.config.ts) dos
// `describe` de nivel superior igual son elegibles para correr en workers distintos al
// mismo tiempo, así que sin este `configure` a nivel de archivo los logins de ambos grupos
// pueden solaparse: revientan el límite de 5/min y además compiten por el `next dev` en frío
// del webServer de aceptación. Puesto acá (antes de cualquier `describe`), fuerza que todo
// el archivo corra en un único worker, en el orden declarado.
test.describe.configure({ mode: 'serial' });

test.describe('Panel administrativo', () => {
  test('admin QUIVO accede a los módulos exclusivos', async ({ page }) => {
    await login(page, ADMIN_QUIVO);

    await expect(page.getByText('Sindicatos', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Usuarios', { exact: true }).first()).toBeVisible();

    await navigate(page, 'Sindicatos', '/sindicatos');
    await expect(page.getByRole('heading', { name: 'Sindicatos' })).toBeVisible();
    await expect(page.getByText('Sindicato 1º de Mayo', { exact: true })).toBeVisible();

    await navigate(page, 'Usuarios', '/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'admin@quivo.local' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'admin@sindicato.local' })).toBeVisible();
    await page.getByLabel('Buscar por nombre o email').fill('admin@sindicato.local');
    await expect(page.getByRole('cell', { name: 'admin@sindicato.local' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'admin@quivo.local' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(
      page.getByRole('button', { name: 'Preparar restablecimiento' }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restablecer contraseña' })).toBeVisible();
    await page.getByLabel('Email del usuario').fill('admin@sindicato.local');
    await page.getByRole('textbox', { name: /^Contraseña nueva/ }).fill('PruebaSegura123!');
    await page.getByLabel('Confirmar contraseña nueva').fill('PruebaSegura123!');
    await page.getByRole('button', { name: 'Restablecer contraseña', exact: true }).first().click();
    const confirmacionReset = page.getByRole('alertdialog');
    await expect(confirmacionReset).toBeVisible();
    await expect(
      confirmacionReset.getByRole('heading', { name: 'Restablecer contraseña' }),
    ).toBeVisible();
    await confirmacionReset.getByRole('button', { name: 'Cancelar', exact: true }).click();
  });

  test('admin de sindicato queda aislado de módulos y datos globales', async ({ page }) => {
    await login(page, ADMIN_SINDICATO);

    await expect(page.getByText('Sindicatos', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Usuarios', { exact: true })).toHaveCount(0);

    // Una navegación directa destruye el árbol React actual y el guard redirige con
    // router.replace(), por lo que Chromium puede reportar ERR_ABORTED aunque el control
    // de acceso se haya aplicado correctamente.
    await page.goto('/sindicatos').catch((error: Error) => {
      if (!error.message.includes('ERR_ABORTED')) throw error;
    });
    await expect(page).toHaveURL(/\/$/);

    await navigate(page, 'Vehículos', '/vehiculos');
    await expect(page.getByText('1001ABC', { exact: true })).toBeVisible();
    await expect(page.getByText('2002DEF', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ver historial de 1001ABC' }).click();
    await expect(page.getByText('Historial de estados', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

    await navigate(page, 'Socios', '/socios');
    await page.getByPlaceholder('Buscar socio...').fill('María Quispe Mamani');
    await expect(page.getByText('María Quispe Mamani', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.locator('button#estado').click();
    await page.getByRole('option', { name: 'Inactivo' }).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    const confirmacionSocio = page.getByRole('alertdialog');
    await expect(
      confirmacionSocio.getByRole('heading', { name: 'Desactivar socio' }),
    ).toBeVisible();
    await confirmacionSocio.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByPlaceholder('Buscar socio...').fill('');
    await expect(page.getByText('José Choque Mamani', { exact: true })).toHaveCount(0);

    await navigate(page, 'Conductores', '/conductores');
    await page.getByPlaceholder('Buscar conductor...').fill('Pedro Quispe Mamani');
    await expect(page.getByText('Pedro Quispe Mamani', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.locator('button#estado').click();
    await page.getByRole('option', { name: 'Inactivo' }).click();
    await expect(page.locator('button#estado')).toHaveText(/Inactivo/);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    const confirmacionDesactivacion = page.getByRole('alertdialog');
    await expect(confirmacionDesactivacion).toBeVisible();
    await expect(
      confirmacionDesactivacion.getByRole('heading', { name: 'Desactivar conductor' }),
    ).toBeVisible();
    await confirmacionDesactivacion.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByPlaceholder('Buscar conductor...').fill('');
    await expect(page.getByText('Lucía Choque Mamani', { exact: true })).toHaveCount(0);
  });

  test('admin de sindicato puede consultar el flujo operativo sembrado', async ({ page }) => {
    await login(page, ADMIN_SINDICATO);

    await expect(page.getByRole('heading', { name: 'Acciones prioritarias' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Revisar rotaciones' })).toHaveAttribute(
      'href',
      '/rotaciones',
    );
    await expect(page.getByRole('link', { name: 'Revisar sanciones' })).toHaveAttribute(
      'href',
      '/reglas',
    );
    await expect(page.getByRole('link', { name: 'Ver errores de sync' })).toHaveAttribute(
      'href',
      '/sync-errores',
    );
    await expect(page.getByRole('link', { name: 'Revisar flota' })).toHaveAttribute(
      'href',
      '/vehiculos',
    );

    await navigate(page, 'Rutas', '/rutas');
    await page.locator('button#linea').click();
    await page.getByRole('option', { name: /L1/ }).click();
    await page.getByRole('button', { name: /Ida/ }).click();
    await expect(page.getByText('2 obligatorios', { exact: true })).toBeVisible();

    await navigate(page, 'Rotaciones', '/rotaciones');
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toBeVisible();
    await page.getByLabel('Buscar por período').fill('sin-coincidencias');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(
      page.getByText('No hay rotaciones que coincidan con los filtros aplicados.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await page
      .getByRole('button', { name: /2026-08/ })
      .first()
      .click();
    await expect(page.getByText('Rotación 2026-08', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeVisible();

    await navigate(page, 'Reglas y sanciones', '/reglas');
    await page.getByRole('tab', { name: 'Sanciones' }).click();
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toBeVisible();
    const sancion = page.getByRole('row', { name: /Llegó 25 minutos tarde al inicio del turno/ });
    await expect(sancion).toBeVisible();
    // El seed no fuerza de vuelta un estado que el operador ya transicionó; el control
    // sigue comprobando que la sanción conserva alguna acción válida para su estado.
    await expect(sancion.getByRole('button').first()).toBeVisible();

    await navigate(page, 'Reportes', '/reportes');
    await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled();
    await expect(page.getByText('Estado de sanción', { exact: true })).toBeVisible();
    await expect(page.getByText('Sujeto de sanción', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recorridos por periodo (CSV)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sanciones (CSV)' })).toBeVisible();

    await navigate(page, 'Auditoría', '/auditoria');
    await expect(page.getByRole('heading', { name: 'Auditoría' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toBeVisible();

    await navigate(page, 'Errores de sync', '/sync-errores');
    await expect(page.getByRole('heading', { name: 'Errores de sync' })).toBeVisible();
    const aplicarFiltros = page.getByRole('button', { name: 'Aplicar filtros' });
    await expect(aplicarFiltros).toBeEnabled();
    await page.getByLabel('Sesión (id)').fill('sesion-invalida');
    await expect(page.getByText('Ingresá un UUID de sesión válido.')).toBeVisible();
    await expect(aplicarFiltros).toBeDisabled();
  });
});

/**
 * Identificador único solo-dígitos para esta corrida. `CI boliviano` y `placa` (patrón
 * boliviano actual, ver `PATRON_PLACA_ACTUAL_BOLIVIA` en
 * `packages/shared/src/entities/vehiculo.ts`) exigen dígitos en este tramo — nada de hex.
 * Se genera **por invocación** (no a nivel de módulo) para que cada intento de
 * `playwright.config.ts` (`retries: 2` en CI) use datos frescos: si un intento falla
 * después de crear la entidad, el reintento no vuelve a chocar contra la restricción de
 * unicidad de `documentoIdentidad`/`placa` con el mismo valor.
 */
function generarIdentificadorUnico(): string {
  const timestamp = Date.now().toString();
  const aleatorio = Math.floor(100 + Math.random() * 900).toString();
  return `${timestamp}${aleatorio}`.slice(-6);
}

test.describe('Altas de entidades', () => {
  // El modo serial ya lo fija el `test.describe.configure` a nivel de archivo, arriba.

  // Documentos/placas creados por esta corrida (incluye intentos fallidos que sí llegaron
  // a persistir antes de que la aserción posterior fallara), para borrarlos en `afterAll`
  // y no ensuciar la base de aceptación de forma acumulativa.
  const conductoresCreados: string[] = [];
  const sociosCreados: string[] = [];
  const vehiculosCreados: string[] = [];

  test.afterAll(async () => {
    try {
      if (vehiculosCreados.length === 0 && sociosCreados.length === 0 && conductoresCreados.length === 0) {
        return;
      }
      // Las tablas de socios/vehículos/conductores tienen RLS multi-tenant (migración
      // `20260730152500_rls_multi_tenant`): sin `app.rol`/`app.sindicato_id` seteados vía
      // `withTenantContext`, un `deleteMany` de `prisma` a secas no borra nada (ni tira
      // error) — las filas simplemente no son visibles bajo la política. `admin_quivo` es
      // el rol con bypass explícito de esa política, así que alcanza para borrar entre
      // sindicatos sin necesitar el `sindicatoId` real de cada fixture.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        if (vehiculosCreados.length > 0) {
          await tx.vehiculo.deleteMany({ where: { placa: { in: vehiculosCreados } } });
        }
        if (sociosCreados.length > 0) {
          await tx.socio.deleteMany({ where: { documentoIdentidad: { in: sociosCreados } } });
        }
        if (conductoresCreados.length > 0) {
          await tx.conductor.deleteMany({
            where: { documentoIdentidad: { in: conductoresCreados } },
          });
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('alta de conductor exitosa', async ({ page }) => {
    const uniqueId = generarIdentificadorUnico();
    const conductorCI = `88${uniqueId} LP`;
    const conductorLicencia = `88${uniqueId}`;
    const conductorNombre = `Conductor Prueba`;

    await login(page, ADMIN_SINDICATO);
    await navigate(page, 'Conductores', '/conductores');

    await page.getByRole('button', { name: 'Nuevo conductor' }).click();

    await page.getByLabel('Nombre completo *').fill(conductorNombre);
    await page.getByLabel('CI boliviano *').fill(conductorCI);
    await page.getByLabel('Número de licencia de conducir *').fill(conductorLicencia);

    await page.getByRole('button', { name: 'Guardar' }).click();
    conductoresCreados.push(conductorCI);

    await expect(page.getByText(conductorNombre, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(conductorCI, { exact: true }).first()).toBeVisible();
  });

  test('alta de vehículo exitosa usando el socio fixture', async ({ page }) => {
    const uniqueId = generarIdentificadorUnico();
    const socioCI = `99${uniqueId} LP`;
    const socioNombre = `Socio Prueba`;
    const vehiculoPlaca = `${uniqueId.slice(-4)}XYZ`;

    await login(page, ADMIN_SINDICATO);

    // Seed Socio via UI
    await navigate(page, 'Socios', '/socios');
    await page.getByRole('button', { name: 'Nuevo socio' }).click();
    await page.getByLabel('Nombre completo *').fill(socioNombre);
    await page.getByLabel('CI boliviano *').fill(socioCI);
    await page.getByRole('button', { name: 'Guardar' }).click();
    sociosCreados.push(socioCI);
    await expect(page.getByText(socioNombre, { exact: true }).first()).toBeVisible();

    // Proceed to create vehicle
    await navigate(page, 'Vehículos', '/vehiculos');
    await page.getByRole('button', { name: 'Nuevo vehículo' }).click();

    await page.getByLabel('Placa *').fill(vehiculoPlaca);
    await page.getByRole('radio', { name: 'Minibús' }).click();

    await page.locator('button#vehiculo-socioId').click();
    await page.getByRole('option', { name: new RegExp(socioCI) }).click();

    await page.locator('button#vehiculo-color').click();
    await page.getByRole('option', { name: 'Blanco' }).click();

    await page.locator('button#vehiculo-marcaCatalogo').click();
    await page.getByRole('option', { name: 'Toyota' }).click();

    await page.getByLabel('Capacidad *').fill('14');

    const modeloInput = page.getByLabel('Modelo *');
    if (await modeloInput.isVisible()) {
      await modeloInput.fill('Hiace');
    }

    await page.getByRole('button', { name: 'Guardar' }).click();
    vehiculosCreados.push(vehiculoPlaca);

    await expect(page.getByText(vehiculoPlaca, { exact: true }).first()).toBeVisible();
  });
});
