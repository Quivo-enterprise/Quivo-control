import { devices, expect, test, type Page } from '@playwright/test';
import { EstadoFilaSalidaPanelSchema } from '../../packages/shared/src/entities/fila-salida';
import { InfraccionHoySchema } from '../../packages/shared/src/entities/infraccion';
import { PosicionEnVivoSchema } from '../../packages/shared/src/entities/en-vivo';
import { NAV_ITEMS } from '../../apps/web/src/lib/nav-items';

const ADMIN = { email: 'admin@quivo.local', password: 'Quivo123!' };

// Ítems de la página Más por rol (orden de NAV_ITEMS, sin las pestañas ni Dashboard).
const ETIQUETAS_MAS = {
  admin_quivo: ['Sindicatos', 'Socios', 'Vehículos', 'Conductores', 'Líneas', 'Rutas', 'Rotaciones', 'Reglas y sanciones', 'Reportes', 'Auditoría', 'Errores de sync', 'Usuarios'],
  admin_sindicato: ['Socios', 'Vehículos', 'Conductores', 'Líneas', 'Rutas', 'Rotaciones', 'Reglas y sanciones', 'Reportes', 'Auditoría', 'Errores de sync'],
};

// El texto de cada fila incluye el tag "Solo lectura" de Rutas.
const conTag = (etiquetas: string[]) => etiquetas.map((e) => new RegExp(`^${e}(Solo lectura)?$`));

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

  test('Más: página propia (sin menú lateral); lista de admin_quivo y activa en una ruta secundaria', async () => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 60_000 });
    const tabbar = page.getByRole('navigation', { name: 'Pestañas', exact: true });
    const mas = tabbar.getByRole('link', { name: 'Más', exact: true });
    await expect(mas).toHaveAttribute('href', '/mas');
    await expect(mas).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Más', exact: true })).toHaveCount(0);

    await mas.click();
    await expect(page).toHaveURL(/\/mas\/?$/, { timeout: 30_000 });
    await expect(mas).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Más', level: 1 })).toBeVisible();
    await expect(page.locator('.qv-mas-user__name')).toHaveText(ADMIN.email);
    await expect(page.locator('.qv-mas-user__meta')).toHaveText('Administrador QUIVO');
    // La sidebar está oculta (display:none) en celular: no hay menú lateral y la navegación principal no expone el enlace.
    await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Vehículos' })).toBeHidden();
    await expect(page.locator('.qv-mas-list__link')).toHaveText(conTag(ETIQUETAS_MAS.admin_quivo));
    // /rutas es solo lectura en celular (ver test "Rutas: solo lectura en celular").
    await expect(page.locator('.qv-mas-list__tag')).toHaveText(['Solo lectura']);
    await expect(page.locator('.qv-mas-list__link', { hasText: 'Rutas' }).locator('.qv-mas-list__tag')).toBeVisible();
    for (const el of await page.locator('.qv-mas-list__link').all()) {
      expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.locator('.qv-mas-list__link', { hasText: 'Vehículos' }).click();
    await expect(page).toHaveURL(/\/vehiculos\/?$/, { timeout: 30_000 });
    // Desde Más se llega a Vehículos: la pestaña activa sigue siendo Más y ninguna otra.
    await expect(mas).toHaveAttribute('aria-current', 'page');
    await expect(tabbar.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('Más: en modo oscuro el nombre de usuario no cae al negro del navegador', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    try {
      await page.goto('/mas', { waitUntil: 'networkidle', timeout: 60_000 });
      const color = await page.locator('.qv-mas-user__name').evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe('rgb(241, 245, 249)');
    } finally {
      await page.emulateMedia({ colorScheme: 'light' });
    }
  });

  test('vehículos: el botón flotante no tapa las acciones de la última fila', async () => {
    await page.goto('/vehiculos', { waitUntil: 'networkidle', timeout: 60_000 });
    const historial = page.getByRole('button', { name: /^Ver historial de / }).last();
    await expect(historial).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Nuevo vehículo' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    for (const nombre of [/^Ver detalles de /, /^Editar$/, /^Cambiar estado de /, /^Ver historial de /]) {
      const accion = page.getByRole('button', { name: nombre }).last();
      await accion.scrollIntoViewIfNeeded();
      const box = (await accion.boundingBox())!;
      const encima = await accion.evaluate((el, [x, y]) => {
        const top = document.elementFromPoint(x, y);
        return top === el || el.contains(top);
      }, [box.x + box.width / 2, box.y + box.height / 2]);
      expect(encima, `${nombre} tapado`).toBe(true);
    }
    // En el fondo de la página la última acción termina sobre el botón flotante, no debajo de él.
    const fab = (await page.getByRole('button', { name: 'Nuevo vehículo' }).boundingBox())!;
    const ultima = (await historial.boundingBox())!;
    expect(ultima.y + ultima.height, 'la última fila queda tapada por el FAB').toBeLessThanOrEqual(fab.y + 1);
  });

  test('tabbar: visible, 44 px mínimo y Salidas navega', async () => {
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
      vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', sesionId: '00000000-0000-4000-8000-0000000000f1',
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
      conductorNombre: n === 1 ? 'Pérez Prueba Ana' : null,
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
      '/v1/reportes/en-vivo/posiciones': [],
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

      // Fila: conductor (viene en la fila), estado de la cola con su hora de salida, y Despachar solo en la primera, a todo el ancho y de 60 px.
      await expect(page.getByText('Pérez Prueba Ana')).toBeVisible();
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
      id: uuid(10 + n), vehiculoId: uuid(20 + n), placa, posicion: n, llegadaTs: iso(-10), etaTs: iso(eta), conductorNombre: n === 1 ? 'Pérez Prueba Ana' : null,
      esperaMs: 0, estado: 'en_fila', habilitado: false, demorado: false, anticipada: false,
    });
    const todos = [item(1, '1234ABC', -2), item(2, '5678XYZ', 6), item(3, '4321QWE', 12)];
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
      items: [{ id: uuid(11), vehiculoId: uuid(21), placa: '1234ABC', posicion: 1, conductorNombre: 'Pérez Prueba Ana', llegadaTs: iso(-10), etaTs: iso(3), esperaMs: 0, estado: 'en_fila', habilitado: false, demorado: false, anticipada: false }],
    });
    const respuestas: Record<string, unknown> = {
      '/v1/lineas': [{ id: uuid(1), sindicatoId: uuid(99), codigo: '120', nombre: 'Linea 120', color: null, colorSecundario: null, colorTexto: null, nombreCorto: '120', lema: null, descripcion: null, publicStatus: 'borrador', publishedAt: null }],
      [`/v1/lineas/${uuid(1)}/rutas`]: [{ id: uuid(2), lineaId: uuid(1), sentido: 'ida', estado: 'activo', publicStatus: 'borrador', publishedAt: null, geometria: { type: 'LineString', coordinates: [[-66.2, -17.4], [-66.1, -17.3]] } }],
      [`/v1/rutas/${uuid(2)}/puntos-control`]: [{ id: PC, rutaId: uuid(2), orden: 1, coord: { type: 'Point', coordinates: [-66.2, -17.4] }, radioToleranciaM: 50, obligatorio: true, estado: 'activo', rol: 'terminal', esperaMin: null, frecuenciaSalidaMin: 8 }],
      [`/v1/salidas/${PC}/fila`]: fila,
      [`/v1/salidas/${PC}/reglas`]: { puntoControlId: PC, fecha: ahora.toISOString().slice(0, 10), baseMin: 8, reglas: [] },
      '/v1/reportes/en-vivo/posiciones': [],
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
      await expect(op.getByText('Pérez Prueba Ana')).toBeVisible();
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

  test('CSS en dev: ninguna lista de selectores mezcla :has() con selectores sin :has()', async () => {
    // shortcut: corre contra `next dev`, no ve el minificador (que funde reglas y quita `vh` antes de `dvh`); revisar el CSS de `next build` antes de desplegar, o apuntar este test a `next start`.
    await page.goto('/vehiculos', { waitUntil: 'networkidle', timeout: 60_000 });
    // Un :has() desconocido (Chrome < 105) anula la lista entera; el minificador funde reglas idénticas contiguas.
    const mezcladas = await page.evaluate(() => {
      const out: string[] = [];
      const partir = (sel: string) => {
        const parts: string[] = [];
        let depth = 0;
        let ini = 0;
        for (let i = 0; i < sel.length; i++) {
          if (sel[i] === '(') depth++;
          else if (sel[i] === ')') depth--;
          else if (sel[i] === ',' && depth === 0) {
            parts.push(sel.slice(ini, i));
            ini = i + 1;
          }
        }
        parts.push(sel.slice(ini));
        return parts;
      };
      const recorrer = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule) {
            const parts = partir(rule.selectorText);
            const con = parts.filter((p) => p.includes(':has('));
            if (con.length > 0 && con.length < parts.length) out.push(rule.selectorText);
          } else if ('cssRules' in rule) {
            recorrer((rule as CSSGroupingRule).cssRules);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          recorrer(sheet.cssRules);
        } catch {
          // hoja de otro origen: no legible
        }
      }
      return out;
    });
    expect(mezcladas).toEqual([]);
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

  test('En vivo: chips flotantes sin choque ni overflow a 412 y 360 px; Flota (⋯) abre y Escape cierra', async () => {
    test.setTimeout(90_000);
    await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const chips = page.locator('.qv-chips-mapa');
    await expect(chips).toBeVisible({ timeout: 30_000 });
    // Mapa limpio: ni barra de mando ni la tarjeta de controles de escritorio.
    await expect(page.getByLabel('Barra de mando de En vivo')).toHaveCount(0);
    await expect(page.locator('.qv-live-controles')).toHaveCount(0);
    const tabbar = page.getByRole('navigation', { name: 'Pestañas', exact: true });
    await expect(tabbar).toBeVisible();
    const tabbarBox = (await tabbar.boundingBox())!;
    const shellBox = (await page.locator('.qv-live-standalone-shell').boundingBox())!;
    expect(shellBox.y + shellBox.height, 'la pantalla En vivo no debe pisar la tabbar').toBeLessThanOrEqual(tabbarBox.y + 1);
    await expect(tabbar.getByRole('link', { name: 'Más', exact: true })).toHaveAttribute('href', '/mas'); // Salir/Panel viven en Más y Hoy
    const linea = chips.getByRole('button', { name: /Cambiar línea/ });
    const mas = chips.getByRole('button', { name: 'Más opciones del mapa' });
    const salud = chips.locator('.qv-chip-mapa--salud');
    await expect(salud).toContainText(/\d+ de \d+/, { timeout: 30_000 });
    const original = page.viewportSize()!;
    try {
      for (const ancho of [412, 360]) {
        await page.setViewportSize({ width: ancho, height: 800 });
        const cajas = [(await linea.boundingBox())!, (await mas.boundingBox())!, (await salud.boundingBox())!];
        for (const c of cajas) {
          expect(c.x, `${ancho}px: dentro del viewport`).toBeGreaterThanOrEqual(0);
          expect(c.x + c.width, `${ancho}px: dentro del viewport`).toBeLessThanOrEqual(ancho);
          expect(c.height).toBe(48);
        }
        for (let i = 0; i < cajas.length; i++) {
          for (let j = i + 1; j < cajas.length; j++) {
            const [p, q] = [cajas[i], cajas[j]];
            const choca = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
            expect(choca, `${ancho}px: los chips ${i} y ${j} no se superponen`).toBe(false);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      }
    } finally {
      await page.setViewportSize(original);
    }

    // Esperar a que carguen los datos: o hay panel de Flota (jornada activa) o el estado vacío.
    await expect(
      page.locator('#qv-live-flota').or(page.getByText('Sin vehículos en ruta activa')),
    ).toBeAttached({ timeout: 30_000 });
    const abrirFlota = async () => {
      await mas.click();
      await page.getByRole('menuitem', { name: 'Flota', exact: true }).click();
    };
    if ((await page.locator('#qv-live-flota').count()) === 0) {
      await mas.click();
      await expect(page.getByRole('menuitem', { name: 'Flota', exact: true })).toBeDisabled();
      test.info().annotations.push({ type: 'skip-parte', description: 'sin jornada activa en el seed: no hay panel de Flota' });
      return;
    }
    await abrirFlota();
    await expect(page.locator('#qv-live-flota')).toBeVisible();
    // Con un vehículo seleccionado, su cajón se oculta mientras Flota está abierta.
    if ((await page.locator('.qv-live-cajon').count()) > 0) {
      await expect(page.locator('.qv-live-cajon')).toBeHidden();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#qv-live-flota')).toBeHidden();
    await expect(mas).toBeFocused();

    // Tocar el fondo también cierra y devuelve el foco.
    await abrirFlota();
    await expect(page.locator('#qv-live-flota')).toBeVisible();
    const fondo = page.locator('.qv-live-flota-fondo');
    const caja = (await fondo.boundingBox())!;
    await page.mouse.click(caja.x + caja.width - 8, caja.y + caja.height / 2);
    await expect(page.locator('#qv-live-flota')).toBeHidden();
    await expect(mas).toBeFocused();
  });

  test('Alertas: la pestaña navega, tarjetas con acciones >= 44 px y sin overflow', async () => {
    test.setTimeout(90_000);
    const base = {
      sindicatoId: '00000000-0000-4000-8000-0000000000a1', vehiculoId: '00000000-0000-4000-8000-0000000000b1',
      conductorId: '00000000-0000-4000-8000-0000000000c1', lineaId: '00000000-0000-4000-8000-0000000000d1',
      rutaId: '00000000-0000-4000-8000-0000000000e1', reglaId: null, finTs: null, lat: -17.38, lng: -66.3,
      sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16',
    };
    const filas = [
      { ...base, id: '00000000-0000-4000-8000-000000000001', sesionId: '00000000-0000-4000-8000-0000000000f1', tipo: 'desvio_ruta', gravedad: 'gravisima', estado: 'abierta', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 240, duracionS: 90, puntos: 5 } },
      { ...base, id: '00000000-0000-4000-8000-000000000002', sesionId: '00000000-0000-4000-8000-0000000000f2', vehiculoPlaca: '9002TST', tipo: 'pc_omitido', gravedad: 'leve', estado: 'abierta', inicioTs: new Date().toISOString(), detalle: { puntoControlId: 'x', orden: 6 } },
      { ...base, id: '00000000-0000-4000-8000-000000000003', sesionId: '00000000-0000-4000-8000-0000000000f3', vehiculoPlaca: '9003TST', tipo: 'desvio_ruta', gravedad: 'grave', estado: 'atendida', inicioTs: new Date().toISOString(), detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 } },
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
        nota: null, createdAt: new Date().toISOString(), vehiculoPlaca: placa, conductorNombre: 'Pérez Prueba Ana', lineaNombre: 'Línea 16',
      });
    // Como la API: abiertas primero y la más reciente arriba; la página agrupa por nivel (gravísima, grave, leve).
    const filas = [
      infra(4, '2222AAA', 'leve', 'abierta', 5),
      infra(3, '9001TST', 'gravisima', 'abierta', 11),
      infra(2, '9002TST', 'grave', 'abierta', 30),
      infra(1, '9003TST', 'leve', 'abierta', 52),
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
      await expect(cards.locator('.qv-plate__value')).toHaveText(['9001TST', '9002TST', '2222AAA', '9003TST']);
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
      const ver = cards.first().getByRole('link', { name: 'Ver en mapa 9001TST' });
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
        nota: null, createdAt: new Date().toISOString(), vehiculoPlaca: `100${n}AAA`, conductorNombre: 'Pérez Prueba Ana', lineaNombre: linea,
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
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '9001TST',
      conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
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
      await page.getByRole('button', { name: 'Atender alerta 9001TST' }).click();
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
      await page.getByRole('button', { name: 'Atender alerta 9001TST' }).click();
      await expect(page.locator('.qv-alertas__card')).toHaveCount(0);
      const banner = page.getByRole('alert').filter({ hasText: '9001TST: La infracción ya fue cerrada' });
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
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '9001TST',
      conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
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
      await page.getByRole('button', { name: 'Atender alerta 9001TST' }).click();
      await expect(page.locator('.qv-alertas__card')).toContainText('Atendida');
      await page.getByRole('button', { name: 'Descartar alerta 9001TST' }).click();
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
      tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '9001TST',
      conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
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
      await page.getByRole('button', { name: 'Atender alerta 9001TST' }).click();
      await refresco;
      // Margen para que React Query aplique la respuesta: la caché ya dice `atendida` antes de descartar.
      await page.waitForTimeout(500);
      await expect(page.locator('.qv-alertas__card')).toContainText('Atendida');
      retenido = new Promise<void>((res) => (soltar = res));
      await page.getByRole('button', { name: 'Descartar alerta 9001TST' }).click();
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

  test('En vivo: enlace profundo abre la hoja y Seguir (⋯) se alterna', async () => {
    test.setTimeout(90_000);
    const sesionId = '00000000-0000-4000-8000-0000000000f1';
    const vehiculoId = '00000000-0000-4000-8000-0000000000e1';
    const pos = {
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.',
      lineaId: '00000000-0000-4000-8000-0000000000d1', lineaNombre: 'Línea 16', rutaSentido: 'ida',
      lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura: 'reportando', vehiculoId,
    };
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    try {
      await page.goto(`/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByLabel('Detalle del vehículo 9001TST')).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/en-vivo$/); // el parámetro se consume
      await expect(page.locator('.qv-chip-mapa--salud')).toContainText('1 de 1');
      const mas = page.getByRole('button', { name: 'Más opciones del mapa' });
      await mas.click();
      const seguir = page.getByRole('menuitemcheckbox', { name: 'Seguir' });
      await expect(seguir).toBeEnabled();
      await expect(seguir).toHaveAttribute('aria-checked', 'true');
      await seguir.click();
      await mas.click();
      await expect(page.getByRole('menuitemcheckbox', { name: 'Seguir' })).toHaveAttribute('aria-checked', 'false');
    } finally {
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');
    }
  });

  test('En vivo: hoja del vehículo (diseño B): placa, estado, tarjetas, designación y acciones', async () => {
    test.setTimeout(120_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const sesionId = id(1), vehiculoId = id(2), rutaId = id(5), molinos = id(7);
    const pos = {
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.',
      lineaId: id(4), lineaNombre: 'Línea 16', rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 8.6,
      totalPuntos: 10, estadoFrescura: 'reportando', vehiculoId, infraccionesAbiertas: 1,
      vuelta: { numero: 2, varianteId: null, varianteNombre: null, designadaEn: null, acuseEn: null, enEspera: false, esperaDesdeTs: null, molinosProxima: false },
    };
    const contexto = {
      sesion: { id: sesionId, inicio: new Date().toISOString(), fin: null, estado: 'activa', deviceId: 'd1' },
      vehiculo: { id: vehiculoId, placa: '9001TST' },
      conductor: { id: id(3), nombre: 'Pérez Prueba A.', telefono: '+59171234567' },
      linea: { id: id(4), nombre: 'Línea 16', color: '#7c3aed' },
      ruta: { id: rutaId, geometria: { type: 'LineString', coordinates: [[-66.3, -17.38], [-66.29, -17.37]] } },
      variantes: [], puntosControl: [], puntoEsperaPorVariante: {}, incidencias: [], servidorTs: new Date().toISOString(),
    };
    const variantes = [{ id: molinos, rutaId, nombre: 'Vía Molinos', estado: 'activo', puntoEsperaId: id(8), geometria: null }];
    const alerta = (n: number) => ({
      sindicatoId: id(1), vehiculoId, conductorId: id(3), lineaId: id(4), rutaId, reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(100 + n), sesionId, tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(),
      vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    });
    let abiertas = [alerta(1)];
    const designaciones: unknown[] = [];
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await page.route(`**/v1/reportes/en-vivo/${sesionId}/contexto`, (r) => r.fulfill({ json: contexto }));
    await page.route(`**/v1/rutas/${rutaId}/variantes`, (r) => r.fulfill({ json: variantes }));
    await page.route(`**/v1/rutas/${rutaId}/puntos-control`, (r) => r.fulfill({ json: [] }));
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: abiertas }));
    await page.route(`**/v1/reportes/en-vivo/${sesionId}/infracciones*`, (r) => r.fulfill({ json: abiertas }));
    await page.route('**/v1/infracciones*', (r) => r.fulfill({ json: abiertas }));
    await page.route(`**/v1/reportes/en-vivo/${sesionId}/vuelta-actual/designacion`, (r) => {
      designaciones.push(r.request().postDataJSON());
      return r.fulfill({ json: { ...pos.vuelta, id: id(9), sindicatoId: id(1), sesionId, estado: 'en_curso', inicioTs: new Date().toISOString(), finTs: null, pasoRetornoTs: null, designadaPor: null, esperaLlegadaTs: null, esperaSalidaTs: null, varianteId: molinos, varianteNombre: 'Vía Molinos', aplica: 'vuelta_actual' } });
    });
    const abrir = async () => {
      await page.goto(`/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByLabel('Detalle del vehículo 9001TST')).toBeVisible({ timeout: 30_000 });
    };
    try {
      await abrir();
      const hoja = page.getByLabel('Detalle del vehículo 9001TST');
      // Placa grande del diseño B, línea como etiqueta junto a ella.
      await expect(hoja.locator('.qv-plate--lg')).toHaveText(/9001TST/);
      await expect(hoja.locator('.qv-live-panel__m-tag')).toHaveText('Línea 16');
      await expect(hoja.locator('.qv-live-panel__m-conductor')).toHaveText('Pérez Prueba A.');
      // Estado con forma + texto; km/h solo reportando (8,6 m/s = 31 km/h).
      await expect(hoja.locator('.qv-live-panel__m-estado')).toContainText(/Reportando\s*· 31 km\/h/);
      // Tarjetas: vuelta y alertas (rojas con alertas abiertas).
      const tarjetas = hoja.locator('.qv-live-panel__m-stat');
      await expect(tarjetas.nth(0)).toContainText('Vuelta 2');
      await expect(tarjetas.nth(1)).toContainText('1 abierta');
      await expect(tarjetas.nth(1)).toHaveClass(/qv-live-panel__m-stat--al/);
      // Colores de los tokens de peligro (no color-mix ni el tono de estado "perdido").
      const colores = await tarjetas.nth(1).evaluate((el) => {
        const resolver = (v: string, prop: 'backgroundColor' | 'color') => {
          const t = document.createElement('i');
          t.style[prop] = `var(${v})`;
          document.body.appendChild(t);
          const c = getComputedStyle(t)[prop];
          t.remove();
          return c;
        };
        return {
          fondo: getComputedStyle(el).backgroundColor, fondoEsperado: resolver('--qv-color-danger-soft', 'backgroundColor'),
          texto: getComputedStyle(el.querySelector('b')!).color, textoEsperado: resolver('--qv-color-danger-texto', 'color'),
        };
      });
      expect(colores.fondo).toBe(colores.fondoEsperado);
      expect(colores.texto).toBe(colores.textoEsperado);
      // Designación: opciones y cambio vía API (mock).
      const grupo = hoja.getByRole('radiogroup');
      await expect(grupo.getByRole('radio', { name: 'Directo' })).toBeChecked();
      await grupo.getByRole('radio', { name: 'Vía Molinos' }).click();
      await expect.poll(() => designaciones.length).toBe(1);
      expect(designaciones[0]).toEqual({ varianteId: molinos });
      // Acciones primarias plegada: Llamar tel: y Ver recorrido.
      await expect(hoja.getByRole('link', { name: 'Llamar' })).toHaveAttribute('href', 'tel:+59171234567');
      await expect(hoja.getByRole('link', { name: 'Ver recorrido' })).toHaveAttribute('href', `/reportes/recorridos/${sesionId}`);
      // Abre expandida: WhatsApp/Copiar/Seguir y las infracciones están al alcance; plegada solo queda el resumen.
      await expect(hoja.getByRole('link', { name: 'WhatsApp' })).toBeVisible();
      await expect(hoja.getByRole('button', { name: 'Copiar' })).toBeVisible();
      await expect(hoja.getByRole('button', { name: 'Seguir' })).toBeVisible();
      await expect(hoja.getByRole('heading', { name: 'Infracciones' })).toBeVisible();
      const altoExpandida = (await hoja.boundingBox())!.height;
      await hoja.getByRole('button', { name: 'Plegar detalle para ver el mapa' }).click();
      await expect(hoja.getByRole('link', { name: 'WhatsApp' })).toBeHidden();
      await expect(hoja.getByRole('link', { name: 'Llamar' })).toBeVisible();
      const altoPlegada = (await hoja.boundingBox())!.height;
      // Plegada a cualquier alto (aquí 915): sin tarjetas ni designación, y la hoja no tapa ni la mitad del mapa.
      await expect(hoja.locator('.qv-live-panel__m-stat').first()).toBeHidden();
      await expect(hoja.getByRole('radiogroup')).toBeHidden();
      expect(altoPlegada).toBeLessThan(page.viewportSize()!.height * 0.45);
      console.log(`hoja: plegada ${altoPlegada}px, expandida ${altoExpandida}px`);
      const tabbar = (await page.getByRole('navigation', { name: 'Pestañas', exact: true }).boundingBox())!;
      const cajaHoja = (await hoja.boundingBox())!;
      expect(cajaHoja.y + cajaHoja.height).toBeLessThanOrEqual(tabbar.y + 1);
      // Escape cierra y el foco no cae a <body>.
      const cerrar = hoja.getByRole('button', { name: 'Cerrar detalle del vehículo' });
      const caja = (await cerrar.boundingBox())!;
      expect(Math.round(caja.width)).toBe(48);
      expect(Math.round(caja.height)).toBe(48);
      await cerrar.focus();
      await page.keyboard.press('Escape');
      await expect(hoja).toHaveCount(0);
      // Cerrar con el botón.
      await abrir();
      await page.getByRole('button', { name: 'Cerrar detalle del vehículo' }).click();
      await expect(page.getByLabel('Detalle del vehículo 9001TST')).toHaveCount(0);
      // Sin alertas: tarjeta neutra.
      abiertas = [];
      await abrir();
      const neutra = page.getByLabel('Detalle del vehículo 9001TST').locator('.qv-live-panel__m-stat').nth(1);
      await expect(neutra).toContainText('0 abiertas');
      await expect(neutra).not.toHaveClass(/qv-live-panel__m-stat--al/);
    } finally {
      for (const u of ['**/v1/reportes/en-vivo/posiciones*', `**/v1/reportes/en-vivo/${sesionId}/contexto`, `**/v1/rutas/${rutaId}/variantes`, `**/v1/rutas/${rutaId}/puntos-control`, '**/v1/reportes/en-vivo/infracciones*', `**/v1/reportes/en-vivo/${sesionId}/infracciones*`, '**/v1/infracciones*', `**/v1/reportes/en-vivo/${sesionId}/vuelta-actual/designacion`]) await page.unroute(u);
    }
  });

  test('En vivo: cabecera de la hoja sin desborde a 360 px y cerrar no queda tapado por los chips', async () => {
    test.setTimeout(120_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const sesionId = id(1), vehiculoId = id(2);
    const pos = {
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.',
      lineaId: id(4), lineaNombre: 'Línea 120 Expreso Tiquipaya Cercado Norte', rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 8.6,
      totalPuntos: 10, estadoFrescura: 'reportando', vehiculoId, infraccionesAbiertas: 0, fotoUrl: 'http://localhost:3130/foto-qa.png',
    };
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.route('**/foto-qa.png', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    try {
      for (const [w, h] of [[360, 800], [360, 640], [412, 915]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const hoja = page.getByLabel('Detalle del vehículo 9001TST');
        await expect(hoja).toBeVisible({ timeout: 30_000 });
        await expect(hoja.locator('.qv-live-panel__m-foto')).toBeVisible();
        const r = await page.evaluate(() => {
          const q = (sel: string) => document.querySelector(sel) as HTMLElement;
          const hojaEl = q('[aria-label^="Detalle del vehículo"]');
          const cerrar = q('.qv-live-panel__m-top .qv-live-panel__cerrar').getBoundingClientRect();
          const placa = q('.qv-live-panel__m-top .qv-plate').getBoundingClientRect();
          const placaEl = q('.qv-live-panel__m-top .qv-plate');
          const tagEl = q('.qv-live-panel__m-tag');
          const tag = tagEl.getBoundingClientRect();
          const centro = document.elementFromPoint(cerrar.x + cerrar.width / 2, cerrar.y + cerrar.height / 2);
          const centroPlaca = document.elementFromPoint(placa.x + placa.width / 2, placa.y + placa.height / 2);
          return {
            hojaOverflow: hojaEl.scrollWidth - hojaEl.clientWidth, paginaOverflow: document.documentElement.scrollWidth - window.innerWidth,
            cerrarW: cerrar.width, cerrarDerecha: cerrar.right, cerrarTapado: !centro?.closest('.qv-live-panel__cerrar'),
            placaTapada: !centroPlaca?.closest('.qv-plate'), placaRecortada: placaEl.scrollWidth - placaEl.clientWidth,
            hojaDerecha: hojaEl.getBoundingClientRect().right, ancho: window.innerWidth,
            tagAncho: tagEl.getBoundingClientRect().width, tagTrunc: tagEl.scrollWidth - tagEl.clientWidth,
            tagCentroY: tag.y + tag.height / 2, placaCentroY: placa.y + placa.height / 2, tagTexto: tagEl.textContent ?? '',
          };
        });
        const vp = `${w}x${h}`;
        // Etiqueta de línea legible: larga → 2.ª fila sin truncar de más; corta → junto a la placa.
        if (w === 360) {
          expect(r.tagAncho, `etiqueta de línea legible ${vp}`).toBeGreaterThanOrEqual(150);
          expect(r.tagTexto).toContain('Línea 120 Expreso');
        }
        expect(r.hojaOverflow, `desborde de la hoja ${vp}`).toBeLessThanOrEqual(0);
        expect(r.paginaOverflow, `desborde de la página ${vp}`).toBeLessThanOrEqual(0);
        expect(r.cerrarW, `cerrar ≥44 ${vp}`).toBeGreaterThanOrEqual(44);
        expect(r.cerrarDerecha, `cerrar dentro de la pantalla ${vp}`).toBeLessThanOrEqual(r.ancho);
        expect(r.cerrarTapado, `cerrar tapado por otro elemento ${vp}`).toBe(false);
        expect(r.placaTapada, `placa tapada ${vp}`).toBe(false);
        expect(r.placaRecortada, `placa recortada ${vp}`).toBeLessThanOrEqual(0);
        // Expandida (estado por defecto) y plegada: cerrar sigue siendo accionable.
        await hoja.getByRole('button', { name: 'Plegar detalle para ver el mapa' }).click();
        const cerrar = hoja.getByRole('button', { name: 'Cerrar detalle del vehículo' });
        await expect(cerrar).toBeVisible();
        await cerrar.click({ timeout: 5_000 });
        await expect(hoja).toHaveCount(0);
      }
      // Nombre corto sin foto a 412 px: la etiqueta se queda en la fila de la placa, sin truncar.
      await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [{ ...pos, lineaNombre: 'Línea 16', fotoUrl: null }] }));
      await page.setViewportSize({ width: 412, height: 915 });
      await page.goto(`/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByLabel('Detalle del vehículo 9001TST')).toBeVisible({ timeout: 30_000 });
      const corta = await page.evaluate(() => {
        const t = document.querySelector('.qv-live-panel__m-tag') as HTMLElement;
        const p = document.querySelector('.qv-live-panel__m-top .qv-plate') as HTMLElement;
        const a = t.getBoundingClientRect(), b = p.getBoundingClientRect();
        return { dy: Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)), trunc: t.scrollWidth - t.clientWidth, texto: t.textContent };
      });
      expect(corta.dy, 'etiqueta corta en la fila de la placa 412').toBeLessThanOrEqual(8);
      expect(corta.trunc, 'etiqueta corta sin truncar 412').toBeLessThanOrEqual(1);
      expect(corta.texto).toBe('Línea 16');
    } finally {
      await page.setViewportSize({ width: 412, height: 915 });
      await page.unroute('**/foto-qa.png');
      await page.unroute('**/v1/reportes/en-vivo/posiciones*');
    }
  });

  test('En vivo: hoja honesta al cargar, plegada corta en pantallas bajas, segmentos sin cortar y título accesible', async () => {
    test.setTimeout(150_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const sesionId = id(1), vehiculoId = id(2), rutaId = id(5), norte = id(7), cerro = id(9);
    const shots = process.env.F16_SHOTS;
    const pos = {
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.',
      lineaId: id(4), lineaNombre: 'Línea 16', rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 8.6,
      totalPuntos: 10, estadoFrescura: 'reportando', vehiculoId, infraccionesAbiertas: 1,
      vuelta: { numero: 2, varianteId: norte, varianteNombre: 'Vía Molinos Norte', designadaEn: null, acuseEn: null, enEspera: false, esperaDesdeTs: null, molinosProxima: false },
    };
    const contexto = {
      sesion: { id: sesionId, inicio: new Date().toISOString(), fin: null, estado: 'activa', deviceId: 'd1' },
      vehiculo: { id: vehiculoId, placa: '9001TST' },
      conductor: { id: id(3), nombre: 'Pérez Prueba A.', telefono: '+59171234567' },
      linea: { id: id(4), nombre: 'Línea 16', color: '#7c3aed' },
      ruta: { id: rutaId, geometria: { type: 'LineString', coordinates: [[-66.3, -17.38], [-66.29, -17.37]] } },
      variantes: [], puntosControl: [], puntoEsperaPorVariante: {}, incidencias: [], servidorTs: new Date().toISOString(),
    };
    const variantes = [
      { id: norte, rutaId, nombre: 'Vía Molinos Norte', estado: 'activo', puntoEsperaId: id(8), geometria: null },
      { id: cerro, rutaId, nombre: 'Cerro', estado: 'activo', puntoEsperaId: id(8), geometria: null },
    ];
    const alerta = {
      sindicatoId: id(1), vehiculoId, conductorId: id(3), lineaId: id(4), rutaId, reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(101), sesionId, tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(),
      vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    const urlInfSesion = `**/v1/reportes/en-vivo/${sesionId}/infracciones*`;
    const urls = ['**/v1/reportes/en-vivo/posiciones*', `**/v1/reportes/en-vivo/${sesionId}/contexto`, `**/v1/rutas/${rutaId}/variantes`, `**/v1/rutas/${rutaId}/puntos-control`, '**/v1/reportes/en-vivo/infracciones*', '**/v1/infracciones*', urlInfSesion];
    await page.route(urls[0]!, (r) => r.fulfill({ json: [pos] }));
    await page.route(urls[1]!, (r) => r.fulfill({ json: contexto }));
    await page.route(urls[2]!, (r) => r.fulfill({ json: variantes }));
    await page.route(urls[3]!, (r) => r.fulfill({ json: [] }));
    await page.route(urls[4]!, (r) => r.fulfill({ json: [alerta] }));
    await page.route(urls[5]!, (r) => r.fulfill({ json: [alerta] }));
    const abrir = async (w: number, h: number) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const hoja = page.getByLabel('Detalle del vehículo 9001TST');
      await expect(hoja).toBeVisible({ timeout: 30_000 });
      return hoja;
    };
    try {
      // Cargando: la tarjeta de alertas no afirma "0 abiertas".
      let liberar!: () => void;
      const gate = new Promise<void>((res) => { liberar = res; });
      await page.route(urlInfSesion, async (r) => { await gate; await r.fulfill({ json: [alerta] }); });
      let hoja = await abrir(412, 915);
      const tarjetaAlertas = hoja.locator('.qv-live-panel__m-stat').nth(1);
      await expect(tarjetaAlertas).toContainText('Cargando…');
      await expect(tarjetaAlertas).not.toContainText('0 abierta');
      await expect(tarjetaAlertas).not.toHaveClass(/qv-live-panel__m-stat--al/);
      if (shots) await page.screenshot({ path: `${shots}/b10fix3_hoja_cargando.png` });
      liberar();
      await expect(tarjetaAlertas).toContainText('1 abierta');
      await expect(tarjetaAlertas).toHaveClass(/qv-live-panel__m-stat--al/);
      await page.unroute(urlInfSesion);

      // Error sin datos: "Sin cargar", neutro (no rojo).
      await page.route(urlInfSesion, (r) => r.fulfill({ status: 500, json: { message: 'boom' } }));
      hoja = await abrir(412, 915);
      const tarjetaError = hoja.locator('.qv-live-panel__m-stat').nth(1);
      await expect(tarjetaError).toContainText('Sin cargar', { timeout: 45_000 });
      await expect(tarjetaError).not.toContainText('0 abierta');
      await expect(tarjetaError).not.toHaveClass(/qv-live-panel__m-stat--al/);
      await page.unroute(urlInfSesion);
      await page.route(urlInfSesion, (r) => r.fulfill({ json: [alerta] }));

      // 412x915: el título es la placa pelada, la tarjeta de vuelta muestra solo "Vuelta N" y la plegada conserva el diseño B.
      hoja = await abrir(412, 915);
      await expect(hoja.getByRole('heading', { name: '9001TST', exact: true, level: 2 })).toHaveCount(1);
      await expect(hoja.locator('.qv-live-panel__m-stat').nth(0)).toContainText('Vuelta 2');
      // Ninguna tarjeta se sale de la hoja (la de alertas no se recorta).
      const hojaCaja = (await hoja.boundingBox())!;
      for (const t of await hoja.locator('.qv-live-panel__m-stat').all()) {
        const c = (await t.boundingBox())!;
        expect(c.x + c.width, 'tarjeta dentro de la hoja').toBeLessThanOrEqual(hojaCaja.x + hojaCaja.width + 1);
      }
      const ctrl = hoja.locator('.qv-live-panel__asa');
      const controla = (await ctrl.getAttribute('aria-controls'))!.split(/\s+/);
      expect(controla.length).toBeGreaterThanOrEqual(2);
      for (const idc of controla) await expect(page.locator(`[id="${idc}"]`)).toHaveCount(1);
      if (shots) await page.screenshot({ path: `${shots}/b10fix3_hoja_expandida.png` });
      await ctrl.click();
      // Plegada a cualquier alto (también 915): sin tarjetas ni designación.
      await expect(hoja.getByRole('heading', { name: 'Designación' })).toBeHidden();
      if (shots) await page.screenshot({ path: `${shots}/b10fix3_hoja.png` });

      // 360x640: plegada ≤ 45% del alto, mapa ≥ 50%; expandida muestra Designación; segmentos sin cortar palabras.
      hoja = await abrir(360, 640);
      await hoja.locator('.qv-live-panel__asa').click();
      await expect(hoja.getByRole('heading', { name: 'Designación' })).toBeHidden();
      await expect(hoja.locator('.qv-live-panel__m-stats')).toBeHidden();
      await expect(hoja.getByRole('link', { name: 'Llamar' })).toBeVisible();
      await expect(hoja.getByRole('link', { name: 'Ver recorrido' })).toBeVisible();
      await expect(hoja.locator('.qv-live-panel__m-estado')).toBeVisible();
      const caja = (await hoja.boundingBox())!;
      console.log(`hoja 360x640 plegada: ${caja.height}px, mapa libre ${caja.y}px`);
      expect(caja.height, 'plegada ≤ 45% del alto').toBeLessThanOrEqual(640 * 0.45);
      expect(caja.y, 'mapa por encima ≥ 50%').toBeGreaterThanOrEqual(640 * 0.5);
      if (shots) await page.screenshot({ path: `${shots}/b10fix3_hoja_360x640.png` });
      await hoja.locator('.qv-live-panel__asa').click();
      await expect(hoja.getByRole('heading', { name: 'Designación' })).toBeVisible();
      const seg = await hoja.getByRole('radio').evaluateAll((els) =>
        els.map((el) => {
          const b = el as HTMLElement;
          // Sin corte a mitad de palabra: la palabra más ancha cabe en el ancho útil del segmento.
          const palabras = (b.textContent ?? '').trim().split(/\s+/);
          const anchoMax = Math.max(...palabras.map((w) => {
            const t = document.createElement('span');
            t.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
            t.style.font = getComputedStyle(b).font;
            t.textContent = w;
            document.body.appendChild(t);
            const a = t.getBoundingClientRect().width;
            t.remove();
            return a;
          }));
          const cs = getComputedStyle(b);
          const util = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return { texto: b.textContent, sobra: b.scrollWidth - b.clientWidth, palabraMasAncha: anchoMax, util, ancho: b.getBoundingClientRect().width };
        }),
      );
      expect(seg).toHaveLength(3);
      for (const s of seg) {
        expect(s.sobra, `segmento "${s.texto}" desborda`).toBeLessThanOrEqual(1);
        expect(s.palabraMasAncha, `segmento "${s.texto}" corta una palabra`).toBeLessThanOrEqual(s.util + 1);
        expect(s.ancho).toBeGreaterThanOrEqual(115);
      }
    } finally {
      await page.setViewportSize({ width: 412, height: 915 });
      for (const u of urls) await page.unroute(u);
    }
  });

  test('En vivo: sin contadores de alerta sobre el mapa; el admin las ve en la pestaña Alertas y el resumen en el menú ⋯', async () => {
    test.setTimeout(90_000);
    const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
    const pos = {
      id: id(1), deviceId: 'd1', activa: true, vehiculoPlaca: '9002TST', conductorNombre: 'X', lineaId: id(4), lineaNombre: 'Línea 16',
      rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura: 'reportando',
      vehiculoId: id(2), infraccionesAbiertas: 0,
    };
    // Las 3 alertas son de OTRA sesión del vehículo: la ganadora de /posiciones dice 0.
    const alerta = (n: number) => ({
      sindicatoId: id(1), vehiculoId: id(2), conductorId: id(3), lineaId: id(4), rutaId: id(5), reglaId: null, finTs: null,
      lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
      id: id(100 + n), sesionId: id(200 + n), tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(),
      vehiculoPlaca: '9002TST', conductorNombre: 'X', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    });
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: [alerta(1), alerta(2), alerta(3)] }));
    try {
      await page.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.locator('.qv-chip-mapa--salud')).toContainText('1 de 1', { timeout: 30_000 });
      await expect(page.locator('.qv-live-alertas')).toHaveCount(0);
      await expect(page.locator('.qv-live-mapa')).not.toContainText(/alertas? abiertas?|Sin infracciones/i);
      await expect(page.getByRole('button', { name: 'Siguiente alerta' })).toHaveCount(0);
      const alertas = page.getByRole('navigation', { name: 'Pestañas', exact: true }).getByRole('link', { name: /Alertas/ });
      await expect(alertas.locator('.qv-tabbar__badge')).toHaveText('3');
      // Landmark y título: el h1 oculto y la cabecera con nombre existen una sola vez en el celular.
      await expect(page.getByRole('heading', { name: 'En vivo', level: 1 })).toHaveCount(1);
      await expect(page.getByLabel('Controles de En vivo')).toHaveCount(1);
      // El admin tiene la pestaña: sin insignia en el ⋯; el resumen del día va arriba del menú.
      await expect(page.locator('.qv-menu-ac__insignia')).toHaveCount(0);
      const mas = page.getByRole('button', { name: 'Más opciones del mapa' });
      await mas.click();
      await expect(page.getByRole('menu', { name: /Más opciones del mapa/ })).toContainText('3 alertas abiertas');
      await expect(page.getByRole('menuitem', { name: 'Siguiente alerta' })).toHaveCount(0); // 'enlace': la pestaña lo cubre
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
      id: sesionId, deviceId: 'd1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Pérez Prueba A.',
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
      gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(), vehiculoPlaca: '9001TST',
      conductorNombre: 'Pérez Prueba A.', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
    };
    await page.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await page.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: [alerta] }));
    try {
      await page.goto('/alertas', { waitUntil: 'networkidle', timeout: 60_000 });
      const ver = page.getByRole('link', { name: 'Ver en mapa 9001TST' });
      await expect(ver).toHaveAttribute('href', `/en-vivo?vehiculo=${vehiculoId}&sesion=${sesionAlerta}`);
      await ver.click();
      const panel = page.getByLabel('Detalle del vehículo 9001TST');
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
      await expect(page.locator('.qv-chips-mapa')).toBeVisible({ timeout: 30_000 });
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
      id: id(300), deviceId: 'dev-1', activa: true, vehiculoPlaca: '9001TST', conductorNombre: 'Ana Prueba',
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
      ['**/v1/reportes/jornadas*', { fecha: '2026-11-05', vehiculos: [{ vehiculoId: id(7), placa: '9001TST', conductorId: id(9), conductorNombre: 'Ana Prueba', lineaNombre: 'Línea 16', estado: 'en_recorrido' }] }],
      ['**/v1/vehiculos*', [{ id: id(7), placa: '9001TST' }, { id: id(8), placa: '9002TST' }]],
      ['**/v1/conductores*', [{ id: id(9), nombre: 'Ana Prueba', telefono: '71234567', estado: 'activo' }]],
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

      await page.getByLabel('Buscar placa o conductor').fill('9001 ts');
      const resultado = page.locator('.qv-hoy__resultado');
      await expect(resultado).toHaveCount(1);
      await expect(page.getByRole('status').filter({ hasText: '1 resultado' })).toContainText('“9001 ts”');
      await expect(resultado.locator('.qv-plate')).toContainText('9001TST');
      await expect(resultado.locator('.qv-hoy__tag')).toHaveText('Línea 16');
      await expect(resultado.locator('.qv-hoy__resultado-nombre')).toHaveText('Ana Prueba');
      await expect(resultado.locator('.qv-hoy__resultado-estado')).toHaveText(/Reportando\s*· 23 km\/h\s*· vuelta 2/);
      await expect(resultado.locator('.qv-hoy__resultado-meta')).toContainText(/hace \d+ s/);
      await expect(resultado.getByRole('link', { name: 'Llamar a Ana Prueba' })).toHaveAttribute('href', 'tel:+59171234567');
      await expect(resultado.getByRole('link', { name: /^WhatsApp a Ana Prueba/ })).toHaveAttribute('href', 'https://wa.me/59171234567');
      for (const btn of await resultado.locator('a').all()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // Un vehículo sin conductor de hoy no muestra botones de contacto.
      await page.getByLabel('Buscar placa o conductor').fill('9002');
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

// Sin login real (el API limita a 5/min): la sesión se siembra en localStorage y el API se simula vacío.
async function paginaConSesion(browser: import('@playwright/test').Browser, baseURL: string | undefined, rol: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...devices['Pixel 7'], ...(viewport && { viewport }), baseURL });
  await context.addInitScript(
    (r) => {
      if (!window.localStorage.getItem('quivo.session')) {
        window.localStorage.setItem('quivo.session', JSON.stringify({ user: { id: 'u1', email: `${r}@quivo.local`, rol: r, sindicatoId: null }, token: 'opaco', refreshToken: null }));
      }
    },
    rol,
  );
  await context.route('**/v1/**', (route) => route.fulfill({ json: [] }));
  return { context, page: await context.newPage() };
}

test.describe('Más por rol (sesión simulada)', () => {
  test('admin_sindicato: 10 ítems, sin Sindicatos ni Usuarios', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_sindicato');
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await expect(p.locator('.qv-mas-list__link')).toHaveText(conTag(ETIQUETAS_MAS.admin_sindicato));
    await expect(p.locator('.qv-mas-user__meta')).toHaveText('Administrador de sindicato');
    await context.close();
  });

  test('operador: solo tarjeta de usuario y Cerrar sesión, sin lista; Más no es su aterrizaje', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'operador');
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await expect(p.getByRole('heading', { name: 'Más', level: 1 })).toBeVisible();
    await expect(p.locator('.qv-mas-list')).toHaveCount(0);
    await expect(p.locator('.qv-mas-user__meta')).toHaveText('Operador');
    await expect(p.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    const tabbar = p.getByRole('navigation', { name: 'Pestañas', exact: true });
    await expect(tabbar.getByRole('link')).toHaveText(['En vivo', 'Salidas', 'Más']);
    await expect(tabbar.getByRole('link', { name: 'Más', exact: true })).toHaveAttribute('aria-current', 'page');
    // Aterrizaje: la raíz lo manda a En vivo, no a Más.
    await p.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(p).toHaveURL(/\/en-vivo\/?$/, { timeout: 30_000 });
    await context.close();
  });

  test('escritorio: /mas redirige a / y la sidebar sigue', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo', { width: 1440, height: 900 });
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await expect(p).toHaveURL(/\/$/, { timeout: 30_000 });
    await expect(p.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Vehículos' })).toBeVisible();
    await expect(p.getByRole('navigation', { name: 'Pestañas', exact: true })).toBeHidden();
    await context.close();
  });

  test('escritorio: /mas del operador redirige directo a /en-vivo', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'operador', { width: 1440, height: 900 });
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await expect(p).toHaveURL(/\/en-vivo\/?$/, { timeout: 30_000 });
    await context.close();
  });

  test('girar el celular (915x412) no saca al usuario de /mas', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo');
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await expect(p.locator('.qv-mas-list')).toBeVisible({ timeout: 30_000 });
    await p.setViewportSize({ width: 915, height: 412 });
    await p.waitForTimeout(1000);
    await expect(p).toHaveURL(/\/mas\/?$/);
    await expect(p.locator('.qv-mas-list')).toBeVisible();
    await context.close();
  });

  test('Cerrar sesión: cierra la sesión y va a /login', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo');
    await p.goto('/mas', { waitUntil: 'domcontentloaded' });
    await p.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(p).toHaveURL(/\/login\/?$/, { timeout: 30_000 });
    expect(await p.evaluate(() => window.localStorage.getItem('quivo.session'))).toBeNull();
    await context.close();
  });
});

test.describe('En vivo móvil: selector de línea y menú ⋯ (sesión simulada)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
  const linea = (n: number, codigo: string, nombreCorto: string) => ({
    id: id(n), sindicatoId: id(1), codigo, nombre: nombreCorto, nombreCorto, color: '#7c3aed',
  });
  const vehiculo = (n: number, lineaId: string, placa: string, estadoFrescura: string) => ({
    id: id(300 + n), deviceId: `d${n}`, activa: true, vehiculoPlaca: placa, conductorNombre: 'Pérez Prueba A.', lineaId, lineaNombre: 'X',
    rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura, vehiculoId: id(400 + n), infraccionesAbiertas: 0,
  });
  const posiciones = [vehiculo(1, id(11), '9002TST', 'reportando'), vehiculo(2, id(12), '9001TST', 'finalizado')];

  const alerta = (n: number, gravedad = 'grave') => ({
    sindicatoId: id(1), vehiculoId: id(400 + n), conductorId: id(3), lineaId: id(11), rutaId: id(5), reglaId: null, finTs: null,
    lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
    id: id(500 + n), sesionId: id(300 + n), tipo: 'desvio_ruta', gravedad, estado: 'abierta', inicioTs: new Date().toISOString(),
    vehiculoPlaca: '9002TST', conductorNombre: 'X', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
  });
  type Pos = ReturnType<typeof vehiculo> & { infraccionNivel?: string | null; infraccionesAbiertas?: number };
  const conAlerta = (v: Pos, nivel: string, abiertas = 1): Pos => ({ ...v, infraccionNivel: nivel, infraccionesAbiertas: abiertas });
  interface OpcionesAbrir {
    viewport?: { width: number; height: number };
    /** Función para poder cambiar la respuesta entre polls. */
    posiciones?: () => Pos[];
    infracciones?: unknown[];
    esperar?: RegExp;
  }

  async function abrir(browser: import('@playwright/test').Browser, baseURL: string | undefined, rol: string, url = '/en-vivo', op: OpcionesAbrir = {}) {
    const { context, page: p } = await paginaConSesion(browser, baseURL, rol, op.viewport);
    await p.route('**/v1/lineas', (r) => r.fulfill({ json: [linea(11, '16', 'Línea 16'), linea(12, '120', '120')] }));
    await p.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: op.posiciones ? op.posiciones() : posiciones }));
    // Detalle de una sesión (contexto/traza/infracciones): 404 como con un id que el API no conoce; `[]` rompería el panel.
    await p.route(/\/v1\/reportes\/en-vivo\/[0-9a-f-]{36}\//, (r) => r.fulfill({ status: 404, json: { message: 'no existe' } }));
    if (op.infracciones) await p.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: op.infracciones }));
    await p.route('**/v1/reportes/en-vivo/molinos*', (r) => r.fulfill({ json: { lineas: [], colas: [] } }));
    // Errores de consola, salvo ruido conocido: recursos de red que fallan (el mock/CDN/mapa no existe en CI) y la
    // queja de RouteMap por no tener NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (la acceptance corre sin key a propósito).
    const errores: string[] = [];
    p.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !/Failed to load resource|net::ERR_|falta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY|maps\.googleapis|Google Maps/i.test(t)) errores.push(t);
    });
    p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(p.locator('.qv-chip-mapa--salud')).toContainText(op.esperar ?? '1 de 2', { timeout: 30_000 }); // en servicio de total: finalizado no cuenta
    return { context, p, errores };
  }

  test('carga sin errores de consola y el chip de salud lee "1 de 2 · hace N s" con espaciado normal', async ({ browser }, testInfo) => {
    const { context, p, errores } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo');
    await p.waitForTimeout(1_500); // deja correr el tick de 1 Hz y un poll
    expect(errores).toEqual([]);
    const chip = p.locator('.qv-chip-mapa--salud');
    await expect(chip).toHaveText(/1 de 2\s*· hace \d+\s*s/);
    // sin espacio de más: el hueco entre "de 2" y "·" es solo el `gap` del flex (8 px), no gap + espacio literal
    const hueco = await chip.evaluate((el) => {
      const [a, b] = Array.from(el.querySelectorAll(':scope > span:not([role])')).map((n) => n.getBoundingClientRect());
      return b.left - a.right;
    });
    expect(hueco).toBeLessThanOrEqual(9);
    await context.close();
  });

  test('selector de línea: filtra la flota y el chip cambia de nombre', async ({ browser }, testInfo) => {
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo');
    const chip = p.getByRole('button', { name: /Cambiar línea/ });
    await expect(chip).toHaveAccessibleName(/Todas las líneas/);
    await chip.click();
    const menu = p.getByRole('menu', { name: /Cambiar línea/ });
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Todas las líneas', 'Línea 16', '120']);
    await expect(menu.getByRole('menuitemradio', { name: 'Todas las líneas' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: '120' }).click();
    await expect(menu).toHaveCount(0);
    await expect(chip).toContainText('120');
    await expect(chip).toBeFocused();
    await expect(p.locator('.qv-chip-mapa--salud')).toContainText('0 de 1'); // la 120 solo tiene el finalizado
    await chip.click();
    await p.getByRole('menuitemradio', { name: 'Todas las líneas' }).click();
    await expect(p.locator('.qv-chip-mapa--salud')).toContainText('1 de 2');
    await context.close();
  });

  test('menú ⋯: teclado (flechas, Inicio/Fin, Escape, Tab) y cada ítem funciona', async ({ browser }, testInfo) => {
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo');
    const mas = p.getByRole('button', { name: 'Más opciones del mapa' });
    const menu = p.getByRole('menu', { name: 'Más opciones del mapa' });
    const item = (n: string) => p.getByRole(n === 'Seguir' ? 'menuitemcheckbox' : 'menuitem', { name: n, exact: true });
    await expect(mas).toHaveAttribute('aria-haspopup', 'menu');
    await mas.focus();
    await p.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(item('Flota')).toBeFocused();
    await expect(menu.getByRole('menuitem').or(menu.getByRole('menuitemcheckbox'))).toHaveText(['Flota', 'Días anteriores', 'Siguiente alerta', 'Seguir', 'Ampliar', 'Refrescar']);
    await expect(menu).toContainText('Sin infracciones abiertas'); // resumen del día, arriba y sin ser un ítem
    await expect(item('Siguiente alerta')).toBeDisabled(); // sin alertas alcanzables
    await expect(item('Seguir')).toBeDisabled(); // sin vehículo abierto no hay a quién seguir
    await p.keyboard.press('End');
    await expect(item('Refrescar')).toBeFocused();
    await p.keyboard.press('ArrowDown'); // vuelta al inicio
    await expect(item('Flota')).toBeFocused();
    await p.keyboard.press('ArrowDown');
    await expect(item('Días anteriores')).toBeFocused();
    await p.keyboard.press('Home');
    await expect(item('Flota')).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(mas).toBeFocused();
    await p.keyboard.press('Enter');
    await expect(item('Flota')).toBeFocused();
    await p.keyboard.press('Tab'); // cierra; el Tab del navegador sigue desde el ⋯
    await expect(menu).toHaveCount(0);
    await expect(p.locator('body')).not.toBeFocused();

    // Clic afuera cierra.
    await mas.click();
    await expect(menu).toBeVisible();
    await p.mouse.click(30, 300); // fuera del menú (anclado a la derecha) y de la tabbar
    await expect(menu).toHaveCount(0);

    // Refrescar: pide posiciones al instante (el poll normal es cada 2 s).
    await p.waitForResponse((r) => r.url().includes('/reportes/en-vivo/posiciones'));
    await mas.click();
    const pedido = p.waitForRequest((r) => r.url().includes('/reportes/en-vivo/posiciones'), { timeout: 1_200 });
    await item('Refrescar').click();
    await pedido;
    await expect(mas).toBeFocused();

    // Ampliar: cierra el menú y devuelve el foco (el reencuadre lo hace el mapa).
    await mas.click();
    await item('Ampliar').click();
    await expect(menu).toHaveCount(0);
    await expect(mas).toBeFocused();

    // Flota: abre el panel con Space.
    await mas.click();
    await item('Flota').focus();
    await p.keyboard.press('Space');
    await expect(p.locator('#qv-live-flota')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(p.locator('#qv-live-flota')).toBeHidden();
    await expect(mas).toBeFocused();

    // Días anteriores: navega a los recorridos.
    await mas.click();
    await item('Días anteriores').click();
    await expect(p).toHaveURL(/\/reportes\/recorridos/, { timeout: 30_000 });
    await context.close();
  });

  test('menú ⋯: "Días anteriores" solo aparece si el rol puede verlos (operador no)', async ({ browser }, testInfo) => {
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'operador');
    await p.getByRole('button', { name: 'Más opciones del mapa' }).click();
    await expect(p.getByRole('menuitem', { name: 'Flota', exact: true })).toBeVisible();
    await expect(p.getByRole('menuitem', { name: 'Días anteriores' })).toHaveCount(0);
    await context.close();
  });

  const conAlertas = () => [conAlerta(vehiculo(1, id(11), '9002TST', 'reportando'), 'grave', 2), conAlerta(vehiculo(2, id(11), '9001TST', 'reportando'), 'leve')];

  test('alertas en el menú ⋯ (admin): Siguiente alerta, filtro por nivel y su estado en el disparador; sin insignia', async ({ browser }, testInfo) => {
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo', '/en-vivo', {
      posiciones: conAlertas, infracciones: [alerta(1), alerta(2), alerta(3)], esperar: '2 de 2',
    });
    const mas = p.getByRole('button', { name: /Más opciones del mapa/ });
    await expect(p.locator('.qv-menu-ac__insignia')).toHaveCount(0); // el admin tiene la pestaña Alertas
    await expect(mas).toHaveAccessibleName('Más opciones del mapa');
    await mas.click();
    const menu = p.getByRole('menu', { name: /Más opciones del mapa/ });
    // El menú usa todo el alto libre: a 412x915 entra entero (Refrescar, el último ítem, sin scroll) y termina sobre la tabbar.
    const medir = async (page: typeof p) => {
      const m = page.getByRole('menu', { name: /Más opciones del mapa/ });
      const ultimo = m.getByRole('menuitem', { name: 'Refrescar' });
      const tabbar = (await page.getByRole('navigation', { name: 'Pestañas', exact: true }).boundingBox())!;
      const caja = (await m.boundingBox())!;
      const scroll = await m.evaluate((el) => ({ alto: el.scrollHeight, visible: el.clientHeight }));
      return { m, ultimo, tabbarTop: tabbar.y, caja, scroll };
    };
    const dentro = async (m: Awaited<ReturnType<typeof medir>>) => {
      const it = (await m.ultimo.boundingBox())!;
      expect(it.y).toBeGreaterThanOrEqual(m.caja.y);
      expect(it.y + it.height).toBeLessThanOrEqual(m.caja.y + m.caja.height);
    };
    const grande = await medir(p);
    expect(grande.scroll.alto).toBeLessThanOrEqual(grande.scroll.visible);
    await dentro(grande);
    expect(grande.caja.y + grande.caja.height).toBeLessThanOrEqual(grande.tabbarTop);
    await expect(menu.getByRole('menuitem', { name: 'Siguiente alerta' })).toBeEnabled();
    await expect(menu.getByRole('menuitemcheckbox', { name: '0 gravísimas' })).toBeDisabled();
    const grave = menu.getByRole('menuitemcheckbox', { name: '1 grave' });
    await expect(grave).toBeEnabled();
    await expect(grave).toHaveAttribute('aria-checked', 'false');
    await expect(menu.getByRole('menuitemcheckbox', { name: '1 leve' })).toBeEnabled();
    await grave.click();
    await expect(menu).toHaveCount(0);
    // Filtro activo: se ve en el disparador (también tras girar el celular) y su nombre lo dice.
    await expect(mas).toHaveClass(/qv-chip-mapa--activo/);
    await expect(mas).toHaveAccessibleName(/Filtro activo: solo alertas graves/);
    await mas.click();
    await expect(p.getByRole('menuitemcheckbox', { name: '1 grave' })).toHaveAttribute('aria-checked', 'true');
    await p.getByRole('menuitemcheckbox', { name: '1 grave' }).click(); // segundo toque: quita el filtro
    await expect(mas).not.toHaveClass(/qv-chip-mapa--activo/);
    await expect(mas).toHaveAccessibleName('Más opciones del mapa');

    // Pantallas bajas: el menú no pasa sobre la tabbar y Refrescar se alcanza (a 360x640 aún entra; a 360x520 hay que hacer scroll en el menú).
    for (const alto of [640, 520]) {
      const chico = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo', '/en-vivo', {
        posiciones: conAlertas, infracciones: [alerta(1), alerta(2), alerta(3)], esperar: '2 de 2', viewport: { width: 360, height: alto },
      });
      await chico.p.getByRole('button', { name: /Más opciones del mapa/ }).click();
      const bajo = await medir(chico.p);
      expect(bajo.caja.y + bajo.caja.height).toBeLessThanOrEqual(bajo.tabbarTop);
      if (alto === 520) expect(bajo.scroll.alto).toBeGreaterThan(bajo.scroll.visible);
      await bajo.m.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await dentro(await medir(chico.p));
      await chico.context.close();
    }

    // Siguiente alerta: abre el vehículo de la alerta más grave y, al cerrarlo, el foco vuelve al ⋯ (no hay botón en la barra).
    await mas.click();
    await p.getByRole('menuitem', { name: 'Siguiente alerta' }).click();
    await expect(p.getByLabel('Detalle del vehículo 9002TST')).toBeVisible({ timeout: 30_000 });
    await p.getByRole('button', { name: 'Cerrar detalle del vehículo' }).click();
    await expect(p.getByLabel(/Detalle del vehículo/)).toHaveCount(0);
    await expect(mas).toBeFocused();
    await context.close();
  });

  test('alertas en el menú ⋯ (operador, sin pestaña Alertas): insignia, resumen, Siguiente alerta y filtro', async ({ browser }, testInfo) => {
    // Sin alertas alcanzables en el mapa pero con 3 abiertas hoy: insignia + resumen, sin botón (el operador no abre /alertas).
    const sinMapa = await abrir(browser, testInfo.project.use.baseURL, 'operador', '/en-vivo', { infracciones: [alerta(1), alerta(2), alerta(3)] });
    await expect(sinMapa.p.getByRole('navigation', { name: 'Pestañas', exact: true }).getByRole('link', { name: /Alertas/ })).toHaveCount(0);
    await expect(sinMapa.p.locator('.qv-menu-ac__insignia')).toHaveText('3');
    const masA = sinMapa.p.getByRole('button', { name: /Más opciones del mapa/ });
    await expect(masA).toHaveAccessibleName(/3 alertas abiertas/);
    await masA.click();
    const menuA = sinMapa.p.getByRole('menu', { name: /Más opciones del mapa/ });
    await expect(menuA).toContainText('3 alertas abiertas');
    await expect(menuA.getByRole('menuitem', { name: 'Siguiente alerta' })).toHaveCount(0);
    await sinMapa.context.close();

    // Con una alerta en el mapa: Siguiente alerta funciona y el filtro de nivel se alterna y se ve activo.
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'operador', '/en-vivo', {
      posiciones: conAlertas, infracciones: [alerta(1)], esperar: '2 de 2',
    });
    await expect(p.locator('.qv-menu-ac__insignia')).toHaveText('1');
    const mas = p.getByRole('button', { name: /Más opciones del mapa/ });
    await mas.click();
    await expect(p.getByRole('menuitem', { name: 'Siguiente alerta' })).toBeEnabled();
    await p.getByRole('menuitemcheckbox', { name: '1 leve' }).click();
    await expect(mas).toHaveClass(/qv-chip-mapa--activo/);
    await mas.click();
    await expect(p.getByRole('menuitemcheckbox', { name: '1 leve' })).toHaveAttribute('aria-checked', 'true');
    await p.getByRole('menuitem', { name: 'Siguiente alerta' }).click();
    await expect(p.getByLabel(/Detalle del vehículo 9001TST/)).toBeVisible({ timeout: 30_000 }); // con el filtro, la única alerta alcanzable es la leve
    await context.close();
  });

  test('el menú ⋯ abierto queda por encima de la hoja del vehículo y se puede tocar', async ({ browser }, testInfo) => {
    const veh = vehiculo(1, id(11), '9002TST', 'reportando');
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo', `/en-vivo?vehiculo=${veh.vehiculoId}&sesion=${veh.id}`, {
      viewport: { width: 412, height: 700 }, posiciones: conAlertas, infracciones: [alerta(1)], esperar: '2 de 2',
    });
    const hoja = p.getByLabel('Detalle del vehículo 9002TST');
    await expect(hoja).toBeVisible({ timeout: 30_000 });
    const mas = p.getByRole('button', { name: /Más opciones del mapa/ });
    await mas.click();
    const menu = p.getByRole('menu', { name: /Más opciones del mapa/ });
    const cajaMenu = (await menu.boundingBox())!;
    const cajaHoja = (await hoja.boundingBox())!;
    expect(cajaMenu.y + cajaMenu.height, 'precondición: el menú y la hoja se solapan').toBeGreaterThan(cajaHoja.y);
    for (const ultimo of [p.getByRole('menuitem', { name: 'Refrescar' }), p.getByRole('menuitemcheckbox', { name: '1 leve' })]) {
      await ultimo.scrollIntoViewIfNeeded(); // el menú desplaza si no cabe (max-height 60 dvh)
      const dentro = await ultimo.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit !== null && el.contains(hit);
      });
      expect(dentro, 'el ítem recibe el toque (no queda bajo la hoja)').toBe(true);
    }
    await p.keyboard.press('Escape');
    // La hoja plegada sigue respondiendo al asa.
    const asa = p.locator('.qv-live-panel__asa');
    const antes = await p.locator('.qv-live-panel').getAttribute('data-hoja');
    await asa.click();
    await expect(p.locator('.qv-live-panel')).not.toHaveAttribute('data-hoja', antes ?? '');
    await context.close();
  });

  test('menú: foco al abrir sin ítems habilitados y tras un poll que deshabilita el enfocado', async ({ browser }, testInfo) => {
    // (a) Operador sin flota: todo deshabilitado -> el foco va al menú y Escape/Tab funcionan.
    const vacio = await abrir(browser, testInfo.project.use.baseURL, 'operador', '/en-vivo', { posiciones: () => [], esperar: '0 de 0' });
    const masV = vacio.p.getByRole('button', { name: /Más opciones del mapa/ });
    await masV.click();
    const menuV = vacio.p.getByRole('menu', { name: /Más opciones del mapa/ });
    await expect(menuV.locator('[role^="menuitem"]:not(:disabled)')).toHaveCount(0);
    await expect(menuV).toBeFocused();
    await vacio.p.keyboard.press('Escape');
    await expect(menuV).toHaveCount(0);
    await expect(masV).toBeFocused();
    await masV.click();
    await expect(menuV).toBeFocused();
    await vacio.p.keyboard.press('Tab');
    await expect(menuV).toHaveCount(0);
    await vacio.context.close();

    // (b) El poll quita la alerta mientras "Siguiente alerta" tiene el foco: el foco pasa al primer ítem habilitado.
    let hayAlertas = true;
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo', '/en-vivo', {
      posiciones: () => (hayAlertas ? conAlertas() : posiciones), esperar: '2 de 2',
    });
    const mas = p.getByRole('button', { name: /Más opciones del mapa/ });
    await mas.click();
    const siguiente = p.getByRole('menuitem', { name: 'Siguiente alerta' });
    await siguiente.focus();
    await expect(siguiente).toBeFocused();
    hayAlertas = false;
    await expect(siguiente).toBeDisabled({ timeout: 15_000 }); // próximo poll (2 s)
    await expect(p.getByRole('menuitem', { name: 'Flota', exact: true })).toBeFocused();
    await p.keyboard.press('Escape');
    await expect(mas).toBeFocused();
    await context.close();
  });

  test('los menús abiertos quedan dentro del viewport a 360 y 412 px (cada uno anclado a su borde de la fila)', async ({ browser }, testInfo) => {
    const { context, p } = await abrir(browser, testInfo.project.use.baseURL, 'admin_quivo', '/en-vivo', { posiciones: conAlertas, infracciones: [alerta(1)], esperar: '2 de 2' });
    for (const ancho of [360, 412]) {
      await p.setViewportSize({ width: ancho, height: 800 });
      for (const [boton, menu] of [
        [/Cambiar línea/, /Cambiar línea/],
        [/Más opciones del mapa/, /Más opciones del mapa/],
      ] as const) {
        await p.getByRole('button', { name: boton }).click();
        const caja = (await p.getByRole('menu', { name: menu }).boundingBox())!;
        expect(caja.x, `${ancho}px ${menu}: dentro por la izquierda`).toBeGreaterThanOrEqual(0);
        expect(caja.x + caja.width, `${ancho}px ${menu}: dentro por la derecha`).toBeLessThanOrEqual(ancho);
        await p.keyboard.press('Escape');
      }
    }
    await context.close();
  });

  test('"Línea 16" se lee completa en el chip a 360 y 412 px con la salud más ancha ("23 de 40 · hace 120 s")', async ({ browser }, testInfo) => {
    const lineaId = id(11);
    const flota = Array.from({ length: 40 }, (_, n) => vehiculo(n + 1, lineaId, `16${String(n).padStart(2, '0')}PIL`, n < 23 ? 'reportando' : 'finalizado'));
    let respondidas = 0;
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo', { width: 412, height: 800 });
    await p.clock.install({ time: Date.now() });
    await p.route('**/v1/lineas', (r) => r.fulfill({ json: [linea(11, '16', 'Línea 16')] }));
    // Solo el primer poll responde: así "hace N s" crece de verdad al adelantar el reloj.
    await p.route('**/v1/reportes/en-vivo/posiciones*', (r) => (respondidas++ === 0 ? r.fulfill({ json: flota }) : new Promise<void>(() => undefined)));
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const salud = p.locator('.qv-chip-mapa--salud');
    await expect(salud).toContainText('23 de 40', { timeout: 30_000 });
    await p.getByRole('button', { name: /Cambiar línea/ }).click();
    await p.getByRole('menuitemradio', { name: 'Línea 16' }).click();
    await p.clock.fastForward(120_000);
    await expect(salud).toContainText(/23 de 40/);
    for (const ancho of [412, 360]) {
      await p.setViewportSize({ width: ancho, height: 800 });
      if (ancho === 412) await expect(salud).toContainText(/120\s*s/); // a 360 los segundos ceden su sitio a la línea
      const nombre = p.locator('.qv-chip-mapa__nombre');
      await expect(nombre).toHaveText('Línea 16');
      const recortado = await nombre.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(recortado, `${ancho}px: el nombre de la línea no se recorta`).toBe(false);
    }
    await context.close();
  });
});

// La barra de mando sigue en tablet/escritorio (> 720 px): a 900 px Flota es una hoja. Su cobertura vive acá porque el
// celular (<= 720 px) usa los chips.
test.describe('En vivo a 900 px: barra de mando (sesión simulada)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
  const pos = {
    id: id(1), deviceId: 'd1', activa: true, vehiculoPlaca: '9002TST', conductorNombre: 'X', lineaId: id(4), lineaNombre: 'Línea 16',
    rutaSentido: 'ida', lat: -17.38, lng: -66.3, accuracy: 5, speed: 20, totalPuntos: 10, estadoFrescura: 'reportando',
    vehiculoId: id(2), infraccionesAbiertas: 0,
  };
  // Las 3 alertas son de OTRA sesión del vehículo: la ganadora de /posiciones dice 0.
  const alerta = (n: number) => ({
    sindicatoId: id(1), vehiculoId: id(2), conductorId: id(3), lineaId: id(4), rutaId: id(5), reglaId: null, finTs: null,
    lat: -17.38, lng: -66.3, sancionId: null, atendidaPor: null, atendidaEn: null, nota: null, createdAt: new Date().toISOString(),
    id: id(100 + n), sesionId: id(200 + n), tipo: 'desvio_ruta', gravedad: 'grave', estado: 'abierta', inicioTs: new Date().toISOString(),
    vehiculoPlaca: '9002TST', conductorNombre: 'X', lineaNombre: 'Línea 16', detalle: { distanciaMaxM: 150, duracionS: 60, puntos: 4 },
  });

  test('barra de mando: sin chips, h1 propio; Flota abre, Escape cierra y devuelve el foco; vacío la deshabilita', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo', { width: 900, height: 900 });
    await p.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await p.route('**/v1/reportes/en-vivo/molinos*', (r) => r.fulfill({ json: { lineas: [], colas: [] } }));
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const barra = p.getByLabel('Barra de mando de En vivo');
    await expect(barra).toBeVisible({ timeout: 30_000 });
    await expect(p.locator('.qv-chips-mapa')).toHaveCount(0);
    await expect(p.getByRole('heading', { name: 'En vivo', level: 1 })).toHaveCount(1); // el de la barra; el oculto es solo del celular
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const flota = p.locator('.qv-live-barra__flota');
    await expect(flota).toBeEnabled();
    await expect(flota).toHaveAttribute('aria-pressed', 'false');
    await flota.click();
    await expect(flota).toHaveAttribute('aria-pressed', 'true');
    await expect(p.locator('#qv-live-flota')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(flota).toHaveAttribute('aria-pressed', 'false');
    await expect(p.locator('#qv-live-flota')).toBeHidden();
    await expect(flota).toBeFocused();
    await flota.click(); // otra vez: alterna también con el botón
    await expect(flota).toHaveAttribute('aria-pressed', 'true');
    await flota.click();
    await expect(flota).toHaveAttribute('aria-pressed', 'false');

    // Sin vehículos no hay panel que abrir.
    await p.unroute('**/v1/reportes/en-vivo/posiciones*');
    await p.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [] }));
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(p.getByText('Sin vehículos en ruta activa')).toBeVisible({ timeout: 30_000 });
    await expect(p.locator('.qv-live-barra__flota')).toBeDisabled();
    await context.close();
  });

  test('barra de mando: el resumen cuenta las alertas abiertas de hoy aunque /posiciones no las traiga', async ({ browser }, testInfo) => {
    const { context, page: p } = await paginaConSesion(browser, testInfo.project.use.baseURL, 'admin_quivo', { width: 900, height: 900 });
    let hoy: unknown[] = [alerta(1), alerta(2), alerta(3)];
    await p.route('**/v1/reportes/en-vivo/posiciones*', (r) => r.fulfill({ json: [pos] }));
    await p.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ json: hoy }));
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const barra = p.getByLabel('Barra de mando de En vivo');
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
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(barra).toContainText('Sin infracciones abiertas', { timeout: 30_000 });
    await expect(barra.getByRole('link', { name: 'Ver alertas' })).toHaveCount(0);

    // Sin datos y con la consulta fallando (reintentos ~15 s) no queda un grupo vacío.
    await p.unroute('**/v1/reportes/en-vivo/infracciones*');
    await p.route('**/v1/reportes/en-vivo/infracciones*', (r) => r.fulfill({ status: 500, json: { message: 'x' } }));
    await p.goto('/en-vivo', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(barra).toContainText('Alertas del día sin cargar', { timeout: 40_000 });
    await context.close();
  });
});
