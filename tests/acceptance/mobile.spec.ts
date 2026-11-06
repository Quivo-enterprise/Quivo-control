import { devices, expect, test, type Page } from '@playwright/test';
import { EstadoFilaSalidaPanelSchema } from '../../packages/shared/src/entities/fila-salida';
import { InfraccionHoySchema } from '../../packages/shared/src/entities/infraccion';
import { PosicionEnVivoSchema } from '../../packages/shared/src/entities/en-vivo';
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
    test.setTimeout(120_000);
    // API mockeada (formas validadas contra @quivo/shared): una terminal, base 8 min, fila de 3 trufis, 8 salidas recientes.
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
      etaTs: iso(habilitado ? 0 : 3 * n),
      esperaMs: 0,
      estado: 'en_fila',
      habilitado,
      demorado: false,
      anticipada: false,
    });
    const recientes = Array.from({ length: 8 }, (_, k) => ({
      id: uuid(40 + k),
      vehiculoId: uuid(60 + k),
      placa: `90${k}0ZZZ`,
      llegadaTs: iso(-60 - k * 8),
      salidaTs: iso(-50 - k * 8),
      salidaOrigen: 'boton',
      anticipada: k === 1,
    }));
    const fila = EstadoFilaSalidaPanelSchema.parse({
      puntoControlId: PC,
      baseMin: 8,
      servidorTs: ahora.toISOString(),
      salidasRecientes: recientes,
      // 1: aún no habilitado (salida anticipada); 2: no habilitado; 3: habilitado (despacho directo desde el menú).
      items: [item(1, '1234ABC', false), item(2, '5678XYZ', false), item(3, '4321QWE', true)],
    });
    // El conductor sale de /reportes/en-vivo/posiciones (la leen admin y operador); /reportes/jornadas es solo admin.
    const posiciones = [
      PosicionEnVivoSchema.parse({
        id: uuid(80), deviceId: 'd1', activa: true, vehiculoPlaca: '1234ABC', conductorNombre: 'Bravo Soliz Javier',
        lineaId: uuid(1), lineaNombre: 'Linea 120', rutaSentido: 'ida', lat: -17.4, lng: -66.2, accuracy: 5, speed: 0,
        totalPuntos: 3, vehiculoId: uuid(21), ultimoFixTs: iso(0), ultimoIngresoTs: iso(0), servidorTs: iso(0),
        antiguedadFixMs: 4000, antiguedadIngestaMs: 4000, inactivaDesdeMs: 4000, estadoFrescura: 'reportando', recorridoFinTs: null,
      }),
    ];
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
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/reportes/en-vivo/posiciones': posiciones,
      '/v1/vehiculos': [],
      '/v1/grupos-vehiculo': [],
    };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    let puts = 0;
    const posts: string[] = [];
    const retirados = new Set<string>();
    try {
      await page.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (path === `/v1/salidas/${PC}/base` && req.method() === 'PUT') {
          puts++;
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        }
        if (req.method() === 'GET' && path === `/v1/salidas/${PC}/fila`) {
          const items = fila.items.filter((x) => !retirados.has(x.id));
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...fila, items }) });
        }
        if (req.method() === 'POST' && path.startsWith(`/v1/salidas/${PC}/fila/`)) {
          posts.push(path.replace(`/v1/salidas/${PC}/fila/`, ''));
          if (path.endsWith('/retirar')) retirados.add(path.split('/').at(-2)!);
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
      // Encabezado: nombre de la terminal + conteo de la fila (la etiqueta ya trae la línea).
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('120 · ida · punto 1');
      await expect(page.locator('.qv-page-header__subtitle')).toHaveText('3 en fila');
      for (const name of ['Restar un minuto', 'Sumar un minuto', 'Guardar']) {
        const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(box.width, name).toBeGreaterThanOrEqual(44);
        expect(box.height, name).toBeGreaterThanOrEqual(44);
      }
      // Guardar en la misma fila que − y +; sin cambios está deshabilitado.
      const guardar = page.getByRole('button', { name: 'Guardar', exact: true });
      await expect(guardar).toBeDisabled();
      const [bMenos, bGuardar] = await Promise.all([
        page.getByRole('button', { name: 'Restar un minuto' }).boundingBox(),
        guardar.boundingBox(),
      ]);
      expect(Math.abs(bMenos!.y - bGuardar!.y)).toBeLessThan(8);

      // Cambiar el valor habilita Guardar; la confirmación avisa que es permanente y se cancela sin guardar.
      await mas.click();
      await guardar.click();
      const dialogo = page.getByRole('alertdialog');
      await expect(dialogo).toContainText('permanente');
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo).toBeHidden();
      expect(puts).toBe(0);

      // Fila: conductor por vehículo (posiciones en vivo), estado de la cola con su hora de salida, y Despachar solo en la primera, a todo el ancho y de 60 px.
      await expect(page.getByText('Bravo Soliz Javier')).toBeVisible();
      await expect(page.locator('.qv-fila-m__estado').first()).toContainText('Sale ');
      await expect(page.locator('.qv-fila-m__estado').nth(2)).toContainText('En turno');
      await expect(page.locator('.qv-fila-m__estado').first()).toContainText('Esperando');
      await expect(page.getByText('Rige cuando ninguna regla del día aplica')).toBeVisible();
      const viewport = page.viewportSize()!;
      const despachar = page.getByRole('button', { name: /^Despachar / });
      await expect(despachar).toHaveCount(1);
      const boxD = (await despachar.boundingBox())!;
      expect(boxD.height).toBeGreaterThanOrEqual(59.5);
      expect(boxD.width).toBeGreaterThan(viewport.width * 0.8);

      // Despacho anticipado: pide confirmación y solo despacha al confirmar.
      await despachar.click();
      await expect(dialogo).toContainText('todavía no está habilitado');
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo).toBeHidden();
      expect(posts).toEqual([]);
      await despachar.click();
      await dialogo.getByRole('button', { name: 'Despachar', exact: true }).click();
      await expect.poll(() => posts).toEqual([`${uuid(11)}/despachar`]);

      // Menú ⋮ por teclado (fila 2): Enter abre y enfoca el primer ítem, flechas se mueven, Escape devuelve el foco.
      const kb2 = page.getByRole('button', { name: 'Más acciones de 5678XYZ' });
      await expect(kb2).toHaveAttribute('aria-haspopup', 'menu');
      await expect(kb2).toHaveAttribute('aria-expanded', 'false');
      const kbBox = (await kb2.boundingBox())!;
      expect(kbBox.width).toBeGreaterThanOrEqual(48);
      expect(kbBox.height).toBeGreaterThanOrEqual(48);
      await kb2.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', { name: 'Acciones de 5678XYZ' });
      await expect(menu).toBeVisible();
      await expect(kb2).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.getByRole('menuitem', { name: 'Despachar' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'Al final' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'Retirar' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'Despachar' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(kb2).toBeFocused();
      await expect(kb2).toHaveAttribute('aria-expanded', 'false');

      // Clic afuera cierra; Tab cierra y deja el foco en el ⋮.
      await kb2.click();
      await expect(menu).toBeVisible();
      await page.getByRole('heading', { level: 1 }).click();
      await expect(menu).toBeHidden();
      await kb2.click();
      await page.keyboard.press('Tab');
      await expect(menu).toBeHidden();

      // "Al final" y "Retirar" abren sus confirmaciones; cancelar devuelve el foco al ⋮.
      await kb2.click();
      await menu.getByRole('menuitem', { name: 'Al final' }).click();
      await expect(dialogo).toContainText('pasa al último lugar');
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(kb2).toBeFocused();
      await kb2.click();
      await menu.getByRole('menuitem', { name: 'Retirar' }).click();
      await expect(dialogo).toContainText('sale de la fila sin registrarse');
      await dialogo.getByRole('button', { name: 'Retirar', exact: true }).click();
      await expect.poll(() => posts).toEqual([`${uuid(11)}/despachar`, `${uuid(12)}/retirar`]);
      // La fila retirada desaparece: el foco pasa al ⋮ de la que ocupa su lugar, no a <body>.
      await expect(page.getByRole('button', { name: 'Más acciones de 5678XYZ' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Más acciones de 4321QWE' })).toBeFocused();

      // Fila 3 está habilitada: Despachar desde el menú va directo, sin confirmación.
      await page.getByRole('button', { name: 'Más acciones de 4321QWE' }).click();
      await page.getByRole('menu', { name: 'Acciones de 4321QWE' }).getByRole('menuitem', { name: 'Despachar' }).click();
      await expect(dialogo).toBeHidden();
      await expect.poll(() => posts).toEqual([`${uuid(11)}/despachar`, `${uuid(12)}/retirar`, `${uuid(13)}/despachar`]);
      // El menú se cerró al elegir: el foco vive en el ⋮ de la fila (no en <body>), también tras terminar la acción.
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Más acciones de 4321QWE');

      // Salidas recientes: plegado de entrada, con el conteo; se despliega a pedido.
      const coll = page.getByRole('button', { name: /Salidas recientes/ });
      await expect(coll).toHaveAttribute('aria-expanded', 'false');
      await expect(coll).toContainText('8');
      await expect(page.locator('.qv-fila-m__rec')).toHaveCount(8);
      await expect(page.locator('.qv-fila-m__rec').first()).toBeHidden();
      await coll.click();
      await expect(coll).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.qv-fila-m__rec').first()).toBeVisible();

      // Sin desborde horizontal a 412 y a 360 px.
      for (const width of [viewport.width, 360]) {
        await page.setViewportSize({ width, height: viewport.height });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), { message: `desborda a ${width}` }).toBe(true);
      }
    } finally {
      await page.setViewportSize({ width: 412, height: 915 }); // Pixel 7
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('Salidas: progreso visible, menú anclado, foco y cuenta vencida', async () => {
    test.setTimeout(120_000);
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const PC = uuid(3);
    const ahora = new Date();
    const iso = (min: number) => new Date(ahora.getTime() + min * 60_000).toISOString();
    // Fila 1 con hora de salida ya vencida (cuenta en color de aviso) y no habilitada (Despachar pide confirmación).
    const item = (n: number, placa: string, eta: number) => ({
      id: uuid(10 + n), vehiculoId: uuid(20 + n), placa, posicion: n, llegadaTs: iso(-10), etaTs: iso(eta),
      esperaMs: 0, estado: 'en_fila', habilitado: false, demorado: false, anticipada: false,
    });
    const todos = [item(1, '1234ABC', -2), item(2, '5678XYZ', 6), item(3, '4321QWE', 12)];
    let visibles = [...todos];
    const posiciones = [
      PosicionEnVivoSchema.parse({
        id: uuid(80), deviceId: 'd1', activa: true, vehiculoPlaca: '1234ABC', conductorNombre: 'Bravo Soliz Javier',
        lineaId: uuid(1), lineaNombre: 'Linea 120', rutaSentido: 'ida', lat: -17.4, lng: -66.2, accuracy: 5, speed: 0,
        totalPuntos: 3, vehiculoId: uuid(21), ultimoFixTs: iso(0), ultimoIngresoTs: iso(0), servidorTs: iso(0),
        antiguedadFixMs: 4000, antiguedadIngestaMs: 4000, inactivaDesdeMs: 4000, estadoFrescura: 'reportando', recorridoFinTs: null,
      }),
    ];
    const respuestas: Record<string, unknown> = {
      '/v1/lineas': [{ id: uuid(1), sindicatoId: uuid(99), codigo: '120', nombre: 'Linea 120', color: null, colorSecundario: null, colorTexto: null, nombreCorto: 'Expreso Tiquipaya Cercado Norte', lema: null, descripcion: null, publicStatus: 'borrador', publishedAt: null }],
      [`/v1/lineas/${uuid(1)}/rutas`]: [{ id: uuid(2), lineaId: uuid(1), sentido: 'ida', estado: 'activo', publicStatus: 'borrador', publishedAt: null, geometria: { type: 'LineString', coordinates: [[-66.2, -17.4], [-66.1, -17.3]] } }],
      [`/v1/rutas/${uuid(2)}/puntos-control`]: [{ id: PC, rutaId: uuid(2), orden: 1, coord: { type: 'Point', coordinates: [-66.2, -17.4] }, radioToleranciaM: 50, obligatorio: true, estado: 'activo', rol: 'terminal', esperaMin: null, frecuenciaSalidaMin: 8 }],
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/reportes/en-vivo/posiciones': posiciones,
      '/v1/vehiculos': [],
      '/v1/grupos-vehiculo': [],
    };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    let soltar!: () => void;
    const compuerta = new Promise<void>((r) => (soltar = r));
    try {
      await page.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (req.method() === 'GET' && path === `/v1/salidas/${PC}/fila`) {
          const fila = EstadoFilaSalidaPanelSchema.parse({ puntoControlId: PC, baseMin: 8, servidorTs: new Date().toISOString(), salidasRecientes: [], items: visibles });
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fila) });
        }
        if (req.method() === 'POST' && path.endsWith('/retirar')) {
          await compuerta; // la acción queda "en vuelo" hasta que el test la suelte
          visibles = visibles.filter((x) => x.id !== path.split('/').at(-2));
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        }
        if (req.method() === 'GET' && path in respuestas) {
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respuestas[path]) });
        }
        return route.fallback();
      });
      await page.goto('/salidas', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const kb = (placa: string) => page.getByRole('button', { name: `Más acciones de ${placa}` });
      const menuDe = (placa: string) => page.getByRole('menu', { name: `Acciones de ${placa}` });
      const dialogo = page.getByRole('alertdialog');
      await expect(kb('1234ABC')).toBeVisible({ timeout: 30_000 });

      // Título de una sola línea con puntos suspensivos a 360 px (etiqueta larga): el encabezado sticky no cambia de alto.
      await page.setViewportSize({ width: 360, height: 915 });
      const titulo = page.getByRole('heading', { level: 1 });
      await expect(titulo).toHaveText('Expreso Tiquipaya Cercado Norte · ida · punto 1');
      const medida = await titulo.evaluate((e) => ({ alto: e.getBoundingClientRect().height, corte: e.scrollWidth > e.clientWidth }));
      expect(medida.corte).toBe(true);
      expect(medida.alto).toBeLessThan(30);
      await page.setViewportSize({ width: 412, height: 915 });

      // Número de posición con texto oculto "Posición " (un aria-label sobre un <span> sin rol no es fiable).
      await expect(page.locator('.qv-fila-m__pos').first()).toHaveText('Posición 1');

      // Cuenta vencida: color de texto de aviso (legible), no el --qv-color-warning de escritorio.
      const colores = await page.evaluate(() => {
        const de = (v: string) => {
          const d = document.createElement('i');
          d.style.color = `var(${v})`;
          document.body.append(d);
          const c = getComputedStyle(d).color;
          d.remove();
          return c;
        };
        return {
          cuenta: getComputedStyle(document.querySelector('.qv-fila-m__cuenta--grande span')!).color,
          texto: de('--qv-color-warning-texto'),
          aviso: de('--qv-color-warning'),
        };
      });
      expect(colores.cuenta).toBe(colores.texto);
      expect(colores.cuenta).not.toBe(colores.aviso);

      // Menú de la fila 1 (la más alta, con conductor): se abre justo bajo el ⋯, sin tapar el botón y por encima de la fila siguiente.
      await kb('1234ABC').click();
      const menu1 = menuDe('1234ABC');
      await expect(menu1).toBeVisible();
      const [bk, bm] = await Promise.all([kb('1234ABC').boundingBox(), menu1.boundingBox()]);
      expect(bm!.y).toBeGreaterThanOrEqual(bk!.y + bk!.height);
      expect(bm!.y - (bk!.y + bk!.height)).toBeLessThan(12);
      expect(Math.abs(bm!.x + bm!.width - (bk!.x + bk!.width))).toBeLessThan(2);
      const tapado = await menu1.evaluate((m) => {
        const r = m.getBoundingClientRect();
        return !m.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height - 6));
      });
      expect(tapado).toBe(false);
      await page.keyboard.press('Escape');
      await expect(menu1).toBeHidden();

      // Última fila: el menú se abre entero y queda por encima de la barra de pestañas (no oculto tras ella).
      await kb('4321QWE').click();
      const bmU = (await menuDe('4321QWE').boundingBox())!;
      const bTab = (await page.getByRole('navigation', { name: 'Pestañas', exact: true }).boundingBox())!;
      expect(bmU.y + bmU.height).toBeLessThanOrEqual(bTab.y + 1);
      await page.keyboard.press('Escape');

      // Cancelar la confirmación abierta desde el botón Despachar devuelve el foco a Despachar (no al ⋯).
      const despachar = page.getByRole('button', { name: 'Despachar 1234ABC' });
      await despachar.click();
      await expect(dialogo).toBeVisible();
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      await expect(dialogo).toBeHidden();
      await expect(despachar).toBeFocused();

      // El sondeo cambia la fila con el menú abierto (la 2 pasa a ser la 1): el menú se cierra y el foco queda en su ⋯.
      await kb('5678XYZ').click();
      await expect(menuDe('5678XYZ').getByRole('menuitem', { name: 'Despachar' })).toBeFocused();
      visibles = visibles.filter((x) => x.id !== todos[0]!.id);
      await expect(menuDe('5678XYZ')).toBeHidden({ timeout: 15_000 });
      await expect(kb('5678XYZ')).toBeFocused();

      // Acción en curso (retirar con respuesta demorada): texto de progreso en la fila y el ⋯ no abre el menú.
      await kb('4321QWE').click();
      await menuDe('4321QWE').getByRole('menuitem', { name: 'Retirar' }).click();
      await dialogo.getByRole('button', { name: 'Retirar', exact: true }).click();
      const fila3 = page.getByRole('listitem').filter({ has: kb('4321QWE') });
      await expect(fila3.getByRole('status')).toHaveText('Retirando…');
      await expect(kb('4321QWE')).toHaveAttribute('aria-disabled', 'true');
      // Ni un parpadeo: un efecto que cierre el menú después de abrirlo no basta.
      await kb('4321QWE').evaluate((e) => {
        (window as unknown as { __abrio: boolean }).__abrio = false;
        new MutationObserver(() => {
          if (e.getAttribute('aria-expanded') === 'true') (window as unknown as { __abrio: boolean }).__abrio = true;
        }).observe(e, { attributes: true });
      });
      await kb('4321QWE').click({ force: true }); // Playwright trata aria-disabled como deshabilitado
      await kb('4321QWE').focus();
      await page.keyboard.press('ArrowDown');
      await expect(menuDe('4321QWE')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __abrio: boolean }).__abrio)).toBe(false);
      await expect(kb('4321QWE')).toBeFocused();
      soltar();
      await expect(kb('4321QWE')).toHaveCount(0);
    } finally {
      soltar();
      await page.setViewportSize({ width: 412, height: 915 });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('Salidas: región viva en el árbol, despacho de la fila 1, foco sin salto y menú ante fila única', async () => {
    test.setTimeout(120_000);
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const PC = uuid(3);
    const ahora = new Date();
    const iso = (min: number) => new Date(ahora.getTime() + min * 60_000).toISOString();
    // Fila larga (la página scrollea) con la 1 habilitada: Despachar va directo, sin diálogo.
    const placa = (n: number) => `${1000 + n}ABC`;
    const item = (n: number) => ({
      id: uuid(10 + n), vehiculoId: uuid(20 + n), placa: placa(n), posicion: n, llegadaTs: iso(-10), etaTs: iso(n * 6 - 8),
      esperaMs: 0, estado: 'en_fila', habilitado: n === 1, demorado: false, anticipada: false,
    });
    const todos = Array.from({ length: 16 }, (_, i) => item(i + 1));
    let visibles = [...todos];
    const respuestas: Record<string, unknown> = {
      '/v1/lineas': [{ id: uuid(1), sindicatoId: uuid(99), codigo: '120', nombre: 'Linea 120', color: null, colorSecundario: null, colorTexto: null, nombreCorto: 'Expreso Tiquipaya Cercado Norte', lema: null, descripcion: null, publicStatus: 'borrador', publishedAt: null }],
      [`/v1/lineas/${uuid(1)}/rutas`]: [{ id: uuid(2), lineaId: uuid(1), sentido: 'ida', estado: 'activo', publicStatus: 'borrador', publishedAt: null, geometria: { type: 'LineString', coordinates: [[-66.2, -17.4], [-66.1, -17.3]] } }],
      [`/v1/rutas/${uuid(2)}/puntos-control`]: [{ id: PC, rutaId: uuid(2), orden: 1, coord: { type: 'Point', coordinates: [-66.2, -17.4] }, radioToleranciaM: 50, obligatorio: true, estado: 'activo', rol: 'terminal', esperaMin: null, frecuenciaSalidaMin: 8 }],
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/reportes/en-vivo/posiciones': [],
      '/v1/vehiculos': [],
      '/v1/grupos-vehiculo': [],
    };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const puerta = () => {
      let soltar!: () => void;
      const espera = new Promise<void>((r) => (soltar = r));
      return { espera, soltar };
    };
    const despacho = puerta();
    const mover = puerta();
    try {
      await page.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (req.method() === 'GET' && path === `/v1/salidas/${PC}/fila`) {
          const fila = EstadoFilaSalidaPanelSchema.parse({ puntoControlId: PC, baseMin: 8, servidorTs: new Date().toISOString(), salidasRecientes: [], items: visibles });
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fila) });
        }
        if (req.method() === 'POST' && path.startsWith(`/v1/salidas/${PC}/fila/`)) {
          const id = path.split('/').at(-2);
          if (path.endsWith('/despachar')) {
            await despacho.espera;
            visibles = visibles.filter((x) => x.id !== id);
          } else if (path.endsWith('/mover-al-final')) {
            await mover.espera;
            const x = visibles.find((v) => v.id === id)!;
            visibles = [...visibles.filter((v) => v.id !== id), x];
          }
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
        }
        if (req.method() === 'GET' && path in respuestas) {
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respuestas[path]) });
        }
        return route.fallback();
      });
      await page.goto('/salidas', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const kb = (n: number) => page.getByRole('button', { name: `Más acciones de ${placa(n)}` });
      const menuDe = (n: number) => page.getByRole('menu', { name: `Acciones de ${placa(n)}` });
      const dialogo = page.getByRole('alertdialog');
      const filaDe = (n: number) => page.getByRole('listitem').filter({ has: kb(n) });
      await expect(kb(1)).toBeVisible({ timeout: 30_000 });

      // Región viva vacía: sigue en el árbol de accesibilidad (si no, el lector no anuncia el texto al aparecer) y no está en display:none.
      await expect(filaDe(2).getByRole('status')).toHaveCount(1);
      expect(await filaDe(2).locator('.qv-fila-m__progreso').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');

      // Despachar la fila 1 con respuesta demorada: el botón dice "Despachando…", la línea de estado no desaparece (la tarjeta no
      // cambia de alto) y el texto de la región viva queda solo para el lector (no hay un segundo "Despachando…" visible).
      const fila1 = filaDe(1);
      const altoAntes = (await fila1.boundingBox())!.height;
      await page.getByRole('button', { name: `Despachar ${placa(1)}` }).click();
      await expect(page.getByRole('button', { name: `Despachar ${placa(1)}` })).toHaveText('Despachando…');
      await expect(fila1.getByRole('status')).toHaveText('Despachando…');
      await expect(fila1.locator('.qv-fila-m__estado')).toBeVisible();
      expect((await fila1.boundingBox())!.height).toBe(altoAntes);
      const cajaStatus = await fila1.getByRole('status').boundingBox();
      expect(cajaStatus!.width).toBeLessThanOrEqual(1);
      expect(cajaStatus!.height).toBeLessThanOrEqual(1);
      despacho.soltar();
      await expect(kb(1)).toHaveCount(0, { timeout: 15_000 });

      // "Al final" de una fila lejana: mientras la acción vuela el usuario vuelve arriba; al terminar el foco regresa al ⋯
      // sin arrastrar la pantalla de vuelta (focus con preventScroll).
      await kb(10).scrollIntoViewIfNeeded();
      await kb(10).click();
      await menuDe(10).getByRole('menuitem', { name: 'Al final' }).click();
      await dialogo.getByRole('button', { name: 'Mover al final' }).click();
      await expect(filaDe(10).getByRole('status')).toHaveText('Moviendo…');
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      mover.soltar();
      await expect(filaDe(10).getByRole('status')).toHaveText('', { timeout: 15_000 });
      await expect(kb(10)).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      // El sondeo deja un solo trufi con el menú abierto: "Al final" pasa a deshabilitado, el menú se cierra y el foco queda en el ⋯.
      await kb(2).scrollIntoViewIfNeeded();
      await kb(2).click();
      await expect(menuDe(2).getByRole('menuitem', { name: 'Al final' })).toBeFocused();
      visibles = [visibles[0]!];
      await expect(menuDe(2)).toBeHidden({ timeout: 15_000 });
      await expect(kb(2)).toBeFocused();
    } finally {
      despacho.soltar();
      mover.soltar();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('Salidas como operador: no pide /reportes/jornadas (solo admin) y la fila se ve con el conductor', async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const PC = uuid(3);
    const ahora = new Date();
    const iso = (min: number) => new Date(ahora.getTime() + min * 60_000).toISOString();
    const fila = EstadoFilaSalidaPanelSchema.parse({
      puntoControlId: PC, baseMin: 8, servidorTs: ahora.toISOString(), salidasRecientes: [],
      items: [{ id: uuid(11), vehiculoId: uuid(21), placa: '1234ABC', posicion: 1, llegadaTs: iso(-10), etaTs: iso(3), esperaMs: 0, estado: 'en_fila', habilitado: false, demorado: false, anticipada: false }],
    });
    const posiciones = [
      PosicionEnVivoSchema.parse({
        id: uuid(80), deviceId: 'd1', activa: true, vehiculoPlaca: '1234ABC', conductorNombre: 'Bravo Soliz Javier',
        lineaId: uuid(1), lineaNombre: 'Linea 120', rutaSentido: 'ida', lat: -17.4, lng: -66.2, accuracy: 5, speed: 0,
        totalPuntos: 3, vehiculoId: uuid(21), ultimoFixTs: iso(0), ultimoIngresoTs: iso(0), servidorTs: iso(0),
        antiguedadFixMs: 4000, antiguedadIngestaMs: 4000, inactivaDesdeMs: 4000, estadoFrescura: 'reportando', recorridoFinTs: null,
      }),
    ];
    const respuestas: Record<string, unknown> = {
      '/v1/lineas': [{ id: uuid(1), sindicatoId: uuid(99), codigo: '120', nombre: 'Linea 120', color: null, colorSecundario: null, colorTexto: null, nombreCorto: '120', lema: null, descripcion: null, publicStatus: 'borrador', publishedAt: null }],
      [`/v1/lineas/${uuid(1)}/rutas`]: [{ id: uuid(2), lineaId: uuid(1), sentido: 'ida', estado: 'activo', publicStatus: 'borrador', publishedAt: null, geometria: { type: 'LineString', coordinates: [[-66.2, -17.4], [-66.1, -17.3]] } }],
      [`/v1/rutas/${uuid(2)}/puntos-control`]: [{ id: PC, rutaId: uuid(2), orden: 1, coord: { type: 'Point', coordinates: [-66.2, -17.4] }, radioToleranciaM: 50, obligatorio: true, estado: 'activo', rol: 'terminal', esperaMin: null, frecuenciaSalidaMin: 8 }],
      [`/v1/salidas/${PC}/fila`]: fila,
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/reportes/en-vivo/posiciones': posiciones,
      '/v1/vehiculos': [],
    };
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const jornadas: string[] = [];
    // Sesión simulada de operador (mismo formato que guarda auth-context); sin login real, que está limitado a 5/min.
    const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: testInfo.project.use.baseURL });
    try {
      await context.addInitScript((sesion) => window.localStorage.setItem('quivo.session', JSON.stringify(sesion)), {
        user: { id: uuid(500), email: 'op@quivo.local', rol: 'operador', sindicatoId: uuid(99) }, token: 'tok-operador', refreshToken: null,
      });
      const op = await context.newPage();
      await op.route('**/v1/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (path.startsWith('/v1/reportes/jornadas')) {
          jornadas.push(path);
          return route.fulfill({ status: 403, headers: cors, contentType: 'application/json', body: '{"message":"Forbidden"}' });
        }
        if (req.method() === 'GET' && path in respuestas) {
          return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(respuestas[path]) });
        }
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
      });
      await op.goto('/salidas', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(op.getByRole('button', { name: 'Despachar 1234ABC' })).toBeVisible({ timeout: 30_000 });
      await expect(op.getByText('Bravo Soliz Javier')).toBeVisible();
      await op.waitForTimeout(1_500);
      expect(jornadas).toEqual([]);
    } finally {
      await context.close();
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

  test('Alertas: chips de gravedad con conteo y filtro, acciones en una fila y Ver en mapa con vehiculo/sesion', async () => {
    test.setTimeout(90_000);
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const infra = (n: number, placa: string, gravedad: 'gravisima' | 'grave' | 'leve', estado: 'abierta' | 'atendida', haceMin: number) =>
      InfraccionHoySchema.parse({
        id: id(n), sindicatoId: id(100), vehiculoId: id(200 + n), conductorId: id(300), lineaId: id(400), rutaId: id(500), sesionId: id(600 + n),
        reglaId: null, tipo: 'desvio_ruta', gravedad, estado, inicioTs: new Date(Date.now() - haceMin * 60_000).toISOString(), finTs: null,
        lat: -17.38, lng: -66.3, detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 }, sancionId: null, atendidaPor: null, atendidaEn: null,
        nota: null, createdAt: new Date().toISOString(), vehiculoPlaca: placa, conductorNombre: 'Bravo Soliz Javier', lineaNombre: 'Línea 16',
      });
    // Como la API: abiertas primero y la más reciente arriba; la página agrupa por nivel (gravísima, grave, leve).
    const filas = [
      infra(4, '2222AAA', 'leve', 'abierta', 5),
      infra(3, '4701EHA', 'gravisima', 'abierta', 11),
      infra(2, '1616PIL', 'grave', 'abierta', 30),
      infra(1, '5163NCF', 'leve', 'abierta', 52),
      infra(5, '3333BBB', 'grave', 'atendida', 3),
    ];
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: filas }));
    await page.route('**/v1/sanciones*', (r) => r.fulfill({ json: [{ id: id(1) }, { id: id(2) }, { id: id(3) }] }));
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      const cards = page.locator('.qv-alertas__card');
      await expect(cards).toHaveCount(4);
      const chips = page.getByRole('group', { name: 'Filtrar por gravedad' }).getByRole('button');
      await expect(chips).toHaveText(['1gravísima', '1grave', '2leve']); // filtro Abiertas: la grave atendida no cuenta
      await expect(chips.nth(0)).toHaveAccessibleName('Gravísima: 1 abierta');
      await expect(chips.nth(2)).toHaveAccessibleName('Leve: 2 abiertas');
      await expect(page.getByRole('link', { name: /Sanciones pendientes \(3\)/ })).toHaveAttribute('href', '/reglas');
      // Orden: gravísima, grave, leve (más reciente primero dentro del nivel).
      await expect(cards.locator('.qv-alertas-m__sev')).toHaveText(['gravísima', 'grave', 'leve', 'leve']);
      await expect(cards.locator('.qv-plate__value')).toHaveText(['4701EHA', '1616PIL', '2222AAA', '5163NCF']);
      await expect(cards.first().locator('.qv-alertas-m__hora')).toContainText('hace 11 min');
      await expect(page.locator('.qv-alertas__titulo')).toHaveCount(4);
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0); // lista plana, sin encabezados por gravedad
      // Una sola línea en el día: la tarjeta no la repite; con Abiertas no hay palabra de estado.
      await expect(cards.first().locator('.qv-live-inf__detalle')).not.toContainText('Línea 16');
      await expect(cards.first().locator('.qv-alertas-m__hora')).not.toContainText('Abierta');

      // Acciones en una sola fila, dentro de la tarjeta y sin texto cortado.
      for (const card of await cards.all()) {
        const cajaCard = (await card.boundingBox())!;
        const cajas = await Promise.all((await card.locator('.qv-alertas__acciones').locator('a, button').all()).map((b) => b.boundingBox()));
        expect(cajas).toHaveLength(4); // Ver en mapa + Atender + Descartar + Sancionar
        for (const c of cajas) {
          expect(Math.abs(c!.y - cajas[0]!.y)).toBeLessThanOrEqual(1);
          expect(c!.height).toBeGreaterThanOrEqual(48);
          expect(c!.x + c!.width).toBeLessThanOrEqual(cajaCard.x + cajaCard.width + 0.5);
        }
        for (const b of await card.locator('.qv-alertas__acciones button').all()) {
          expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // Chip de gravedad: filtra con aria-pressed y volver a tocarlo lo quita.
      await chips.nth(2).click();
      await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards).toHaveCount(2);
      await expect(cards.locator('.qv-alertas-m__sev')).toHaveText(['leve', 'leve']);
      await chips.nth(1).click();
      await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'false');
      await expect(cards).toHaveCount(1);
      await chips.nth(1).click();
      await expect(cards).toHaveCount(4);
      // Con Todas: cada tarjeta dice su estado y los chips cuentan lo que mostrará tocarlos (la grave atendida suma).
      await page.getByRole('button', { name: /Todas/ }).click();
      await expect(cards).toHaveCount(5);
      await expect(cards.locator('.qv-alertas-m__hora')).toHaveText([/^Abierta · /, /^Abierta · /, /^Atendida · /, /^Abierta · /, /^Abierta · /]);
      await expect(chips.nth(1)).toHaveAccessibleName('Grave: 2 en total');
      await chips.nth(1).click();
      await expect(cards).toHaveCount(2);
      await chips.nth(1).click();
      // Con el estado Atendidas, el chip cuenta y filtra dentro de las atendidas.
      await page.getByRole('button', { name: /Atendidas/ }).click();
      await expect(chips.nth(1)).toHaveAccessibleName('Grave: 1 atendida');
      await expect(chips.nth(0)).toHaveAccessibleName('Gravísima: 0 atendidas');
      await chips.nth(0).click();
      await expect(page.getByText('Sin alertas atendidas de gravedad gravísima')).toBeVisible();
      await chips.nth(0).click();
      await expect(cards).toHaveCount(1);
      await page.getByRole('button', { name: /Abiertas/ }).click();

      // Ver en mapa: icono sin texto, mismo destino con vehiculo y sesion.
      const ver = cards.first().getByRole('link', { name: 'Ver en mapa 4701EHA' });
      await expect(ver).toHaveAttribute('href', `/en-vivo?vehiculo=${id(203)}&sesion=${id(603)}`);
      await ver.click();
      await expect(page).toHaveURL(new RegExp(`/en-vivo\\?vehiculo=${id(203)}&sesion=${id(603)}`), { timeout: 30_000 });
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.unroute('**/v1/sanciones*');
    }
  });

  test('Alertas: con dos líneas la tarjeta muestra la línea; en escritorio no se pide /sanciones', async () => {
    test.setTimeout(90_000);
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const infra = (n: number, linea: string) =>
      InfraccionHoySchema.parse({
        id: id(n), sindicatoId: id(100), vehiculoId: id(200 + n), conductorId: id(300), lineaId: id(400 + n), rutaId: id(500), sesionId: id(600 + n),
        reglaId: null, tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date(Date.now() - 5 * 60_000).toISOString(), finTs: null,
        lat: -17.38, lng: -66.3, detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 }, sancionId: null, atendidaPor: null, atendidaEn: null,
        nota: null, createdAt: new Date().toISOString(), vehiculoPlaca: `100${n}AAA`, conductorNombre: 'Bravo Soliz Javier', lineaNombre: linea,
      });
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: [infra(1, 'Línea 16'), infra(2, 'Línea 120')] }));
    await page.route('**/v1/sanciones*', (r) => r.fulfill({ json: [] }));
    const pedidos: string[] = [];
    const alPedir = (req: { url(): string }) => req.url().includes('/v1/sanciones') && pedidos.push(req.url());
    const original = page.viewportSize()!;
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      const detalles = page.locator('.qv-alertas__card .qv-live-inf__detalle');
      await expect(detalles).toHaveCount(2);
      await expect(detalles.nth(0)).toContainText('Línea 16');
      await expect(detalles.nth(1)).toContainText('Línea 120');
      page.on('request', alPedir);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      await expect(page.locator('.qv-alertas__card')).toHaveCount(2);
      expect(pedidos).toEqual([]);
    } finally {
      page.off('request', alPedir);
      await page.setViewportSize(original);
      await page.unroute('**/v1/reportes/en-vivo/infracciones*');
      await page.unroute('**/v1/sanciones*');
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
    // Posición completa (forma de `PosicionEnVivoSchema`) del vehículo buscado: alimenta la línea de estado de la tarjeta.
    const ahora = new Date().toISOString();
    const posBuscada = PosicionEnVivoSchema.parse({
      id: id(300), deviceId: 'dev-1', activa: true, vehiculoPlaca: '4701EHA', conductorNombre: 'José Bravo',
      lineaId: id(4), lineaNombre: 'Línea 16', rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 8, speed: 6.5, totalPuntos: 40,
      vehiculoId: id(7), conductorId: id(9),
      vuelta: { numero: 2, varianteId: null, varianteNombre: null, designadaEn: null, acuseEn: null, enEspera: false, esperaDesdeTs: null, molinosProxima: false },
      ultimoFixTs: ahora, ultimoIngresoTs: ahora, servidorTs: ahora, antiguedadFixMs: 4000, antiguedadIngestaMs: 4000,
      inactivaDesdeMs: 4000, estadoFrescura: 'reportando', recorridoFinTs: null,
    });
    const infra = (n: number, gravedad: string, estado: string) => ({
      sindicatoId: id(1), vehiculoId: id(2), conductorId: id(3), lineaId: id(4), rutaId: id(5), reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(100 + n), sesionId: id(200 + n), gravedad, estado, tipo: 'desvio_ruta', vehiculoPlaca: `P${n}`,
      conductorNombre: 'X', lineaNombre: 'Línea 16', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 },
    });
    const rutas: [string, unknown][] = [
      ['**/v1/reportes/en-vivo/posiciones*', [pos(1, 'reportando'), pos(2, 'detenido'), pos(3, 'finalizado'), pos(4, 'inactivo'), pos(5, 'inactivo'), posBuscada]],
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
      // 6 posiciones (la buscada reporta): en servicio = reportando + detenido + la buscada.
      await expect(kpi('En servicio')).toContainText('3');
      await expect(kpi('En servicio')).not.toContainText('en flota');
      await expect(kpi('Inactivos')).toContainText('2');
      await expect(kpi('Alertas abiertas')).toContainText('3');
      await expect(kpi('Alertas abiertas')).toContainText('1 grave');
      await expect(kpi('Alertas abiertas')).toHaveAttribute('href', '/alertas');
      await expect(kpi('Sanciones pend.')).toContainText('4');
      await expect(kpi('Sanciones pend.')).toHaveAttribute('href', '/reglas');
      await expect(page.getByRole('link', { name: 'Sanciones pendientes' })).toHaveAttribute('href', '/reglas');
      // Comp B: el número va antes que la etiqueta; el resumen, antes que el buscador.
      for (const nombre of ['En servicio', 'Inactivos', 'Alertas abiertas', 'Sanciones pend.']) {
        const t = kpi(nombre);
        const caja = async (sel: string) => (await t.locator(sel).boundingBox())!;
        expect((await caja('.qv-hoy__kpi-valor')).y).toBeLessThan((await caja('.qv-hoy__kpi-etiqueta')).y);
      }
      expect((await page.locator('.qv-hoy__kpis').boundingBox())!.y).toBeLessThan((await page.locator('.qv-hoy__buscar').boundingBox())!.y);
      await expect(kpi('Alertas abiertas')).toHaveClass(/qv-hoy__kpi--alerta/);
      await expect(page.locator('.qv-live-pill')).toContainText('En vivo');
      await expect(page.getByRole('navigation', { name: 'Pestañas', exact: true }).locator('.qv-tabbar__badge')).toHaveText('3');

      await page.getByLabel('Buscar placa o conductor').fill('4701 eh');
      const resultado = page.locator('.qv-hoy__resultado');
      await expect(resultado).toHaveCount(1);
      await expect(page.getByRole('status').filter({ hasText: '1 resultado' })).toContainText('“4701 eh”');
      await expect(resultado.locator('.qv-plate')).toContainText('4701EHA');
      await expect(resultado.locator('.qv-hoy__tag')).toHaveText('Línea 16');
      await expect(resultado.locator('.qv-hoy__resultado-nombre')).toHaveText('José Bravo');
      await expect(resultado.locator('.qv-hoy__resultado-estado')).toHaveText(/Reportando\s*· 23 km\/h\s*· vuelta 2/);
      await expect(resultado.locator('.qv-hoy__resultado-meta')).toContainText(/hace \d+ s/);
      await expect(resultado.getByRole('link', { name: 'Llamar a José Bravo' })).toHaveAttribute('href', 'tel:+59171234567');
      await expect(resultado.getByRole('link', { name: /^WhatsApp a José Bravo/ })).toHaveAttribute('href', 'https://wa.me/59171234567');
      for (const btn of await resultado.locator('a').all()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // Un vehículo sin conductor de hoy no muestra botones de contacto.
      await page.getByLabel('Buscar placa o conductor').fill('1616');
      await expect(resultado).toHaveCount(1);
      await expect(resultado.getByRole('link')).toHaveCount(0);
      // Sin posición hoy: ni línea de estado ni meta, solo el aviso neutro.
      await expect(resultado.locator('.qv-hoy__resultado-estado')).toHaveCount(0);
      await expect(resultado).toContainText('Sin turno hoy');
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
      // Sin alertas abiertas: el tile no es rojo y no hay chip de graves.
      const alertas = page.locator('.qv-hoy__kpi', { hasText: 'Alertas abiertas' });
      await expect(alertas).toContainText('0');
      await expect(alertas).not.toHaveClass(/qv-hoy__kpi--alerta/);
      await expect(page.locator('.qv-hoy__chip')).toHaveCount(0);
    } finally {
      liberar();
      for (const [patron] of rutas) await page.unroute(patron);
      await page.unroute('**/v1/sanciones*');
    }
  });
});
