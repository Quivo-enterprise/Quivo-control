import { expect, test, type Page } from '@playwright/test';

// Decisión de logout del panel ante POST /v1/auth/refresh (QUI-359): un 503 conserva la
// sesión y reintenta, un 401 la borra, y se envía el token ya rotado en localStorage.
// La API se simula con page.route; la sesión se siembra en localStorage como en mobile.spec.

const STORAGE_KEY = 'quivo.session';
const AHORA = new Date('2026-06-01T12:00:00Z');
const USER = { id: 'u1', email: 'admin@quivo.local', rol: 'admin_quivo', sindicatoId: null };

// JWT sin firma válida: el cliente solo decodifica `exp` para programar el refresh.
function jwt(expSeg: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeg })}.firma`;
}
const vence = (segDesdeAhora: number) => jwt(AHORA.getTime() / 1000 + segDesdeAhora);

async function sembrar(page: Page, token: string, refreshToken: string) {
  await page.clock.install({ time: AHORA });
  await page.addInitScript(
    ([key, sesion]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, sesion);
    },
    [STORAGE_KEY, JSON.stringify({ user: USER, token, refreshToken })],
  );
}

const sesionGuardada = (page: Page) =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), STORAGE_KEY);

test.describe('refresh de sesión del panel', () => {
  test('503 conserva la sesión y reintenta; después rota', async ({ page }) => {
    const enviados: string[] = [];
    await page.route('**/v1/auth/refresh', async (route) => {
      enviados.push(route.request().postDataJSON().refreshToken);
      if (enviados.length === 1) return route.fulfill({ status: 503, body: '{}' });
      return route.fulfill({
        json: { accessToken: vence(900), refreshToken: 'R2' },
      });
    });
    await sembrar(page, vence(-10), 'R1');
    await page.goto('/');

    await expect.poll(() => enviados.length).toBe(1);
    expect((await sesionGuardada(page)).refreshToken).toBe('R1'); // 503: sigue logueado

    await page.clock.fastForward(6_000); // primer backoff: 5 s
    await expect.poll(() => enviados.length).toBe(2);
    await expect.poll(async () => (await sesionGuardada(page))?.refreshToken).toBe('R2');
    expect(enviados).toEqual(['R1', 'R1']);
  });

  test('401 borra la sesión', async ({ page }) => {
    await page.route('**/v1/auth/refresh', (route) => route.fulfill({ status: 401, body: '{}' }));
    await sembrar(page, vence(-10), 'R1');
    await page.goto('/');

    await expect.poll(() => sesionGuardada(page)).toBeNull();
  });

  test('envía el token ya rotado en storage, no el de memoria', async ({ page }) => {
    const enviados: string[] = [];
    await page.route('**/v1/auth/refresh', (route) => {
      enviados.push(route.request().postDataJSON().refreshToken);
      return route.fulfill({ json: { accessToken: vence(900), refreshToken: 'R3' } });
    });
    // Memoria: R1 con access token que vence en 40 s (el timer dispara a los 10 s).
    await sembrar(page, vence(40), 'R1');
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();
    expect(enviados).toEqual([]);

    // "Otra pestaña" rota a R2 (sin evento `storage` en esta pestaña) y el access token ya vence.
    await page.evaluate(
      ([key, sesion]) => window.localStorage.setItem(key, sesion),
      [STORAGE_KEY, JSON.stringify({ user: USER, token: vence(-10), refreshToken: 'R2' })],
    );
    await page.clock.fastForward(15_000);

    await expect.poll(() => enviados.length).toBe(1);
    expect(enviados[0]).toBe('R2');
  });
});
