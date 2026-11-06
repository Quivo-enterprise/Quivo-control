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
    const burger = page.getByRole('button', { name: 'Más', exact: true });
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

  test('tabbar: visible, Más abre el drawer y Salidas navega', async () => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
    const tabbar = page.getByRole('navigation', { name: 'Pestañas', exact: true });
    await expect(tabbar).toBeVisible();
    for (const name of ['Hoy', 'En vivo', 'Salidas', 'Alertas', 'Más']) {
      const box = (await tabbar.getByText(name, { exact: true }).locator('xpath=ancestor-or-self::*[self::a or self::button]').boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await expect(tabbar.getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'page');
    const viewport = page.viewportSize()!;
    const bar = (await tabbar.boundingBox())!;
    expect(Math.round(bar.y + bar.height)).toBe(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await tabbar.getByRole('button', { name: 'Más' }).click();
    await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Vehículos' })).toBeVisible();
    await page.keyboard.press('Escape');

    await tabbar.getByRole('link', { name: 'Salidas' }).click();
    await expect(page).toHaveURL(/\/salidas\/?$/, { timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Pestañas', exact: true }).getByRole('link', { name: 'Salidas' })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('encabezado único por ruta, tabbar de 76 px y contador de alertas', async () => {
    test.setTimeout(300_000);
    const base = {
      sindicatoId: '00000000-0000-4000-8000-0000000000a1', vehiculoId: '00000000-0000-4000-8000-0000000000b1',
      conductorId: '00000000-0000-4000-8000-0000000000c1', lineaId: '00000000-0000-4000-8000-0000000000d1',
      rutaId: '00000000-0000-4000-8000-0000000000e1', reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      vehiculoPlaca: '4701EHA', conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16', sesionId: '00000000-0000-4000-8000-0000000000f1',
      tipo: 'pc_omitido', gravedad: 'leve', inicioTs: new Date().toISOString(), detalle: {},
    };
    const abiertas = [1, 2, 3].map((n) => ({ ...base, id: `00000000-0000-4000-8000-00000000000${n}`, estado: 'abierta' }));
    const infracciones = '**/v1/reportes/en-vivo/infracciones*';
    const titulos = page.locator('.qv-page-header__title, .qv-admin-layout__topbar-title').filter({ visible: true });
    const tabbar = page.getByRole('navigation', { name: 'Pestañas', exact: true });
    const enlaceAlertas = tabbar.getByRole('link', { name: /Alertas/ });
    try {
      // Con alertas abiertas: contador visible y con texto para lectores de pantalla.
      await page.route(infracciones, (r) => r.fulfill({ json: abiertas }));
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'networkidle', timeout: 60_000 });
        await expect(page.getByRole('main')).toBeVisible();
        await expect(titulos, `${route}: un solo título visible`).toHaveCount(1);
        expect((await tabbar.boundingBox())!.height, route).toBe(76);
      }
      await expect(enlaceAlertas.locator('.qv-tabbar__badge')).toHaveText('3');
      await expect(enlaceAlertas).toContainText('3 alertas abiertas');
      const badge = (await enlaceAlertas.locator('.qv-tabbar__badge').boundingBox())!;
      expect(badge.width).toBeGreaterThanOrEqual(20);
      expect(badge.height).toBe(20);

      // Sin alertas abiertas: no hay contador.
      await page.unroute(infracciones);
      await page.route(infracciones, (r) => r.fulfill({ json: [] }));
      await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
      await expect(enlaceAlertas).toBeVisible();
      await expect(tabbar.locator('.qv-tabbar__badge')).toHaveCount(0);
    } finally {
      await page.unroute(infracciones);
    }
  });

  test('Salidas: stepper de base, confirmación y Despachar a todo el ancho', async () => {
    test.setTimeout(90_000);
    // API mockeada (formas validadas contra @quivo/shared): una terminal, base 8 min, fila de 2 trufis.
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const PC = uuid(3);
    const ahora = new Date();
    const iso = (min: number) => new Date(ahora.getTime() + min * 60_000).toISOString();
    const item = (n: number, placa: string, habilitado: boolean) => ({
      id: uuid(10 + n),
      vehiculoId: uuid(20 + n),
      placa,
      posicion: n,
      llegadaTs: iso(-10),
      etaTs: iso(habilitado ? 0 : 8),
      esperaMs: 0,
      estado: 'en_fila',
      habilitado,
      demorado: false,
      anticipada: false,
    });
    const respuestas: Record<string, unknown> = {
      '/v1/lineas': [
        {
          id: uuid(1), sindicatoId: uuid(99), codigo: '120', nombre: 'Linea 120', color: null, colorSecundario: null,
          colorTexto: null, nombreCorto: '120', lema: null, descripcion: null, publicStatus: 'borrador', publishedAt: null,
        },
      ],
      [`/v1/lineas/${uuid(1)}/rutas`]: [
        {
          id: uuid(2), lineaId: uuid(1), sentido: 'ida', estado: 'activo', publicStatus: 'borrador', publishedAt: null,
          geometria: { type: 'LineString', coordinates: [[-66.2, -17.4], [-66.1, -17.3]] },
        },
      ],
      [`/v1/rutas/${uuid(2)}/puntos-control`]: [
        {
          id: PC, rutaId: uuid(2), orden: 1, coord: { type: 'Point', coordinates: [-66.2, -17.4] }, radioToleranciaM: 50,
          obligatorio: true, estado: 'activo', rol: 'terminal', esperaMin: null, frecuenciaSalidaMin: 8,
        },
      ],
      [`/v1/salidas/${PC}/fila`]: {
        puntoControlId: PC, baseMin: 8, servidorTs: ahora.toISOString(), salidasRecientes: [],
        items: [item(1, '1234ABC', true), item(2, '5678XYZ', false)],
      },
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/vehiculos': [],
      '/v1/grupos-vehiculo': [],
    };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    let puts = 0;
    try {
      await page.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (path === `/v1/salidas/${PC}/base` && req.method() === 'PUT') {
          puts++;
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        }
        if (req.method() === 'GET' && path in respuestas) {
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respuestas[path]) });
        }
        return route.fallback();
      });
      await page.goto('/salidas', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const mas = page.getByRole('button', { name: 'Sumar un minuto' });
      await expect(mas).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.qv-base-rapida__valor')).toContainText('8');
      for (const name of ['Restar un minuto', 'Sumar un minuto', 'Guardar']) {
        const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.width, name).toBeGreaterThanOrEqual(44);
        expect(box.height, name).toBeGreaterThanOrEqual(44);
      }

      // Cambiar el valor habilita Guardar; la confirmación avisa que es permanente y se cancela sin guardar.
      await mas.click();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      const dialogo = page.getByRole('alertdialog');
      await expect(dialogo).toContainText('permanente');
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo).toBeHidden();
      expect(puts).toBe(0);

      const viewport = page.viewportSize()!;
      const despachar = page.getByRole('button', { name: /^Despachar / });
      await expect(despachar).toHaveCount(2);
      for (const i of [0, 1]) {
        const box = (await despachar.nth(i).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThan(viewport.width * 0.6);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
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

  test('inputs >= 16 px (iOS no hace zoom) y base 16 px', async () => {
    await page.goto('/vehiculos', { waitUntil: 'networkidle', timeout: 60_000 });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('16px');
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
    const tabbar = page.getByRole('navigation', { name: 'Pestañas', exact: true });
    await expect(tabbar).toBeVisible();
    const tabbarBox = (await tabbar.boundingBox())!;
    const barraBox = (await barra.boundingBox())!;
    expect(barraBox.y + barraBox.height, 'la barra de mando no debe pisar la tabbar').toBeLessThanOrEqual(tabbarBox.y + 1);
    const shellBox = (await page.locator('.qv-live-standalone-shell').boundingBox())!;
    expect(shellBox.y + shellBox.height, 'la pantalla En vivo no debe pisar la tabbar').toBeLessThanOrEqual(tabbarBox.y + 1);
    await expect(page.locator('.qv-live-barra__salir')).toBeHidden(); // Salir/Panel viven en Más y Hoy
    await tabbar.getByRole('button', { name: 'Más' }).click();
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect((await barra.boundingBox())!.height).toBeLessThanOrEqual(120); // 2 filas: ~112 px medidos a 412 px con base de 16 px
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

  test('Alertas: la pestaña navega, tarjetas con acciones >= 44 px y sin overflow', async () => {
    test.setTimeout(90_000);
    const base = {
      sindicatoId: '00000000-0000-4000-8000-0000000000a1', vehiculoId: '00000000-0000-4000-8000-0000000000b1',
      conductorId: '00000000-0000-4000-8000-0000000000c1', lineaId: '00000000-0000-4000-8000-0000000000d1',
      rutaId: '00000000-0000-4000-8000-0000000000e1', reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      vehiculoPlaca: '4701EHA', conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16',
    };
    const filas = [
      { ...base, id: '00000000-0000-4000-8000-000000000001', sesionId: '00000000-0000-4000-8000-0000000000f1', tipo: 'desvio_ruta', gravedad: 'gravisima', estado: 'abierta', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 } },
      { ...base, id: '00000000-0000-4000-8000-000000000002', sesionId: '00000000-0000-4000-8000-0000000000f2', vehiculoPlaca: '1616PIL', tipo: 'pc_omitido', gravedad: 'leve', estado: 'abierta', inicioTs: new Date().toISOString(), detalle: { puntoControlId: 'x', orden: 6 } },
      { ...base, id: '00000000-0000-4000-8000-000000000003', sesionId: '00000000-0000-4000-8000-0000000000f3', vehiculoPlaca: '5163NCF', tipo: 'desvio_ruta', gravedad: 'grave', estado: 'atendida', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 } },
    ];
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: filas }));
    try {
      await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
      await page.getByRole('navigation', { name: 'Pestañas', exact: true }).getByRole('link', { name: 'Alertas' }).click();
      await expect(page).toHaveURL(/\/alertas\/?$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Alertas', level: 1 })).toBeVisible();
      const cards = page.locator('.qv-alertas__card');
      await expect(cards).toHaveCount(2); // filtro por defecto: Abiertas
      await expect(page.getByRole('button', { name: /Atendidas/ })).toContainText('1');
      for (const btn of await cards.first().locator('.qv-alertas__acciones').locator('a, button').all()) {
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(cards.first().getByRole('button', { name: 'Atender' })).toBeVisible();
      await expect(cards.first().getByRole('button', { name: 'Sancionar' })).toBeVisible();
      await page.getByRole('button', { name: /Todas/ }).click();
      await expect(cards).toHaveCount(3);
      await expect(page.getByRole('link', { name: /Sanciones pendientes/ })).toHaveAttribute('href', '/reglas');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
    }
  });

  test('Alertas: estado vacío por filtro (por defecto Abiertas)', async () => {
    test.setTimeout(60_000);
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: [] }));
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      await expect(page.getByText('Sin alertas abiertas')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Atendidas/ }).click();
      await expect(page.getByText('Sin alertas atendidas')).toBeVisible();
      await page.getByRole('button', { name: /Todas/ }).click();
      await expect(page.getByText('Sin alertas hoy')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
    }
  });

  test('Alertas: Atender libera la tarjeta sin esperar el refresco; un 409 deja el mensaje a nivel de página', async () => {
    test.setTimeout(90_000);
    const id = '00000000-0000-4000-8000-000000000001';
    const alerta = {
      sindicatoId: id, vehiculoId: id, conductorId: id, lineaId: id, rutaId: id, reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(), id, sesionId: id,
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '4701EHA',
      conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    let lista: unknown[] = [alerta];
    let retenido: Promise<void> | null = null;
    let patches = 0;
    let status = 200;
    await page.route('**/v1/reportes/en-vivo/infracciones*', async (r) => {
      if (retenido) await retenido;
      await r.fulfill({ json: lista });
    });
    await page.route('**/v1/infracciones/*', async (r) => {
      patches += 1;
      await (status === 200
        ? r.fulfill({ json: { ...alerta, estado: 'atendida' } })
        : r.fulfill({ status, json: { message: 'La infracción ya fue cerrada' } }));
    });
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      await expect(page.locator('.qv-alertas__card')).toHaveCount(1);
      // El refresco queda retenido: la tarjeta sale igual (resultado local) y el foco va al mensaje vacío.
      let soltar!: () => void;
      retenido = new Promise<void>((res) => (soltar = res));
      await page.getByRole('button', { name: 'Atender alerta 4701EHA' }).click();
      await expect(page.locator('.qv-alertas__vacio')).toBeFocused({ timeout: 5_000 });
      expect(patches).toBe(1);
      lista = [{ ...alerta, estado: 'atendida' }];
      soltar();
      retenido = null;

      // 409: otro operador la cerró; tras el refresco la tarjeta ya no está y el mensaje sigue visible.
      lista = [alerta];
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('.qv-alertas__card')).toHaveCount(1);
      status = 409;
      lista = [{ ...alerta, estado: 'atendida' }];
      await page.getByRole('button', { name: 'Atender alerta 4701EHA' }).click();
      await expect(page.locator('.qv-alertas__card')).toHaveCount(0);
      const banner = page.getByRole('alert').filter({ hasText: '4701EHA: La infracción ya fue cerrada' });
      await expect(banner).toBeVisible();
      await banner.getByRole('button', { name: 'Cerrar' }).click();
      await expect(banner).toHaveCount(0);
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.unroute('**/v1/infracciones/*');
    }
  });

  test('Alertas: con filtro Todas, atender y descartar encadenados sacan la tarjeta al instante y el foco no cae a <body>', async () => {
    test.setTimeout(90_000);
    const id = '00000000-0000-4000-8000-000000000001';
    const alerta = {
      sindicatoId: id, vehiculoId: id, conductorId: id, lineaId: id, rutaId: id, reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(), id, sesionId: id,
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '4701EHA',
      conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    let soltar!: () => void;
    let retenido: Promise<void> | null = null;
    await page.route('**/v1/reportes/en-vivo/infracciones*', async (r) => {
      if (retenido) await retenido;
      await r.fulfill({ json: [alerta] });
    });
    await page.route('**/v1/infracciones/*', (r) =>
      r.fulfill({ json: { ...alerta, estado: r.request().postDataJSON().accion === 'atender' ? 'atendida' : 'descartada' } }),
    );
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      await page.getByRole('button', { name: /^Todas/ }).click();
      retenido = new Promise<void>((res) => (soltar = res));
      // Atender y luego descartar antes de que llegue el refresco: el servidor sigue en `abierta`, la superposición debe seguir aplicando.
      await page.getByRole('button', { name: 'Atender alerta 4701EHA' }).click();
      await expect(page.locator('.qv-alertas__card')).toContainText('Atendida');
      await page.getByRole('button', { name: 'Descartar alerta 4701EHA' }).click();
      await page.getByLabel('Motivo del descarte (opcional)').fill('prueba');
      await page.locator('.qv-alertas__card').getByRole('button', { name: 'Descartar', exact: true }).click();
      // Descartada no se lista: la tarjeta sale en el mismo render (refresco aún retenido) y el foco va al mensaje vacío.
      await expect(page.locator('.qv-alertas__card')).toHaveCount(0);
      await expect(page.locator('.qv-alertas__vacio')).toBeFocused({ timeout: 5_000 });
      soltar();
      retenido = null;
    } finally {
      soltar?.();
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.unroute('**/v1/infracciones/*');
    }
  });

  test('Alertas: descartar tras llegar el refresco de la atención saca la tarjeta al instante', async () => {
    test.setTimeout(90_000);
    const id = '00000000-0000-4000-8000-000000000001';
    const alerta = {
      sindicatoId: id, vehiculoId: id, conductorId: id, lineaId: id, rutaId: id, reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(), id, sesionId: id,
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '4701EHA',
      conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    let soltar!: () => void;
    let retenido: Promise<void> | null = null;
    let estadoServidor = 'abierta';
    await page.route('**/v1/reportes/en-vivo/infracciones*', async (r) => {
      if (retenido) await retenido;
      await r.fulfill({ json: [{ ...alerta, estado: estadoServidor }] });
    });
    await page.route('**/v1/infracciones/*', (r) => {
      estadoServidor = r.request().postDataJSON().accion === 'atender' ? 'atendida' : 'descartada';
      return r.fulfill({ json: { ...alerta, estado: estadoServidor } });
    });
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      await page.getByRole('button', { name: /^Todas/ }).click();
      const refresco = page.waitForResponse((r) => r.url().includes('/v1/reportes/en-vivo/infracciones') && r.request().method() === 'GET');
      await page.getByRole('button', { name: 'Atender alerta 4701EHA' }).click();
      await refresco;
      // Margen para que React Query aplique la respuesta: la caché ya dice `atendida` antes de descartar.
      await page.waitForTimeout(500);
      await expect(page.locator('.qv-alertas__card')).toContainText('Atendida');
      retenido = new Promise<void>((res) => (soltar = res));
      await page.getByRole('button', { name: 'Descartar alerta 4701EHA' }).click();
      await page.getByLabel('Motivo del descarte (opcional)').fill('prueba');
      await page.locator('.qv-alertas__card').getByRole('button', { name: 'Descartar', exact: true }).click();
      await expect(page.locator('.qv-alertas__card')).toHaveCount(0);
      await expect(page.locator('.qv-alertas__vacio')).toBeFocused({ timeout: 5_000 });
      soltar();
      retenido = null;
    } finally {
      soltar?.();
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.unroute('**/v1/infracciones/*');
    }
  });

  test('En vivo: el aviso de "Ver en mapa" se ve aunque no haya HUD (sin posiciones y con error)', async () => {
    test.setTimeout(90_000);
    const vehiculo = '00000000-0000-4000-8000-0000000000ff';
    try {
      await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [] }));
      await page.goto(`/en-vivo?vehiculo=${vehiculo}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const aviso = page.getByText('Ese vehículo no tiene posición hoy');
      await expect(aviso).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/en-vivo$/);
      // visible != no tapado: el aviso debe quedar por encima de la capa del estado vacío (z-index).
      const encima = () => aviso.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      expect(await encima()).toBe(true);
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');

      // Todos los intentos fallan (los reintentos tardan ~15 s): sin datos tampoco hay HUD.
      await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ status: 500, json: { message: 'boom' } }));
      await page.goto(`/en-vivo?vehiculo=${vehiculo}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByText('No se pudo abrir el vehículo')).toBeVisible({ timeout: 60_000 });
      await expect(page).toHaveURL(/\/en-vivo$/);
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');
    }
  });

  test('En vivo: el resumen cuenta las alertas abiertas de hoy aunque /posiciones no las traiga', async () => {
    test.setTimeout(90_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const pos = {
      id: id(1), deviceId: 'd1', activa: true, vehiculoPlaca: '1616PIL', conductorNombre: 'X', lineaId: id(4), lineaNombre: 'Línea 16',
      rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura: 'reportando',
      vehiculoId: id(2), infraccionesAbiertas: 0,
    };
    // Las 3 alertas son de OTRA sesión del vehículo: la ganadora de /posiciones dice 0.
    const alerta = (n: number) => ({
      sindicatoId: id(1), vehiculoId: id(2), conductorId: id(3), lineaId: id(4), rutaId: id(5), reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(100 + n), sesionId: id(200 + n), tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(),
      vehiculoPlaca: '1616PIL', conductorNombre: 'X', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    });
    let hoy: unknown[] = [alerta(1), alerta(2), alerta(3)];
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: hoy }));
    try {
      await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const barra = page.getByLabel('Barra de mando de En vivo');
      await expect(barra).toContainText('3 alertas abiertas', { timeout: 30_000 });
      await expect(barra).not.toContainText('Sin infracciones abiertas');
      await expect(barra.getByRole('link', { name: 'Ver alertas' })).toHaveAttribute('href', '/alertas');
      await expect(barra.getByRole('button', { name: 'Siguiente alerta' })).toHaveCount(0);

      // Con alertas abiertas la campana no es verde (el verde es "todo en orden").
      const colores = await barra.locator('.qv-live-alertas__vacio svg').evaluate((el) => {
        const sonda = document.createElement('i');
        sonda.style.color = 'var(--qv-color-success)';
        document.body.appendChild(sonda);
        const exito = getComputedStyle(sonda).color;
        sonda.remove();
        return { icono: getComputedStyle(el).color, exito };
      });
      expect(colores.icono).not.toBe(colores.exito);

      hoy = [];
      await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(barra).toContainText('Sin infracciones abiertas', { timeout: 30_000 });
      await expect(barra.getByRole('link', { name: 'Ver alertas' })).toHaveCount(0);

      // Sin datos y con la consulta fallando (reintentos ~15 s) no queda un grupo vacío.
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ status: 500, json: { message: 'x' } }));
      await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(barra).toContainText('Alertas del día sin cargar', { timeout: 40_000 });
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
    }
  });

  test('Alertas: "Ver en mapa" abre el vehículo de la sesión en En vivo una sola vez', async () => {
    test.setTimeout(90_000);
    const sesionId = '00000000-0000-4000-8000-0000000000f1';
    const vehiculoId = '00000000-0000-4000-8000-0000000000e1';
    const pos = {
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '4701EHA', conductorNombre: 'Bravo Soliz J.',
      lineaId: '00000000-0000-4000-8000-0000000000d1', lineaNombre: 'Línea 16', rutaSentido: 'ida',
      lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura: 'reportando',
      vehiculoId,
    };
    // La alerta es de OTRA sesión del mismo vehículo: /posiciones solo trae la ganadora (`sesionId`).
    const sesionAlerta = '00000000-0000-4000-8000-0000000000f2';
    const alerta = {
      sindicatoId: sesionId, vehiculoId, conductorId: sesionId, lineaId: sesionId, rutaId: sesionId, reglaId: null,
      finTs: null, lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null,
      createdAt: new Date().toISOString(), id: '00000000-0000-4000-8000-000000000001', sesionId: sesionAlerta, tipo: 'desvio_ruta',
      gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '4701EHA',
      conductorNombre: 'Bravo Soliz J.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: [alerta] }));
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      const ver = page.getByRole('link', { name: 'Ver en mapa 4701EHA' });
      await expect(ver).toHaveAttribute('href', `/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionAlerta}`);
      await ver.click();
      const panel = page.getByLabel('Detalle del vehículo 4701EHA');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      // La alerta es de otra sesión que la ganadora: se avisa.
      await expect(page.getByText('Esa alerta es de otra sesión de este vehículo; no aparece en este panel')).toBeVisible();
      // El parámetro se consume: recargar o volver atrás no reabre el panel.
      await expect(page).toHaveURL(/\/en-vivo$/);
      await page.getByRole('button', { name: 'Cerrar detalle del vehículo' }).click();
      await expect(panel).toHaveCount(0);
      // Una sola vez: el siguiente poll de posiciones no lo reabre.
      await page.waitForTimeout(2_500);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(1_000);
      await expect(panel).toHaveCount(0);
      // Vehículo que no está en las posiciones de hoy: sin panel, con aviso, y el parámetro también se consume.
      await page.goto('/en-vivo?vehiculo=00000000-0000-4000-8000-0000000000ff', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByLabel('Barra de mando de En vivo')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1_500);
      await expect(page.getByLabel(/Detalle del vehículo/)).toHaveCount(0);
      await expect(page).toHaveURL(/\/en-vivo$/);
      await expect(page.getByText('Ese vehículo no tiene posición hoy')).toBeVisible();
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
    }
  });

  test('Hoy: 4 KPIs con números mockeados, búsqueda de placa con tel: y sin overflow', async () => {
    test.setTimeout(90_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const pos = (n: number, estadoFrescura: string) => ({ id: id(n), estadoFrescura, vehiculoPlaca: `P${n}` });
    const infra = (n: number, gravedad: string, estado: string) => ({
      sindicatoId: id(1), vehiculoId: id(2), conductorId: id(3), lineaId: id(4), rutaId: id(5), reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(100 + n), sesionId: id(200 + n), gravedad, estado, tipo: 'desvio_ruta', vehiculoPlaca: `P${n}`,
      conductorNombre: 'X', lineaNombre: 'Línea 16', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 },
    });
    const rutas: [string, unknown][] = [
      ['**/v1/reportes/en-vivo/posiciones*', [pos(1, 'reportando'), pos(2, 'detenido'), pos(3, 'finalizado'), pos(4, 'inactivo'), pos(5, 'inactivo')]],
      ['**/v1/reportes/en-vivo/infracciones*', [infra(1, 'grave', 'abierta'), infra(2, 'leve', 'abierta'), infra(3, 'leve', 'abierta'), infra(4, 'grave', 'atendida')]],
      ['**/v1/sanciones*', [{ id: id(1) }, { id: id(2) }, { id: id(3) }, { id: id(4) }]],
      ['**/v1/reportes/jornadas*', { fecha: '2026-11-05', vehiculos: [{ vehiculoId: id(7), placa: '4701EHA', conductorId: id(9), conductorNombre: 'José Bravo', lineaNombre: 'Línea 16', estado: 'en_recorrido' }] }],
      ['**/v1/vehiculos*', [{ id: id(7), placa: '4701EHA' }, { id: id(8), placa: '1616PIL' }]],
      ['**/v1/conductores*', [{ id: id(9), nombre: 'José Bravo', telefono: '71234567', estado: 'activo' }]],
    ];
    for (const [patron, json] of rutas) await page.route(patron, (r) => r.fulfill({ json }));
    try {
      await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
      const kpi = (nombre: string) => page.locator('.qv-hoy__kpi', { hasText: nombre });
      await expect(kpi('En servicio')).toContainText('2');
      await expect(kpi('En servicio')).toContainText('de 5 en flota');
      await expect(kpi('Inactivos')).toContainText('2');
      await expect(kpi('Alertas abiertas')).toContainText('3');
      await expect(kpi('Alertas abiertas')).toContainText('1 grave');
      await expect(kpi('Alertas abiertas')).toHaveAttribute('href', '/alertas');
      await expect(kpi('Sanciones pendientes')).toContainText('4');
      await expect(kpi('Sanciones pendientes')).toHaveAttribute('href', '/reglas');
      await expect(page.locator('.qv-live-pill')).toContainText('En vivo');
      await expect(page.getByRole('navigation', { name: 'Pestañas', exact: true }).locator('.qv-tabbar__badge')).toHaveText('3');

      await page.getByLabel('Buscar placa o conductor').fill('4701 eh');
      const resultado = page.locator('.qv-hoy__resultado');
      await expect(resultado).toHaveCount(1);
      await expect(resultado).toContainText('Línea 16 · José Bravo');
      await expect(resultado.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+59171234567');
      await expect(resultado.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/59171234567');
      for (const btn of await resultado.locator('a').all()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // Un vehículo sin conductor de hoy no muestra botones de contacto.
      await page.getByLabel('Buscar placa o conductor').fill('1616');
      await expect(resultado).toHaveCount(1);
      await expect(resultado.getByRole('link')).toHaveCount(0);
    } finally {
      for (const [patron] of rutas) await page.unroute(patron);
    }
  });

  test('Hoy: Reintentar mantiene el banner mientras recarga y lo quita al lograr', async () => {
    test.setTimeout(90_000);
    let falla = true;
    let liberar!: () => void;
    const retenido = new Promise<void>((res) => (liberar = res));
    const rutas: [string, unknown][] = [
      ['**/v1/reportes/en-vivo/posiciones*', []],
      ['**/v1/reportes/en-vivo/infracciones*', []],
    ];
    for (const [patron, json] of rutas) await page.route(patron, (r) => r.fulfill({ json }));
    await page.route('**/v1/sanciones*', async (r) => {
      if (falla) return r.fulfill({ status: 500, json: { message: 'boom' } });
      await retenido;
      return r.fulfill({ json: [] });
    });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const banner = page.getByRole('alert').filter({ hasText: 'No se pudo cargar' });
      await expect(banner).toBeVisible({ timeout: 30_000 });
      falla = false;
      const boton = page.getByRole('button', { name: 'Reintentar' });
      await boton.click();
      // Con la petición retenida el banner y el botón siguen montados, deshabilitados.
      const enCurso = page.getByRole('button', { name: 'Reintentando…' });
      await expect(enCurso).toBeDisabled();
      await expect(banner).toBeVisible();
      liberar();
      await expect(enCurso).toHaveCount(0);
      await expect(banner).toHaveCount(0);
    } finally {
      liberar();
      for (const [patron] of rutas) await page.unroute(patron);
      await page.unroute('**/v1/sanciones*');
    }
  });
});
