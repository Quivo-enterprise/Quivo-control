import { devices, expect, test, type Page } from '@playwright/test';
import { NAV_ITEMS } from '../../apps/web/src/lib/nav-items';

const ADMIN = { email: 'admin@quivo.local', password: 'Quivo123!' };

// /en-vivo y /rutas se cubren en PR B/C. El admin_quivo ve todo lo demás.
const ROUTES = NAV_ITEMS.filter(
  (i) => i.roles.includes('admin_quivo') && !['/en-vivo', '/rutas'].includes(i.href),
).map((i) => i.href);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  const submit = page.getByRole('button', { name: 'Iniciar Sesión' });
  await submit.click();
  const ok = await page.waitForURL(/\/$/, { timeout: 10_000 }).then(() => true, () => false);
  if (!ok) {
    // Throttle del API (5/min por IP, compartido con admin-panel.spec): esperar la ventana y reintentar una vez.
    await page.waitForTimeout(61_000);
    await submit.click();
  }
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole('main')).toBeVisible();
}

// El login del API limita a 5/min: un solo login en beforeAll, página compartida entre tests seriales.
test.describe.configure({ mode: 'serial' });

test.describe('Panel móvil (Pixel 7)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: testInfo.project.use.baseURL });
    page = await context.newPage();
    await login(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('sin overflow horizontal en cada ruta', async ({}, testInfo) => {
    test.setTimeout(300_000);
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'networkidle', timeout: 60_000 });
      await expect(page.getByRole('main')).toBeVisible();
      const info = await page.evaluate(() => {
        const w = window.innerWidth;
        const offenders = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 1)
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}`);
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, offenders };
      });
      console.log(`[overflow] ${route} scrollWidth=${info.scrollWidth} innerWidth=${info.innerWidth} offenders=${info.offenders.join(' | ') || '-'}`);
      await testInfo.attach(`shot ${route}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      expect.soft(info.scrollWidth, `${route} desborda (${info.offenders.join(' | ')})`).toBeLessThanOrEqual(info.innerWidth + 1);
    }
  });

  test('drawer de navegación', async () => {
    const burger = page.getByRole('button', { name: 'Abrir menú' });
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(burger).toBeVisible();

    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('link', { name: 'Vehículos' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(burger).toBeFocused();

    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    const width = await page.evaluate(() => window.innerWidth);
    await page.mouse.click(width - 10, 300);
    await expect(burger).toHaveAttribute('aria-expanded', 'false');

    await burger.click();
    await nav.getByRole('link', { name: 'Vehículos' }).click();
    await expect(page).toHaveURL(/\/vehiculos\/?$/, { timeout: 30_000 });
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
  });

  test('manifest PWA e iconos', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of m.icons) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type'], icon.src).toContain('image/png');
    }
  });

  test('DataTable se apila como tarjetas', async () => {
    await page.goto('/vehiculos', { waitUntil: 'networkidle', timeout: 60_000 });
    const row = page.locator('tbody tr:has(td[data-label]:not([data-label=""]))').first();
    test.skip((await row.count()) === 0, 'sin filas seed en /vehiculos');
    await expect(row).toHaveCSS('display', 'grid');
  });

  test('inputs >= 16 px (iOS no hace zoom) y base 18 px', async () => {
    await page.goto('/vehiculos', { waitUntil: 'networkidle', timeout: 60_000 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('18px');
    const input = page.locator('main input:visible').first();
    await expect(input).toBeVisible();
    const px = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(px).toBeGreaterThanOrEqual(16);
  });

  test('Rutas: solo lectura en celular', async () => {
    test.setTimeout(90_000);
    await page.goto('/rutas', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('button#linea').click();
    const opcion = page.getByRole('option', { name: /120/ });
    await expect(opcion, 'el seed debe tener la línea 120').toBeVisible({ timeout: 30_000 });
    await opcion.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByRole('button', { name: /Herramientas/ }).click();
    await expect(page.getByText('La edición de trazado está disponible en escritorio.')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Nueva ruta' })).toHaveCount(0);
    await page.getByRole('button', { name: /Ida/ }).first().click();
    await expect(page.getByRole('button', { name: 'Editar parada' })).toHaveCount(0);
  });

  test('En vivo: barra compacta, sin overflow, Flota abre y Escape cierra', async () => {
    test.setTimeout(90_000);
    await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const barra = page.getByLabel('Barra de mando de En vivo');
    await expect(barra).toBeVisible({ timeout: 30_000 });
    expect((await barra.boundingBox())!.height).toBeLessThanOrEqual(132); // 2 filas: 114 px a 16 px de base, ~128 px con la base de 18 px móvil
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const flota = page.getByRole('button', { name: 'Flota', exact: true });
    // Esperar a que carguen los datos: o hay panel de Flota (jornada activa) o el estado vacío.
    await expect(
      page.locator('#qv-live-flota').or(page.getByText('Sin vehículos en ruta activa')),
    ).toBeAttached({ timeout: 30_000 });
    if ((await page.locator('#qv-live-flota').count()) === 0) {
      await expect(flota).toBeDisabled();
      test.info().annotations.push({ type: 'skip-parte', description: 'sin jornada activa en el seed: no hay panel de Flota' });
      return;
    }
    await flota.click();
    await expect(flota).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#qv-live-flota')).toBeVisible();
    // Con un vehículo seleccionado, su cajón se oculta mientras Flota está abierta.
    if ((await page.locator('.qv-live-cajon').count()) > 0) {
      await expect(page.locator('.qv-live-cajon')).toBeHidden();
    }
    await page.keyboard.press('Escape');
    await expect(flota).toHaveAttribute('aria-pressed', 'false');
    await expect(flota).toBeFocused();

    // Tocar el fondo también cierra y devuelve el foco.
    await flota.click();
    await expect(flota).toHaveAttribute('aria-pressed', 'true');
    const fondo = page.locator('.qv-live-flota-fondo');
    const caja = (await fondo.boundingBox())!;
    await page.mouse.click(caja.x + caja.width - 8, caja.y + caja.height / 2);
    await expect(flota).toHaveAttribute('aria-pressed', 'false');
    await expect(flota).toBeFocused();
  });
});
