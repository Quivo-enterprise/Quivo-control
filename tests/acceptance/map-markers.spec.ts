import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ICONO_NIVEL, svgGlifoEstado, svgIcono, type EstadoGlifo } from '../../packages/design-system/src/ui/route-map-vehiculo';

// Arnés determinista de los marcadores de vehículo de En vivo (Google Maps no carga sin clave en
// local/CI). Reproduce el DOM de `crearElementoVehiculo` (route-map-google.tsx) con el CSS real del
// design-system. Si cambia ese DOM, hay que actualizar `marcador()` acá.
const DS = path.resolve(__dirname, '../../packages/design-system/src');
const css = ['tokens.css', 'styles.css'].map((f) => readFileSync(path.join(DS, f), 'utf8')).join('\n');
const cssHead = ['tokens.css', 'styles.css']
  .map((f) => execSync(`git show HEAD:packages/design-system/src/${f}`, { cwd: DS, maxBuffer: 1 << 26 }).toString())
  .join('\n');
const OXANIUM = process.env.OXANIUM_TTF ?? '';
const fuente = OXANIUM && existsSync(OXANIUM)
  ? `@font-face{font-family:Oxanium;font-weight:800;src:url(data:font/ttf;base64,${readFileSync(OXANIUM).toString('base64')})}:root{--qv-font-display:Oxanium}`
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
  { placa: '9001ALR', estado: 'reportando', alerta: 'grave', n: 3 },
  { placa: '9002MOL', estado: 'en_pausa', molinos: 'M2' },
  { placa: '9003ALM', estado: 'perdido', alerta: 'gravisima', n: 12, molinos: 'M', linea: '#ffffff' },
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
        host.style.left = `${70 + (i % 3) * 120}px`;
        host.style.top = `${60 + Math.floor(i / 3) * 90}px`;
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
      inactivo: ['#64748b', ''],
      sin_datos: ['#64748b', ''],
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
          placa: placa ? getComputedStyle(placa) && { bg: getComputedStyle(placa).backgroundColor, fg: getComputedStyle(placa).color, radius: getComputedStyle(placa).borderTopLeftRadius, border: getComputedStyle(placa).borderTopWidth + ' ' + getComputedStyle(placa).borderTopColor, font: getComputedStyle(placa).fontSize + ' ' + getComputedStyle(placa).fontWeight, prefix: getComputedStyle(placa, '::before').content } : null,
          disco: vis('.qv-gmap-veh__disco'), anillo: vis('.qv-gmap-veh__anillo'), estado: vis('.qv-gmap-veh__estado'),
          pill: box(placa), raiz: box(raiz), host: { x: ph.x + ph.width / 2, y: ph.bottom },
          texto: (() => { if (!placa) return null; const rg = document.createRange(); rg.selectNodeContents(placa); const t = rg.getBoundingClientRect(); return { x: t.x, y: t.y, r: t.right, b: t.bottom }; })(),
          alerta: box(raiz.querySelector('.qv-gmap-veh__alerta')), molinos: box(raiz.querySelector('.qv-gmap-veh__molinos')),
          hit: { w: parseFloat(after.width), h: parseFloat(after.height) }, afterContent: after.content, rootBox: { w: af.width, h: af.height },
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
      expect(r.placa!.border).toBe(c.sel ? '4px rgb(255, 255, 255)' : `${/^2(\.5)?px/.test(r.placa!.border) ? r.placa!.border.split(' ')[0] : 'x'} rgb(255, 255, 255)`);
      const pref = r.placa!.prefix === 'none' || r.placa!.prefix === 'normal' ? '' : r.placa!.prefix.replace(/^"|"( \/ "")?$/g, '');
      expect(c.sel ? '' : pref).toBe(c.sel ? '' : prefijo);
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

  test('412 px: prefijo con texto alternativo vacío, foco visible y aria intactos', async ({ page }) => {
    await montar(page, css, CASOS, 412);
    const content = await page.evaluate(() => getComputedStyle(document.querySelector('#v3 .qv-gmap-veh__placa')!, '::before').content);
    expect(content).toContain('!');
    await page.locator('#v0').focus();
    const foco = await page.evaluate(() => {
      const r = document.getElementById('v0')!;
      const s = getComputedStyle(r);
      return { role: r.getAttribute('role'), pressed: r.getAttribute('aria-pressed'), outline: s.outlineStyle, w: s.outlineWidth, radius: s.borderTopLeftRadius };
    });
    expect(foco.role).toBe('button');
    expect(foco.outline).toBe('solid');
    expect(foco.radius).toMatch(/^(999|\d{3,})/);
  });

  test('1440 px: escritorio idéntico al CSS de HEAD (estilos computados y píxeles)', async ({ page }) => {
    const medir = async (estilos: string) => {
      await montar(page, estilos, CASOS, 1440);
      const estilosCalc = await page.evaluate(() => {
        const props = ['width', 'height', 'transform', 'borderRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'display', 'top', 'left', 'right', 'bottom', 'padding', 'borderLeftWidth', 'boxShadow'] as const;
        return [...document.querySelectorAll('.qv-gmap-veh, .qv-gmap-veh *')].map((e) => {
          const s = getComputedStyle(e) as unknown as Record<string, string>;
          const p = ['', '::before', '::after'].map((ps) => {
            const x = getComputedStyle(e, ps) as unknown as Record<string, string>;
            return props.map((k) => x[k]).join('|') + x.content;
          });
          return `${(e as HTMLElement).className}:${props.map((k) => s[k]).join('|')}:${p.join('~')}`;
        });
      });
      return { estilosCalc, img: await page.screenshot() };
    };
    const nuevo = await medir(css);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, 'b9_marcadores_desktop_nuevo.png') });
    }
    const viejo = await medir(cssHead);
    expect(nuevo.estilosCalc).toEqual(viejo.estilosCalc);
    expect(nuevo.img.equals(viejo.img), 'screenshot 1440 idéntico').toBe(true);
  });
});
