import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ICONO_NIVEL, svgGlifoEstado, svgIcono, type EstadoGlifo } from '../../packages/design-system/src/ui/route-map-vehiculo';

// Arnés determinista de los marcadores de vehículo de En vivo (Google Maps no carga sin clave en
// local/CI). Reproduce el DOM de `crearElementoVehiculo` (route-map-google.tsx) con el CSS real del
// design-system. Si cambia ese DOM, hay que actualizar `marcador()` acá.
const DS = path.resolve(__dirname, '../../packages/design-system/src');
const css = ['tokens.css', 'styles.css'].map((f) => readFileSync(path.join(DS, f), 'utf8')).join('\n');
const OXANIUM = process.env.OXANIUM_TTF ?? '';
const fuente = OXANIUM && existsSync(OXANIUM)
  ? `@font-face{font-family:Oxanium;font-weight:800;src:url(data:font/ttf;base64,${readFileSync(OXANIUM).toString('base64')})}:root{--qv-font-display:Oxanium}`
  : process.env.MARKERS_FONT
    ? `:root{--qv-font-display:${process.env.MARKERS_FONT}}` // fuerza una fuente de reserva (CI no tiene la del sistema local)
    : '';

type Caso = { placa?: string; estado: EstadoGlifo; sel?: boolean; alerta?: 'leve' | 'grave' | 'gravisima'; n?: number; molinos?: string; linea?: string };
const CASOS: Caso[] = [
  { placa: '4701EHA', estado: 'reportando' },
  { placa: '2230KLM', estado: 'detenido' },
  { placa: '5163NCF', estado: 'en_pausa' },
  { placa: '4120MZX', estado: 'perdido' },
  { placa: '3318TRB', estado: 'finalizado' },
  { placa: '7712ABC', estado: 'inactivo' },
  { placa: '1010XYZ', estado: 'sin_datos' },
  { placa: '1616PIL', estado: 'reportando', sel: true },
  { placa: '9001ALR', estado: 'reportando', alerta: 'grave', n: 3, linea: '#e11d48' },
  { placa: '9002MOL', estado: 'en_pausa', molinos: 'M2' },
  { placa: '9003ALM', estado: 'perdido', alerta: 'gravisima', n: 12, molinos: 'M', linea: '#ffffff' },
  { placa: '1717SEL', estado: 'inactivo', sel: true, alerta: 'leve', molinos: 'M3', linea: '#0ea5e9' },
  { estado: 'reportando' },
];

async function montar(page: Page, estilos: string, casos: Caso[], ancho: number) {
  await page.setViewportSize({ width: ancho, height: 760 });
  const html = `<!doctype html><meta name=viewport content="width=device-width"><style>${estilos}${fuente}
    body{margin:0;background:#cbd5e1} .m{position:absolute;display:flex;width:max-content;transform:translate(-50%,-100%)} /* ancla de Advanced Marker: centro-abajo de la caja */ </style><body></body>`;
  await page.setContent(html);
  await page.evaluate(
    ({ casos, glifos, niveles }) => {
      casos.forEach((c: Caso, i: number) => {
        const host = document.createElement('div');
        host.className = 'm';
        // 2 columnas a 180 px: con fuentes anchas la píldora seleccionada (~130 px) no pisa la zona táctil del vecino.
        host.style.left = `${110 + (i % 2) * 180}px`;
        host.style.top = `${60 + Math.floor(i / 2) * 90}px`;
        const raiz = document.createElement('div');
        raiz.className = `qv-gmap-veh qv-gmap-veh--est-${c.estado} qv-gmap--clickable`;
        raiz.id = `v${i}`;
        raiz.setAttribute('role', 'button');
        raiz.setAttribute('aria-pressed', c.sel ? 'true' : 'false');
        raiz.tabIndex = 0;
        if (c.sel) raiz.classList.add('qv-gmap-veh--seleccionado');
        if (c.linea) raiz.style.setProperty('--qv-gmap-veh-linea', c.linea);
        raiz.innerHTML = '<span class="qv-gmap-veh__disco"><span class="qv-gmap-veh__bus"></span></span><span class="qv-gmap-veh__anillo" aria-hidden="true"></span>';
        if (c.alerta) {
          raiz.classList.add(`qv-gmap-veh--alerta-${c.alerta}`, 'qv-gmap-veh--alerta-atendida');
          raiz.insertAdjacentHTML('beforeend', `<span class="qv-gmap-veh__alerta" aria-hidden="true">${niveles[c.alerta]}${c.n && c.n > 1 ? `<span class="qv-gmap-veh__alerta-n">${c.n}</span>` : ''}</span>`);
        }
        if (c.molinos) raiz.insertAdjacentHTML('beforeend', `<span class="qv-gmap-veh__molinos" aria-hidden="true">${c.molinos}</span>`);
        raiz.insertAdjacentHTML('beforeend', `<span class="qv-gmap-veh__estado" aria-hidden="true">${glifos[c.estado]}</span>`);
        if (c.placa) raiz.insertAdjacentHTML('beforeend', `<span class="qv-gmap-veh__placa" aria-hidden="true">${c.placa}</span>`);
        host.appendChild(raiz);
        document.body.appendChild(host);
      });
    },
    {
      casos,
      glifos: Object.fromEntries(CASOS.map((c) => [c.estado, svgGlifoEstado(c.estado)])),
      niveles: Object.fromEntries(Object.entries(ICONO_NIVEL).map(([k, v]) => [k, svgIcono(v, 'qv-gmap-veh__alerta-icono')])),
    },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const SHOTS = process.env.MARKERS_SHOTS_DIR ?? '';
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

test.describe('marcadores de vehículo: píldora móvil', () => {
  test('412 px: relleno, prefijo, tamaños, zona táctil y adjuntos', async ({ page }) => {
    await montar(page, css, CASOS, 412);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'b9_marcadores.png') });
    }
    const esperado: Record<string, [string, string]> = {
      reportando: ['#15803d', ''],
      detenido: ['#0e7490', '■'],
      en_pausa: ['#b45309', '–'],
      perdido: ['#b91c1c', '!'],
      finalizado: ['#475569', '✓'],
      inactivo: ['#64748b', '○'],
      sin_datos: ['#64748b', '○'],
    };
    for (let i = 0; i < CASOS.length; i++) {
      const c = CASOS[i]!;
      const r = await page.evaluate((i) => {
        const raiz = document.getElementById(`v${i}`)!;
        const placa = raiz.querySelector('.qv-gmap-veh__placa');
        const vis = (s: string) => {
          const e = raiz.querySelector(s);
          return e ? getComputedStyle(e).display !== 'none' : false;
        };
        const box = (e: Element | null) => {
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
        };
        const after = getComputedStyle(raiz, '::after');
        const af = raiz.getBoundingClientRect();
        const ph = raiz.parentElement!.getBoundingClientRect();
        return {
          placa: placa ? getComputedStyle(placa) && { bg: getComputedStyle(placa).backgroundColor, fg: getComputedStyle(placa).color, radius: getComputedStyle(placa).borderTopLeftRadius, border: getComputedStyle(placa).borderTopWidth + ' ' + getComputedStyle(placa).borderTopColor, font: getComputedStyle(placa).fontSize + ' ' + getComputedStyle(placa).fontWeight, prefix: getComputedStyle(placa, '::before').content, barra: getComputedStyle(placa).borderLeftWidth + ' ' + getComputedStyle(placa).borderLeftColor } : null,
          disco: vis('.qv-gmap-veh__disco'), anillo: vis('.qv-gmap-veh__anillo'), estado: vis('.qv-gmap-veh__estado'),
          pill: box(placa), raiz: box(raiz), host: { x: ph.x + ph.width / 2, y: ph.bottom },
          texto: (() => { if (!placa) return null; const rg = document.createRange(); rg.selectNodeContents(placa); const t = rg.getBoundingClientRect(); return { x: t.x, y: t.y, r: t.right, b: t.bottom }; })(),
          alerta: box(raiz.querySelector('.qv-gmap-veh__alerta')), molinos: box(raiz.querySelector('.qv-gmap-veh__molinos')),
          hit: { w: parseFloat(after.width), h: parseFloat(after.height) },
          esquinas: ['.qv-gmap-veh__alerta', '.qv-gmap-veh__molinos'].flatMap((q) => {
            const b = raiz.querySelector(q)?.getBoundingClientRect();
            if (!b) return [];
            return [[b.left + 1, b.top + 1], [b.right - 1, b.top + 1], [b.left + 1, b.bottom - 1], [b.right - 1, b.bottom - 1]].map(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.qv-gmap-veh') === raiz);
          }), afterContent: after.content, rootBox: { w: af.width, h: af.height },
        };
      }, i);
      if (!c.placa) {
        expect(r.disco, 'sin placa conserva el disco').toBe(true);
        continue;
      }
      const [fill, prefijo] = esperado[c.estado]!;
      expect(r.disco || r.anillo || r.estado).toBe(false);
      expect(r.placa!.bg).toBe(c.sel ? rgb('#3226b4') : rgb(fill));
      expect(r.placa!.fg).toBe('rgb(255, 255, 255)');
      expect(r.placa!.radius).toMatch(/^(999|\d{3,})/);
      expect(r.placa!.font).toBe(c.sel ? '17px 800' : '13px 800');
      // Chrome redondea los bordes al píxel físico: 2,5 px se computa 2 px con DPR 1.
      // Chrome redondea los bordes al píxel físico (DPR 1): 2,5 px se computa 2 px.
      expect(r.placa!.border).toBe(c.sel ? '4px rgb(255, 255, 255)' : '2px rgb(255, 255, 255)');
      // La barra izquierda lleva el color de la línea (blanco si no hay), también seleccionada.
      expect(r.placa!.barra).toBe(`${c.sel ? 6 : 5}px ${c.linea ? rgb(c.linea) : 'rgb(255, 255, 255)'}`);
      const pref = r.placa!.prefix === 'none' || r.placa!.prefix === 'normal' ? '' : r.placa!.prefix.replace(/^"|"$/g, '');
      expect(pref, `prefijo de ${c.estado}${c.sel ? ' seleccionada' : ''}`).toBe(prefijo);
      const pill = r.pill!;
      expect(Math.round(pill.h)).toBe(c.sel ? 36 : 26);
      expect(pill.w).toBeGreaterThanOrEqual(c.sel ? 104 : 76);
      // Centrada sobre la posición (el motor ancla el centro-abajo de la caja del contenido en la coordenada).
      expect(Math.abs(pill.x + pill.w / 2 - r.host.x)).toBeLessThan(1);
      expect(Math.abs(pill.y + pill.h / 2 - r.host.y)).toBeLessThan(1.5);
      // Zona táctil >= 44 de alto y >= 44 de ancho, centrada en la píldora.
      expect(r.hit.h).toBeGreaterThanOrEqual(44);
      expect(r.hit.w).toBeGreaterThanOrEqual(44);
      // Adjuntos dentro del viewport y sin tapar ningún glifo de la placa (caja del TEXTO, no de la píldora).
      const inter = (a: { x: number; y: number; r: number; b: number }, t: { x: number; y: number; r: number; b: number }) =>
        a.x < t.r && a.r > t.x && a.y < t.b && a.b > t.y;
      // Cada esquina de cada insignia (pointer-events: none) cae dentro de la zona táctil del marcador.
      expect(r.esquinas.every(Boolean), `insignias cubiertas por la zona táctil (${c.placa})`).toBe(true);
      expect(r.esquinas.length).toBe((c.alerta ? 4 : 0) + (c.molinos ? 4 : 0));
      if (r.alerta) {
        expect(r.alerta.r).toBeLessThanOrEqual(412);
        expect(r.alerta.y).toBeGreaterThanOrEqual(0);
        expect(inter(r.alerta, r.texto!), 'la alerta no toca el texto de la placa ').toBe(false);
      }
      if (r.molinos) {
        expect(r.molinos.x).toBeGreaterThanOrEqual(0);
        expect(inter(r.molinos, r.texto!), 'Molinos no toca el texto de la placa').toBe(false);
      }
    }
  });

  test('412 px: prefijo exacto, foco visible y aria intactos', async ({ page }) => {
    await montar(page, css, CASOS, 412);
    const content = await page.evaluate(() => getComputedStyle(document.querySelector('#v3 .qv-gmap-veh__placa')!, '::before').content);
    expect(content).toBe('"!"');
    await page.locator('#v0').focus();
    const foco = await page.evaluate(() => {
      const r = document.getElementById('v0')!;
      const s = getComputedStyle(r);
      return { role: r.getAttribute('role'), pressed: r.getAttribute('aria-pressed'), outline: s.outlineStyle, w: s.outlineWidth, radius: s.borderTopLeftRadius, placaOculta: r.querySelector('.qv-gmap-veh__placa')!.getAttribute('aria-hidden') };
    });
    expect(foco.role).toBe('button');
    expect(foco.pressed).toBe('false');
    expect(foco.outline).toBe('solid');
    expect(foco.w).toBe('3px');
    expect(foco.radius).toMatch(/^(999|\d{3,})/);
    expect(foco.placaOculta).toBe('true');
  });

  test('1440 px: escritorio conserva disco, anillo, placa colgante y zona táctil base', async ({ page }) => {
    await montar(page, css, CASOS, 1440);
    for (let i = 0; i < CASOS.length; i++) {
      const c = CASOS[i]!;
      const r = await page.evaluate((i) => {
        const raiz = document.getElementById(`v${i}`)!;
        const cs = (s: string, ps?: string) => { const e = raiz.querySelector(s); return e ? getComputedStyle(e, ps) : null; };
        const placa = cs('.qv-gmap-veh__placa');
        const root = getComputedStyle(raiz);
        const after = getComputedStyle(raiz, '::after');
        return {
          root: { w: root.width, h: root.height, radius: root.borderTopLeftRadius },
          disco: cs('.qv-gmap-veh__disco')!.display, anillo: cs('.qv-gmap-veh__anillo')!.display, estado: cs('.qv-gmap-veh__estado')!.display,
          placa: placa && { pos: placa.position, radius: placa.borderTopLeftRadius, bg: placa.backgroundColor, font: placa.fontSize + ' ' + placa.fontWeight, barra: placa.borderLeftWidth, pad: placa.paddingLeft + ' ' + placa.paddingRight, minW: placa.minWidth, prefix: cs('.qv-gmap-veh__placa', '::before')!.content, top: placa.top },
          hit: { w: after.width, h: after.height },
        };
      }, i);
      expect(r.root, 'raíz 44x44').toEqual({ w: '44px', h: '44px', radius: '50%' });
      expect([r.disco, r.anillo, r.estado].every((d) => d !== 'none'), 'disco, anillo e insignia visibles').toBe(true);
      expect(r.hit).toEqual({ w: '62px', h: '52px' });
      if (!c.placa) continue;
      expect(r.placa).toEqual({
        pos: 'absolute', radius: '3px', bg: 'rgba(15, 17, 26, 0.85)', font: '11px 700', barra: '4px', pad: '4px 5px', minW: '0px',
        prefix: expect.stringMatching(/^(none|normal)$/), top: c.sel ? '59px' : '52px',
      });
    }
  });
});
