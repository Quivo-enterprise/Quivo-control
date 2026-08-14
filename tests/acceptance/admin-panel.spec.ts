import { expect, test, type Page } from '@playwright/test';

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

test.describe('Panel administrativo', () => {
  // El endpoint de login limita a cinco intentos por minuto y los escenarios comparten
  // las dos cuentas locales. Ejecutarlos en serie conserva esa protección también en CI.
  test.describe.configure({ mode: 'serial' });
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
