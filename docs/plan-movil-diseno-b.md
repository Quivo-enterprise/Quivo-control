# Plan: aplicar el diseño B en el celular (fase 3 del plan móvil)

## Por qué existe
El plan `docs/plan-movil-rediseno.md` (D–H) quedó en producción con r37 el 5/11, y el CTO abrió la PWA y vio **el panel viejo responsive, no el diseño B elegido en el bake-off**. Se hizo la estructura (pestañas, Hoy, Alertas, Salidas móvil), pero los tokens, la tipografía y los componentes del comp nunca se portaron. Las revisiones de cada PR miraron funciones, tests, accesibilidad y overflow; ninguna comparó capturas contra el comp.

**Regla de este plan:** cada PR lleva su captura a 412 px junto al comp `docs/movil-comps/propuesta-b.png` y no se cierra hasta que la comparación pasa. Antes de pedir deploy, el CTO ve las capturas.

## Decisiones del CTO (5/11, noche)
1. **Medidas del comp:** en celular se usan los px de B (cuerpo 16, datos 18–24, placa 30, cuenta regresiva 42). Reemplaza la base de 18 px de la fase D (`html{font-size:112.5%}`), que se quita. Los inputs siguen ≥16 px.
2. **En vivo:** mapa limpio como el comp, con dos chips flotantes ("Línea 16" y "N de M · hace X s"). Flota, Días anteriores y los controles Seguir/ampliar/refrescar pasan a un botón ⋯. Las alertas quedan en su pestaña. No se pierde ninguna función.
3. **Más:** pasa a ser una página `/mas` como el comp (tarjeta de usuario, lista, Cerrar sesión), **incluyendo** Sindicatos, Errores de sync y Usuarios según el rol.

## PRs, en orden (cada uno se puede desplegar solo)
1. **Tokens y escala:** bloque de tokens de B dentro de `@media (max-width:720px)` (con su variante oscura), fuera la base de 18 px, Oxanium para datos y Montserrat para cuerpo. Escritorio sin cambios.
2. **Shell:** un solo encabezado sólido (sin la topbar de vidrio duplicada con `PageHeader`), barra de pestañas de 76 px con badge de alertas, márgenes de 16 px.
3. **Placa y primitivas:** `PlateBadge` estilo cartel (borde grueso, Oxanium) en celular; tarjeta, botón, etiqueta y rótulo de B.
4. **Hoy.**
5. **Alertas.**
6. **Salidas.**
7. **Más como página.**
8. **En vivo: chips y menú ⋯.**
9. **En vivo: marcadores como píldora de placa por estado** (con forma repetida).
10. **En vivo: hoja del vehículo.**

Cada PR: Sonnet implementa; gate `/code-review` + `/ponytail-review` + `web-design-guidelines` + `impeccable audit`; captura contra el comp; `ci` y `acceptance` en verde; escritorio sin regresión (`admin-panel.spec`).

## Datos que el comp muestra y hoy no existen
Ver la sección 7 del inventario: "vuelta N" y velocidad en la tarjeta de Hoy, conteo por gravedad, nombre del sindicato en la tarjeta de usuario. Cada PR decide: dato real si ya está en el frontend; si no, se omite y se anota (no se inventa).

---

# Inventario de diferencias (comp B contra producción r37)
Generado el 5/11 leyendo `propuesta-b.html`, las capturas de producción a 412 px y el código. Los números de línea son de `main` en `b159e04`.

# Gap inventory: propuesta B (mobile) vs production (<=720 px)

Method: read `propuesta-b.html` in full, the 5 production screenshots, `styles.css`, `tokens.css`, `layout.tsx`, `nav-items.ts`, the Hoy / Alertas / Salidas / En vivo components and the map code. Nothing was edited and no servers were started. Anything I did not read is marked "not confirmed". Line numbers are in `packages/design-system/src/styles.css` unless another path is given.

## 0. Root cause: why production reads as "the old panel made responsive"

Four causes explain the screenshots:

1. **The comp's tokens were never ported.** Production keeps the panel tokens: Oxanium weight 500 in the page header, translucent glass topbar, 1 px borders, `--qv-radius-lg` 1 rem. The comp's Oxanium-for-data / Montserrat-for-body split is missing.
2. **A duplicate title is stacked.** The sticky glass topbar (`.qv-admin-layout__topbar`, L5038) shows "Hoy". Below it `PageHeader` renders a second, large, light-weight "Hoy" plus a subtitle (`.qv-page-header__title`, L1650, 1.5rem, weight not set, so it renders thin). The comp has ONE header: a white band with h2 22/800 and a 14/600 subtitle.
3. **Desktop components were reused unchanged.** `Card`, `DataTable` stack, `Tag`, `PlateBadge`, `StatusBadge`, `qv-live-btn`, `qv-live-panel` and `qv-live-nivel` all keep desktop styling, with only the "thick border" retrofitted in PRs F/G/H.
4. **Mobile base is 18 px instead of 16 px.** `html{font-size:112.5%}` (L5382-5384) makes every rem 18 px. All the comp's px values (16, 22, 30...) and the existing rem values (0.75rem = 13.5 px, 0.875rem = 15.75 px) end up different. Plan for this explicitly (see section 2).

Scope of the current CSS: mobile rules live in `@media (max-width: 720px)` blocks, mostly appended at the end of the file (L5021, L5288, L5389, L5408, L5440, L5547, L5735, L5957). The base `.qv-tabbar`, `.qv-hoy*`, `.qv-alertas*` and `.qv-fila-acciones` rules are OUTSIDE a media query, but only render on mobile because their markup only mounts there (`HoyMovil` behind `useEsMovil`) or because `.qv-tabbar{display:none}` (L5422). Caveat: `.qv-alertas*` and `.qv-base-rapida*` base rules (L5600+) apply on desktop too, because `/alertas` has no mobile fork. Anything new in those blocks needs an explicit `@media (max-width:720px)`.

## 1. Comp token block (full, from `propuesta-b.html` L11-16)

```css
:root{--pri:#3226b4;--pri-soft:#dcd9fb;--pri-sub:#efeefc;--on-pri:#fff;--acc:#fd9e15;--page:#e6e8f2;--bg:#f1f5f9;--surf:#fff;--surf2:#f8fafc;--ink:#0f172a;--mute:#475569;--line:#e2e8f0;--line2:#94a3b8;
--bad:#dc2626;--bad-t:#b91c1c;--bad-bg:#fee2e2;--ok:#16a34a;--ok-t:#15803d;--ok-bg:#dcfce7;--warn:#d97706;--warn-t:#92400e;--warn-bg:#fef3c7;--info:#0891b2;
--bezel:#1b1a2e;--map-bg:#e4e9f0;--map-st:#fff;--map-green:#cfe8d3;--map-water:#c3e0f0;--map-lbl:#475569;--plate:#fff;--plate-ink:#0f172a;--wa:#15803d;
--d:'Oxanium',ui-monospace,system-ui,sans-serif;--b:'Montserrat',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--pri:#6672f5;--pri-soft:#2b3170;--pri-sub:#1a1f47;--on-pri:#0b1020;--acc:#feb83e;--page:#070b14;--bg:#0b1220;--surf:#111827;--surf2:#18202f;--ink:#f1f5f9;--mute:#a5b2c6;--line:#263044;--line2:#64748b;
--bad:#f87171;--bad-t:#fca5a5;--bad-bg:#3b1618;--ok:#4ade80;--ok-t:#86efac;--ok-bg:#123222;--warn:#fbbf24;--warn-t:#fcd34d;--warn-bg:#3a2a0c;--info:#22d3ee;--bezel:#2a3144;--map-bg:#0f1626;--map-st:#223049;--map-green:#12281f;--map-water:#11283a;--map-lbl:#a5b2c6;--plate:#f8fafc;--plate-ink:#0f172a;--wa:#22a55b}}
```
Base: `body{font-family:var(--b);font-size:16px;line-height:1.45}` (L18).

### Token mapping and conflicts with `tokens.css`

| Comp | Value | Closest existing token | Conflict |
|---|---|---|---|
| `--pri`, `--pri-soft`, `--pri-sub`, `--on-pri`, `--acc` | #3226b4 / #dcd9fb / #efeefc / #fff / #fd9e15 | `--qv-color-primary*`, `on-primary`, `accent` | None, identical (light). Dark: `--pri-soft` comp #2b3170 vs repo #3226b4 and `--pri-sub` #1a1f47 vs #191943 differ slightly. |
| `--bg` #f1f5f9 | page background | `--qv-surface-sunken` #f1f5f9 | Same |
| `--surf` / `--surf2` | #fff / #f8fafc | `--qv-surface-card` / `--qv-surface-soft` | Same |
| `--ink` #0f172a | text | `--qv-text-primary` | Same |
| **`--mute` #475569** | secondary text | `--qv-text-secondary` #64748b | **Conflict.** The comp darkens secondary text for sun contrast. `--qv-text-secondary` is used everywhere. |
| **`--line` #e2e8f0** | thin border | `--qv-border-subtle` #e2e8f0 | Same |
| **`--line2` #94a3b8** | thick border | `--qv-border-strong` #cbd5e1; `--qv-text-muted` #94a3b8 | **Conflict.** Production uses `border: 2px solid var(--qv-text-secondary)` (#64748b, darker than the comp) in Hoy/Alertas. |
| `--bad` #dc2626, `--ok` #16a34a, `--warn` #d97706, `--info` #0891b2 | semantic fills | `--qv-color-danger/success/warning/info` | Same |
| **`--bad-t` #b91c1c, `--ok-t` #15803d, `--warn-t` #92400e** | text tones | `--qv-estado-perdido-texto` #b91c1c, `--qv-estado-reportando-texto` **#166534**, `--qv-estado-en-pausa-texto` #92400e | `ok-t`: comp #15803d vs repo #166534 (repo is darker, still passes). Not a break. |
| `--bad-bg` #fee2e2, `--ok-bg` #dcfce7, `--warn-bg` #fef3c7 | tints | only `--qv-color-warning-soft` #fef3c7 | **Missing:** `bad-bg`, `ok-bg`. |
| `--wa` #15803d | WhatsApp green | none | **Missing.** |
| `--plate`, `--plate-ink` | plate colors | `.qv-plate` hardcodes #fff, #15171a, #2876bb | **Missing as tokens.** |
| `--d` / `--b` | Oxanium / Montserrat | `--qv-font-display` / `--qv-font-body`, wired to next/font in `apps/web/app/globals.css:9-10` | Same fonts. But the repo uses `--qv-font-mono` (ui-monospace) for the plate. The comp uses Oxanium for the plate and numbers. |
| `--map-*` | illustrated map | n/a | Illustration only. Do not port (real Google map). |
| `--bezel`, `.phone`, `.sb` | phone frame, status bar | n/a | Illustration only. Do not port. |

Also: `--qv-radius-lg` = 1rem = 18 px at the mobile base, while the comp's cards are 18 px (card), 16 (tile/search), 14 (btn/stat/chip), 26 top (sheet). `--qv-alerta-*` (#a16207, #c2410c, #b91c1c) are NOT the comp's severity colors (comp: gravísima solid `--bad` with white text, grave `--bad-bg` + `--bad` border, leve `--warn-bg` + `--warn` border). Production alert cards use the repo `--qv-alerta-leve` brown #a16207 for the card border (visible in `prod_alertas.png`), so that is a visible mismatch too.

### Can a scoped mobile token block be added without changing desktop? Yes.

Add a `@media (max-width: 720px) { :root { ... } }` block with comp-named aliases that reuse the existing tokens where equal, and overrides only where the comp differs. Suggested, sitting in the same media block as the font scale (L5381):

```css
@media (max-width: 720px) {
  :root {
    --qv-text-secondary: #475569;          /* comp --mute; dark: #a5b2c6 (add to a dark block too) */
    --qv-m-line-thick: #94a3b8;            /* comp --line2 (dark #64748b) */
    --qv-m-bad-bg: #fee2e2; --qv-m-ok-bg: #dcfce7;   /* dark: #3b1618 / #123222 */
    --qv-m-wa: #15803d;                    /* dark #22a55b */
    --qv-m-plate: #fff; --qv-m-plate-ink: #0f172a;   /* dark plate #f8fafc */
  }
}
```
Risks and notes:
- Overriding `--qv-text-secondary` inside the media block also darkens the secondary text in the drawer and in desktop-reused components rendered on phones. This is desirable, but check En vivo, Vehículos, etc. on phone. If you want zero blast radius, use new `--qv-m-*` names and consume them only in the new mobile rules.
- Dark mode must be added in a `@media (max-width:720px) and (prefers-color-scheme:dark)` block (tokens.css L113 pattern). Order matters: it must come after the light block.
- Avoid unscoped `:root` edits to `tokens.css` since those hit desktop.

## 2. Font and size scale (affects every screen)

- Production: `html{font-size:112.5%}` at <=720 (L5382), so 1rem = 18 px. Inputs forced to >=16 px.
- Comp: body 16 px minimum, data 18-24 px, plate 30 px, countdown 42-44 px (the CSS says 42, the intro text says 44), 13.5 px only for tab labels and secondary notes.
- Decision for the implementer: either keep the 18 px root and write comp values as `calc(Npx/18*1rem)`, or write px values directly in mobile rules (the repo already does px in `.qv-tabbar`, L5448-5500 and L5600+). Recommendation: px inside the mobile media block, as the tab bar already does, to match the comp 1:1.
- Fonts: Oxanium is loaded (`apps/web/app/layout.tsx:5-9`, `--font-oxanium`) as 400-700 by default. Check: the comp uses weights 500-800 and next/font `Oxanium()` without `weight` loads the full variable range. Not confirmed in the build output.

## 3. Screen by screen

### 3.1 Shell and tab bar

Where: `AdminLayout` and `MobileTabBar` in `packages/design-system/src/ui/layout.tsx` (tab bar L47-79, layout L84-198); CSS `.qv-tabbar*` L5422-5504; the shell wiring in `apps/web/app/(dashboard)/layout.tsx:153-170`.

| Item | Comp | Production | Gap |
|---|---|---|---|
| Header | `.hd`: `flex:none; background:var(--surf); padding:6px 16px 12px; border-bottom:1px solid var(--line); min-height:62px; display:flex; justify-content:space-between; gap:10px`. `h2` 22px/800/lh 1.15; `small` 14px/600 `--mute` | `.qv-admin-layout__topbar` (L5038): sticky, glass `--qv-surface-glass` + `backdrop-filter:blur(24px)`, min-height 3.5rem, title 1.0625rem/700 Oxanium; plus a second `PageHeader` per page | Replace the glass topbar + PageHeader with one solid header: h2 22/800 + subtitle 14/600 + right slot (live pill, line selector). |
| Subtitle copy | Hoy: "Mié 5 nov · Unión Tiquipaya"; Alertas: "Hoy · 4 abiertas"; Salidas h2 = "Terminal Tiquipaya", small = "Línea 16 · 6 en fila"; Más: h2 only | "Resumen del día y consultas rápidas", "Hoy · 3 alertas abiertas", "Fila de salida y frecuencias de la terminal." | New copy. Date and union name: date is client-side; union name needs `user`'s sindicato (not confirmed present in `useAuth`; check `auth-context`). Salidas terminal name exists (`terminales.opciones[].etiqueta`); "N en fila" = `data.items.length`. |
| "En vivo" pill (Hoy header right) | `.live`: inline-flex, gap 8, 14/700, `padding:6px 12px`, radius 99, bg `--ok-bg`, color `--ok-t`, dot 11px `--ok` pulsing 2 s (`@keyframes pulse{50%{opacity:.35}}`, disabled under reduced motion) | None on Hoy | New element. Data: freshness of `posiciones` exists (`posiciones.dataUpdatedAt`/`isError`); `useSaludRefresco` already gives ok/lento/sin_conexion (`barra-mando.tsx:17-34`). Frontend only. |
| Tab bar | `.tabs`: `height:76px; background:--surf; border-top:1px solid --line; grid 5 cols; padding:6px 4px 12px` | `.qv-tabbar` (L5448): flex, `height:var(--qv-tabbar-h)=calc(64px+safe-area)`, `padding:4px ... env(safe-area-inset-bottom)`, same border | Comp is 76 px tall; production 64 px + safe area. Low-impact gap. |
| Tab | `.tab`: column, gap 2, 13.5px/600 `--mute`, min-height 56; pill 56x32 radius 16; active color `--pri` weight 800, pill bg `--pri-soft` | `.qv-tabbar__tab` (L5460-5500): same values | Already matches. |
| Tab icons | Lucide-style: house, radio, list-ordered, bell, ellipsis; stroke 2, 24 px | Same Lucide icons via `getNavIcon(..., 24)` strokeWidth 1.9 (`layout.tsx:43,159`); "Más" is inline SVG stroke 2 | Match, except stroke 1.9 vs 2. Trivial. |
| Alertas badge | `.bdg`: absolute `top:0; left:50%; margin-left:8px; background:--bad; color:#fff; font:800 12px Oxanium; min-width:20; height:20; radius:10; padding:0 5px; border:2px solid --surf`. Shows "4" | None | New. Data: open alert count already exists via `useInfraccionesHoy` (`hoy-movil.tsx:97`, `abiertas.length`); the shell does not call it today. Needs a hook call in `DashboardShell` (polling cost: another consumer of the same query key, so shared cache). Add `badge?: number` to `MobileTab` and render in `MobileTabBar`. Needs visually-hidden text ("N alertas abiertas") for a11y. Hide for roles without `/alertas` (operador). |
| Focus ring | `:focus-visible{outline:3px solid var(--acc);outline-offset:2px}` (orange) | `.qv-tabbar__tab:focus-visible` uses `--qv-shadow-focus` (primary 40%); other controls 2px primary | Comp wants orange 3 px. Minor; scope to mobile if adopted. |
| Content padding | `.body{padding:14px 16px 0; background:--bg}` | `.qv-admin-layout__content{padding:0 var(--qv-space-sm) ...}` (L5033), 0.75rem = 13.5 px | 16 px side padding in comp. |

Limit to <=720: all of this lives in the <=720 block already; the new header must also be mobile-only (do not remove `PageHeader` on desktop; render an alternate header or hide the topbar title via CSS, or fork like `HoyMovil`).

### 3.2 Hoy (`apps/web/app/(dashboard)/hoy-movil.tsx`, CSS `.qv-hoy*` L5753-5963)

Comp order: header -> search -> (results) -> "Resumen del día" label -> 2x2 tiles. Note: the CTO's decision says the summary goes ABOVE the search ("antes del buscador"), but the comp image of B puts the search first and the summary below; the summary-first order comes from A. Production currently has KPIs first, then search. Follow the CTO decision (KPIs first) and say so explicitly in the PR, since the B comp contradicts it.

| Element | Comp (px/values) | Production | Gap |
|---|---|---|---|
| Search field | `.search`: `height:60px; radius:16; background:--surf; border:2.5px solid var(--pri); gap:12; padding:0 16px; font:17px/600; color:--mute`; icon `--pri` 24 px. Placeholder: "Buscar placa o conductor" | `.qv-hoy__buscar-campo` (L5842): min-height 3.25rem (58 px), border 2px `--qv-text-secondary` (gray), radius 14px; separate label "Buscar placa o conductor" above (bold); placeholder "Placa o nombre..." | Border purple 2.5 px, height 60, radius 16, 17/600, placeholder = comp copy, drop the separate label (keep an `aria-label` or visually-hidden label). |
| Result count row | `.lbl`: 15/800 `--mute`, uppercase, letter-spacing .05em, margin `16px 2px 8px`, flex space-between: "1 RESULTADO" left, query in quotes right ("4701") | `.qv-hoy__resumen` 0.875rem/700, role=status, no query echo | Style + quote echo. Data exists (`consulta`). |
| Result card | `.card`: `background:--surf; border:1.5px solid --line; radius:18; padding:14`. Row 1: `.plate.lg` left, tag "Línea 16" right (`.tag`: bg `--surf2`, border 1.5 `--line2`, radius 8, padding 1px 8px, 13/700 `--mute`). Name 18/700, margin 10/2. Status line: `.st.ok` 16/700 with dot: "Reportando · **23** km/h · vuelta 2". Meta row 15/500 `--mute` with pin icon: "Av. Tiquipaya · hace 4 s". Buttons row: Llamar (`.btn.pri`) + WhatsApp (`.btn.wa`), height 52, radius 14, 16/700 | `.qv-hoy__resultado` (L5882): 2px gray border radius 14; plate = `PlateBadge` (blue BOL badge); name 1.0625rem; detail 0.875rem; phone; actions: both buttons use `.qv-live-btn` with 2px gray border, neutral (no purple, no green) | Everything. See below for data. |
| Status line (state + speed + vuelta) | as above | Not shown at all | **Data:** state (`estadoFrescura`), speed (`PosicionEnVivo.speed`, via `velocidadKmh` already used in `panel-vehiculo.tsx:232`), `vuelta.numero` and last-fix age (`ultimoFixTs`) exist in `PosicionEnVivo` (`usePosicionesEnVivo` is already called in HoyMovil). Only join needed: match search result `vehiculoId` to `posiciones.data`. No new API field. Street name ("Av. Tiquipaya") is NOT in `PosicionEnVivo` (not confirmed; I saw no field). Needs reverse geocoding or a new API field. Recommend dropping it or showing only "hace N s". |
| Line tag "Línea 16" | tag | none | `lineaNombre` exists in `PosicionEnVivo`; vehicles without a session today have none. |
| Llamar / WhatsApp | Llamar: purple filled `--pri`, phone icon 24. WhatsApp: `--wa` filled, white text, message icon. height 52, `flex:1`, gap 10 | Gray outlined (`.qv-hoy__resultado-acciones .qv-live-btn`, L5932-5936), 3rem tall, 0.9375rem | Restyle; data already exists. Use `.qv-live-btn--primario` or a new modifier plus a WhatsApp variant. |
| KPI section label | "RESUMEN DEL DIA" `.lbl` | none | New text; cheap. |
| KPI tiles | `.sum` grid 2 cols, gap 10. `.tile`: `bg --surf; border 1.5px solid --line; radius 16; padding 12px 14px; min-height 88px; column; space-between`. Number `.n`: `800 38px/1 Oxanium`. Label `.l`: 15/700 `--mute`, flex space-between. **Number first, label below.** Colors: En servicio number `--ok-t`; Inactivos default ink; Alertas tile `.al`: `bg --bad-bg; border --bad`, number and label `--bad-t`, with badge `<b>` "2 graves" (`--bad` bg, white, radius 8, padding 1px 8px, 13px); Sanciones number `--warn-t` | `.qv-hoy__kpi` (L5764): min-height 6.5rem, 2px gray border, radius 14, label row with icon first and bold 0.875rem label, THEN number 2rem/800 (not Oxanium-forced), then helper text. Alertas/Sanciones tiles are lavender links with chevron | Order (number above label), no icons in comp, Oxanium 38/800, tile 88 px high, semantic number colors, red Alertas tile, severity count chip. |
| "2 graves" chip | present only on the alert tile | text "0 graves" as helper | Data exists (`graves` computed at `hoy-movil.tsx:107`). Frontend only. Hide chip when 0 (comp shows it only with graves; treat the 0 case as not specified, so mark as decision). |
| Tile copy | "En servicio", "Inactivos", "Alertas abiertas", "Sanciones pend." | "En servicio" + "de 2 en flota", "Inactivos", "Alertas abiertas", "Sanciones pendientes" | Remove "de N en flota" helper and shorten Sanciones label. |
| Tile as links | comp tiles are not drawn as links | Alertas -> /alertas, Sanciones -> /reglas | Keep the links (behavior); keep chevron only if wanted. |
| Error banner / retry | not in comp | `.qv-hoy__error-kpis` | Keep. |

Limit: HoyMovil only renders at <=720 (`useEsMovil`, `page.tsx:62`) and `.qv-hoy*` only used by it. Desktop-safe. KPI classes are free to change.

### 3.3 En vivo map screen

Where: `apps/web/app/(dashboard)/en-vivo/page.tsx` (engine `google`, L618), `barra-mando.tsx`, map CSS L2400-2900 (`.qv-gmap-*`), `.qv-live-*` L3000-4600.

| Element | Comp | Production | Gap |
|---|---|---|---|
| Top bar | Two floating `.fab` buttons over the map at `top:12px; left/right:12px; gap:8`: `height:48; background --surf; border:2px solid --line2; radius 14; padding 0 14; 16/800` -> "route icon + Línea 16 + chevron-down" (left) and `.fab.h` "dot + 12 de 15 · hace 3 s" (14/700 `--ok-t`) | Full-width white `qv-live-barra` header with two rows (L5288+): segment control "Todas / 120 / L..." (clipped), history button, "Flota" button, health pill icon only, second row "Sin infracciones abiertas" + "Siguiente alerta" | Replace with two floating chips. Heavy structural change. |
| Line selector | single "Línea 16 v" chip | segment (<=4 lines) or `Select` (`barra-mando.tsx:107-141`) | Data exists (`lineas`, `lineaFilter`). Frontend only: collapse to a chip + sheet/menu. With >1 line, needs a picker UI. |
| "12 de 15 · hace 3 s" | online count / total + age | `conteoPorEstado` + `resumenFlota` (`atencion.ts:37,114`) give `enServicio`/`total`; `useSaludRefresco` gives seconds | Frontend only. Note the comp's "12 de 15" ambiguity: "de 15" = total fleet; "12" = `enServicio` (everything except finalizado/inactivo). Confirm semantic with CTO. |
| Alert counters per severity, "Siguiente alerta", Días anteriores, Flota sheet | not in the comp's En vivo screen | present in the bar | Comp drops them from the map screen. Features would need a new home (Alertas tab already covers alerts; Flota panel and "Días anteriores" need an entry point: e.g. in the "Más" list). Product decision; flag it. Dropping silently loses `puedeVerDias` and Flota. |
| Map controls | none shown | "Seguir / expand / refresh" card bottom-right (`.qv-live-controles`, L3813) | Comp omits. "Seguir" is also in the vehicle sheet today. Decision needed. |
| Markers | plate pill colored by state (details in section 6) | 44 px photo/neutral disc + line-colored ring + 18 px state glyph + dark plate chip below | Rework marker. |
| Route line | purple `--pri` 7 px, 14 px white casing | per line color, dashed | Out of scope unless desired. Not confirmed how the route is drawn on Google (`route-map-google.tsx`, not read in full). |

### 3.4 En vivo vehicle sheet

Where: `panel-vehiculo.tsx:327-480` (+ `panel-vuelta.tsx`), CSS `.qv-live-panel*` L4091+ and mobile sheet L4603-4720.

| Element | Comp | Production | Gap |
|---|---|---|---|
| Sheet | `.sheet`: bottom, `background --surf; border-radius 26px 26px 0 0; padding 10px 16px 14px; box-shadow 0 -10px 28px rgba(15,23,42,.22)` | `.qv-live-panel` (L4091, mobile L4612): `border-radius var(--qv-radius-xl)=1.25rem 1.25rem 0 0` (22.5 px), glass -> opaque card, `max-height min(72dvh,34rem)`, 1 px glass border + `--qv-shadow-floating` | Radius 26, shadow value. The comp is a fixed-height summary, not a scroller; production's expanded sheet also holds infractions, incidencias, PCs (comp drops all of that). Product decision: keep expandable detail under the comp's summary. |
| Grab handle | `.grab`: 44x5, radius 3, `--line2`, margin `0 auto 12px` | `.qv-live-panel__asa-barra` 2.5rem x 4 px, in a 44 px sticky button | Dimension tweak. Handle button keeps a11y. |
| Header row | `.sh-top`: plate `.plate.lg` left; right a 48x48 `.btn.ghost.sq` with X (radius 12) | Avatar (48 px circle, photo or bus icon), plate `<h2>` as plain text 1.0625rem/800, line chip, close X 2.75rem borderless (`.qv-live-panel__cerrar`) | Replace avatar+text with the big plate; close button a bordered 48 px square. Avatar/photo dropped by the comp (decision: photo is a real feature on the map). |
| Driver name | 18/700, margin `8px 0 2px` | 0.75rem secondary with a user icon (`.qv-live-panel__meta`) | Size/weight. Data exists (`conductor`). |
| Status line | `.st.ok`: dot + "Reportando · **31** km/h" 16/700 colored | `FrescuraPanel` (0.75rem/700) + `kmh` (secondary) | Larger type; use shape+color glyph (circle/diamond/square). Data exists (`panel-vehiculo.tsx:232`). |
| Stat tiles | `.stats` 2 cols gap 10, margin `12px 0`. `.stat`: `bg --surf2; border 1.5px solid --line; radius 14; padding 8px 12px`; `small` 13/700 uppercase `.04em` `--mute`; `b` `800 20px Oxanium`. "HOY / Vuelta 2" and "ALERTAS / 1 abierta" (red variant `.stat.al`: `--bad-bg`, border `--bad`, text `--bad-t`) | A plain text summary only in folded state (`.qv-live-panel__resumen`: "N abiertas · Vuelta 2 · Directo"), and `.qv-live-panel__stats` (L4394) is PC stats | "Vuelta 2": `posicion.vuelta.numero` exists (`panel-vehiculo.tsx:428`). Alerts count: `abiertas.length` exists. Frontend only. |
| Designación segmented | label "Designación" 15/700; `.seg` 2 cols: `bg --pri-sub; border 2px solid --pri-soft; radius 14; padding 3; margin 6px 0 12px`, options 46 px high radius 11, active `--pri` fill white 800 with check icon: "Directo" / "Vía Molinos" | `SeccionVuelta` (`panel-vuelta.tsx`), `.qv-vuelta__segmentos` (CSS not read in detail, not confirmed) with options from `variantes` (label = variant name, "Directo" always first) | Restyle only; data and mutation exist. Comp shows it directly under the stats, production buries it below action buttons. |
| Primary actions | `.btns`: "Llamar" (`.btn.pri`, phone icon) + "Ver recorrido" (outlined `.btn`), height 52, radius 14, 16/700 | `.qv-live-panel__acciones`: Seguir, Ver recorrido, WhatsApp, Llamar, Copiar as small 2.75rem outlined `qv-live-btn` | Reduce to Llamar (purple, primary) + Ver recorrido; WhatsApp/Copiar/Seguir to an overflow or the expanded part. Data exists. |
| Closing | X | X | OK once styled. |

Limit to <=720: sheet mobile rules already scoped at L4603; do not touch desktop `.qv-live-cajon` (L3720).

### 3.5 Alertas (`apps/web/app/(dashboard)/alertas/page.tsx`, CSS L5640-5750)

| Element | Comp | Production | Gap |
|---|---|---|---|
| Header right | "Línea 16 v" selector (`.fab` height 44, 15px) | none | Line filter does not exist on Alertas today. `InfraccionHoy` has `lineaNombre`; a `lineaId` is not confirmed in the type. Client-side filter feasible if `lineaId`/`lineaNombre` is present; otherwise API field. |
| Top filter | **3 severity chips** `.chips` gap 8: `.chip` flex 1, radius 14, padding `8px 6px`, min-height 56, 14/800, count `800 24px Oxanium` above label. Gravísima: solid `--bad`, white text. Grave: `--bad-bg`, 2px `--bad` border, `--bad-t` text. Leve: `--warn-bg`, 2px `--warn` border, `--warn-t` | 3 status chips: "Abiertas 3 / Atendidas 0 / Todas 3" (pill, `.qv-alertas__chip`, L5648), purple when active | Different semantics: the comp's chips are severity counts (not filters in the image; they may or may not filter, not specified). The status filter (Abiertas/Atendidas/Todas) has no place in the comp. Decision needed: keep it (e.g. as segmented control below or in the header subtitle) to not lose "Atendidas". Counts per severity are computable from `todas` (`gravedad` already grouped at `page.tsx:70`). Frontend only. |
| Sanciones link | `.link`: min-height 56, margin `10px 0`, padding 0 14, radius 14, `bg --pri-sub; border 2px solid --pri-soft`, 800 `--pri`; copy "Sanciones pendientes (5)" with ban icon and chevron | `.qv-alertas__link` (L5667): same look, min-height 3.25rem, copy "Sanciones pendientes" without count | Count: sanciones pendientes query exists in HoyMovil (`sancionesApi.listar({estado:'pendiente'})`), not in Alertas. Add the same query. Frontend only. |
| Group heading | none (flat list, sorted by severity) | `<h2>` "Leves 3" per group | Comp is flat. Remove group headings or keep them hidden visually. |
| Card | `.card.al-c`: `padding 12; margin-bottom 10; bg --surf; border 1.5px solid --line; radius 18`. Neutral border on all severities | `.qv-alertas__card`: 2px border + **6 px left border in severity color** (L5710-5716), radius `--qv-radius-lg` | Remove colored left border; use neutral 1.5 px `--line`. (The severity is conveyed by the `.sev` badge.) |
| Severity badge | `.sev`: inline-flex gap 6, 14/800, radius 8, padding `3px 9px`; gravísima solid `--bad` + white + octagon icon; grave `--bad-bg`/`--bad-t` + triangle icon; leve `--warn-bg`/`--warn-t` + info icon | `.qv-live-inf__icono` + `.qv-live-inf__chip` (0.75rem uppercase text on a tan pill) + "Abierta · 18:29" | Restyle; the severity icons per level already exist (`IconoNivel`, `route-map-vehiculo.ts:70-77` `ICONO_NIVEL`: circle-alert, triangle-alert, octagon-alert, matching the comp). |
| Time | right side: "07:31 · hace 11 min" `.meta.num` 15/500 | "Abierta · 18:29" left | Format change: needs "hace N min" (client calc from `inicioTs`); status text "Abierta/Atendida" must stay somewhere because the comp has no closed state. |
| Plate | small `.plate` (18px Oxanium, 2px border) | `PlateBadge` 2.75rem tall with BOL badge | Plate restyle (section 5). |
| Title | `h3` 17/800 lh 1.25 `margin 6px 0 2px` | `.qv-alertas__titulo` 1.0625rem/800 | Matches. |
| Detail line | `.meta`: "Av. Tiquipaya y calle Jordán · Bravo Soliz J." (15px) | `detalleInfraccion(inf)` + duration + conductor + lineaNombre (1rem, primary color) | Comp's street/address is NOT in the data: `detalleInfraccion` returns the textual detail ("PC omitido"...) and no street name. Mark: not confirmed, treat as unavailable. Conductor name short form "Bravo Soliz J." is a formatting choice. |
| Actions | `.btns .btn` height 48 / 15px / padding 0 6 : **Atender / Descartar / Sancionar**, Sancionar purple, the 3 in one row | 2x2 grid (flex 1 1 calc(50%)), includes "Ver en mapa" with 2-line wrap ("Ver en / mapa" in screenshot) | Single row of 3; "Ver en mapa" is absent from the comp; keep it (decision) as an icon button or move to the card tap. In the comp the Leve card has Sancionar unhighlighted (not purple): `puedeSancionar` logic exists. Note the comp says "actions primary always purple (Sancionar included)" in the plan, but the leve card's Sancionar is plain. Ambiguous; follow the plan. |

Limit: `/alertas` is one page for both viewports. Either fork like Hoy (`useEsMovil`) or write every new rule inside `@media (max-width:720px)`. The base `.qv-alertas__card` (L5710) already applies to desktop, so changing it directly changes desktop. Put the new rules in the media block and use a distinct class.

### 3.6 Salidas (`apps/web/app/(dashboard)/salidas/page.tsx`, `base-rapida.tsx`, `fila-en-vivo.tsx`; CSS L5547-5640)

| Element | Comp | Production | Gap |
|---|---|---|---|
| Header | h2 "Terminal Tiquipaya" + small "Línea 16 · 6 en fila" | "Salidas" + "Fila de salida y frecuencias de la terminal." | `terminales.opciones[].etiqueta` (the terminal name) exists. "Línea 16" needs line name via terminal option (not confirmed to expose it; `etiqueta` may already include it). |
| Frecuencia base card | `.card.freq` (padding `12px 14px`): title "Frecuencia base" 15/800; row: `[-]` `.btn.sq` 52x52, value `8 min` (`800 30px Oxanium`, "min" 16/700), `[+]`, "Guardar" `.btn.pri` width 112 **on the same row**; help line with info icon "Aplica todos los días" 14/600 | Title 800; stepper buttons small tinted squares; **"Guardar" on its own full-width row** (`.qv-base-rapida__guardar{flex:1 0 100%}`, L5611); help copy "Rige cuando ninguna regla del día aplica, todos los días." | Layout (Guardar inline), copy shortened. Everything exists (`BaseRapida`). The visible Guardar is a faded purple (disabled) in the screenshot: the comp shows it solid; disabled state is behavior. |
| "La fila" label + "Sigue 2:40" | `.lbl`: "LA FILA" left, "SIGUE 2:40" right (uppercase 15/800) | Card header "Fila en vivo (clock icon) + tag '0 en fila'" | "Sigue" = time until the first departure: derive from `items[0].etaTs` with the existing `CuentaFila` logic. Frontend only. |
| First row card | `.q.f`: `border 2.5px solid --pri`. Row: position box `.pos.f` 36x36 radius 10 purple filled with `800 20px Oxanium` white number; `.who`: plate + driver; `.kb` 48x48 radius 12 "⋮" button (`border 1.5 --line; bg --surf2`). Below: `.cd` "Sale en" small 14/700 + `42px Oxanium 800` purple, text-align left; then **Despachar** `.btn.pri.big`: full width, height 60, 18/800, uppercase, letter-spacing .06em, bus icon | `DataTable` with `.qv-table--stack` (generic stacked table), td labels, countdown `1.5rem` (L5559); actions grid: Despachar full-width, "Al final" and "Retirar" below (L5563-5580) | Rebuild as a purpose-built list (not DataTable): needs new markup. Data exists: `FilaSalidaPanelItem` (`posicion`, `placa`, `etaTs`, `habilitado`, `anticipada`), driver name: NOT in the item and not in `internoPorVehiculo` (that map is only `numeroInterno`). The comp shows driver name per row ("Bravo Soliz Javier"): **needs data**. Not confirmed whether `FilaSalidaPanelItem` carries conductor; I saw no such field being used. Likely requires a new API field or a join with the day's jornadas (`useJornadasHoy` exists in `use-en-vivo`). |
| Other rows | `.q`: `padding 10px 14px; margin-bottom 8`, border 1.5 `--line`, radius 18; position box tinted (`--pri-sub`, text `--pri`); right side "sale en / 10:40" (`.cd` 24px, small 13px) + "⋮" | same stacked table | Same rebuild. |
| Overflow menu | `.menu`: absolute `right:12; top:60`, width 176, `bg --surf; border 2px solid --line2; radius 14; box-shadow 0 12px 24px -6px rgba(15,23,42,.35); padding 4`. Items 48 px high, 700, radius 10: "Al final" (down arrow), "Retirar" (red `--bad-t`, X) | Buttons inline | New component (popover menu). Needs full keyboard/focus/Escape/outside-click a11y. Both actions open `ConfirmDialog` today (keep). Menu on row 1 and others. |
| "Salidas recientes" | `.coll`: min-height 56, `border 1.5px dashed --line2`, radius 14, 700 `--mute`, count "8" + chevron-down (collapsed by default) | Always expanded `Recientes` table | Collapsible; count = `salidasRecientes.length`. Frontend only. |
| Footnote | not shown | "Frecuencia base: 7 min. Última actualización..." text | Keep or hide; comp omits. |
| Empty state | n/a | "No hay trufis en la fila..." in a rounded box | Keep. |

Limit: `esMovil` branch already exists in `page.tsx:81` for `BaseRapida`. Fork `FilaEnVivo` similarly (`FilaMovil`) rather than overriding the stacked table with CSS. Desktop table stays untouched.

### 3.7 Más (drawer today -> full page)

Comp: page with header "Más"; user card (`.user`: padding 14, avatar `.av` 54x54 radius 16 `--pri` bg, initials `800 22px Oxanium`, name 18/800, `.meta` "Administrador · Unión Tiquipaya"); `.list`: `margin-top:12; bg --surf; border 1.5px solid --line; radius 18; overflow hidden`, rows `.li`: min-height 52, padding 0 14, gap 14, 700; icon `.ico` 34x34 radius 10 `--pri-sub`/`--pri`; chevron right; `.li+.li` 1px `--line` divider; "Solo lectura" tag (`.tag`) on Rutas; "Cerrar sesión" `.btn.out`: margin-top 12, color `--bad-t`, border `--bad`, centered (outlined red, 52 high, radius 14).

Comp items and order: Vehículos, Conductores, Socios, Líneas, Rutas (tag "Solo lectura"), Rotaciones, Reglas y sanciones, Reportes, Auditoría. Missing from comp but in `NAV_ITEMS`: Sindicatos (admin_quivo only), Errores de sync, Usuarios (admin_quivo only), Dashboard (replaced by Hoy). "Solo lectura" on Rutas: is `/rutas` read-only on mobile? Not confirmed (I did not open the page). It is a copy claim that must match behavior.

Production today (`pwa_mas.png`, `layout.tsx`, `layout.tsx` in design-system L84-198): "Más" button opens the sidebar as a left drawer (`width:min(20rem,86vw)`), showing the full desktop sidebar: BrandLogo, sectioned nav (Operación, Gestión, Planificación, Control y Auditoría, Configuración), "LIVE" badge on En vivo, user card (email + role), dev-role switch (only in `isDevBypass`), "Cerrar sesión" in pale red (`.qv-sidebar__logout`, L1587: filled red 6% tint, 1 px border). It also includes Dashboard/En vivo/Salidas/Alertas, which duplicate the tabs.

Can "Más" become a full page route? Yes, with caveats:
- Add `apps/web/app/(dashboard)/mas/page.tsx`, make the 5th tab a link (`/mas`, active when pathname starts with `/mas`) instead of a button with `aria-expanded/aria-controls` (`MobileTabBar`, layout.tsx L47-79). The drawer's `moreRef`/focus-return logic (L110-117) would stay only for... nothing, since `AdminLayout` only opens the drawer from "Más" when `mobileTabs` is set (the hamburger is hidden then, L162). So if Más becomes a page, the drawer is no longer reachable on mobile: either delete the drawer path for mobile or keep a hamburger. Recommend: keep `AdminLayout`'s drawer code for the non-tab case (it is used when `mobileTabs` is undefined, but `DashboardShell` always passes tabs, so it's effectively dead code afterwards). Decide: remove or leave.
- Role gating already lives in `nav-items.ts`: `filterNavItemsByRole(NAV_ITEMS, user.rol)`. The page can reuse it and exclude the 4 tab ids (`hoy`/dashboard, `en-vivo`, `salidas`, `alertas`).
- `RequireAuth` guard: `isRouteAllowedForRole`/`findNavItemForPath` returns "allowed" for routes with no nav item (`/mas` has none), so every authenticated role can open it. Fine, but `/mas` must not be treated as the `operador` landing page. `rutaInicialParaRol` uses the first allowed item, unaffected.
- `bare` (En vivo) layout still needs the tab bar; unaffected.
- Deep links: `isNavActive` for Más tab should also be active for child routes opened from Más (Vehículos, etc.), otherwise no tab is highlighted when on `/vehiculos`. In the comp the tab shows active only on Más. Decide: highlight Más when pathname is not one of the 4 tabs.

What the drawer does today that must be kept (all in `layout.tsx` of design-system L84-198 and `(dashboard)/layout.tsx`):
- Focus: on open, moves focus to the first `button, a[href]` (drawer close X) (L116); on close returns focus to the "Más" button via `toggleRef` (L109-112).
- Escape closes (L121-123); `inert` on `<main>` while open (L107); body scroll lock (L118-119); backdrop click closes; link click inside closes (L141-143); closes automatically when leaving mobile (`MOBILE_QUERY` listener, L126-130); closes on route change (`routeKey`, L99-101).
- Role filtering: `filterNavItemsByRole(NAV_ITEMS, user?.rol ?? '')` and tab filtering with `MOBILE_TAB_ITEMS` (per-tab `roles`).
- Logout: `handleLogout` = `logout()` then `router.push('/login')`.
- `En vivo` item opens `_blank` on desktop; on standalone/mobile it navigates in the same window (`layout.tsx:112-118`). Not relevant for a page list (list items just link).
- Dev-bypass role simulator (`isDevBypass`, `SegmentedControl`) lives in the footer. Keep on the page for dev only.

With a full page the drawer's focus/Escape/inert machinery is no longer needed for Más (it is a normal page); the page needs proper heading focus handling and `aria-current` on the tab.

Items per role (from `nav-items.ts`):
- `admin_quivo`: Dashboard/Hoy, En vivo, Salidas, Alertas, Sindicatos, Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas y sanciones, Reportes, Auditoría, Errores de sync, Usuarios. Más would list: Sindicatos, Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas y sanciones, Reportes, Auditoría, Errores de sync, Usuarios (12).
- `admin_sindicato`: same minus Sindicatos and Usuarios (10 in Más: Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas, Reportes, Auditoría, Errores de sync).
- `operador`: only En vivo and Salidas (both are tabs). Más would be empty except the user card and Cerrar sesión; Hoy and Alertas tabs are hidden for the role (tab `roles`). With 2 tabs + Más the bar has 3 items.
- The comp omits Sindicatos, Errores de sync, Usuarios: decide whether they appear (they are real routes; dropping them from mobile removes access). Recommend adding them.
- Role text in comp: "Administrador · Unión Tiquipaya". Production derives only "Admin Central"/"Admin Sindicato" in the sidebar footer (`layout.tsx:211`); `ROLE_LABEL` in design-system has "Administrador QUIVO", etc. Union name: not confirmed on the `user` object. Initials: comp "LQ" (two letters from the name); production uses first letter of the email (`userInitial`). Name is not confirmed in `user` (only `email` seen).

## 4. `PlateBadge`: current versus comp

Component: `packages/design-system/src/ui/primitives.tsx:163-170` renders `<span.qv-plate><span.qv-plate__country>BOL</span><strong.qv-plate__value/></span>`. CSS L384-418: `height:2.75rem` (49.5 px at 18 px root), border `2px solid #2876bb` (blue), `radius var(--qv-radius-sm)`, white bg, blue "BOL" vertical band (writing-mode vertical-rl, 0.55rem), value in `--qv-font-mono` weight 700, 1rem, letter-spacing .06em, color #15171a, `--qv-shadow-xs`. Only one variant, no size prop, no state prop.

Comp plate (`propuesta-b.html` L48-49):
```css
.plate{display:inline-block;font:700 18px/1.2 var(--d);letter-spacing:.07em;background:var(--plate);color:var(--plate-ink);border:2px solid var(--plate-ink);border-radius:8px;padding:1px 9px;font-variant-numeric:tabular-nums}
.plate.lg{font-size:30px;padding:2px 12px;border-radius:10px;border-width:2.5px}
```
No BOL band, no blue, ink border (near black), Oxanium, two sizes (18 and 30). The map pill is separate (section 6).

Gap: different border color, no country band, mono vs Oxanium, size by fixed height not by font, no `lg`. Add `size?: 'md' | 'lg'` and a variant switch (`variant="sign"`) or restyle for <=720 via media query only. Safe approach: since `PlateBadge` is used on desktop in 12 places (listed below), do NOT change `.qv-plate` globally. Add a modifier class (e.g. `qv-plate--garita`) and apply it from the mobile screens, or scope: `@media (max-width:720px){.qv-plate{...}}` (changes the plate on all phone screens, including Vehículos etc., which is arguably desired for consistency; check dense tables).

Every place plates appear on phone screens (grep of `PlateBadge` use, `apps/web/app/(dashboard)/...`):
- Hoy search results: `hoy-movil.tsx:220` (vehicle results only).
- Alertas card: `alertas/page.tsx:232`.
- Salidas fila: `salidas/fila-en-vivo.tsx:152` (plus "Int. N" text), and recientes table `fila-en-vivo.tsx:251`; Grupos panel `salidas/grupos-panel.tsx:237` (admin only).
- Vehículos: list `vehiculos/page.tsx:344`, details modal `vehiculos/vehicle-details-modal.tsx:257`, form panel `vehicle-form-panel.tsx:680,1227`.
- Reglas: `reglas/page.tsx:996,1158`; Rotaciones `rotaciones/page.tsx:682`; Reportes recorridos `reportes/recorridos/page.tsx:169` and `[id]/page.tsx:133`.
- En vivo sheet: the plate is plain text in `<h2.qv-live-panel__placa>` (`panel-vehiculo.tsx:401`), not `PlateBadge`; fleet panel rows `panel-flota.tsx` (not read; not confirmed whether it uses `PlateBadge` (grep says no)) and map markers (own plate chip, section 6).
So phone screens touching plates: Hoy, Alertas, Salidas, En vivo (sheet+map), plus secondary Más destinations (Vehículos, Reglas, Rotaciones, Reportes).

Data note for the comp's plate pills: state-colored map pill needs `estadoFrescura`, which exists on `PosicionEnVivo` (not new).

## 5. Map markers: how they are built, and what it takes

Engine: En vivo uses `engine="google"` (`en-vivo/page.tsx:618`) -> `route-map-google.tsx`, Google Advanced Markers with HTML content. (A MapLibre engine, `route-map-impl.tsx`, also exists with vehicle sprite layers, but En vivo does not use it; keep both in mind if parity is required (`docs/mapa-paridad-leaflet-google.md`). Not confirmed which engine the PWA ships; `page.tsx:618` hard-codes google.)

Builders: `apps/web/app/(dashboard)/en-vivo/map-builders.ts:152-185` `construirMarcadoresVehiculos` returns `MapPoint[]` with `pinType:'vehicle'`, `label`/`placa` = plate, `estadoFrescura`, `color` (= `presentacionFrescura(...).color`), `colorLinea`, `fotoUrl`, `alerta`, `molinos`, `seleccionado`, `onClick`.

Element: `crearElementoVehiculo` (`route-map-google.tsx:~236-345`):
- Root `div.qv-gmap-veh.qv-gmap-veh--est-<estado>`, 44x44 (`.qv-gmap-veh`, L2613) with `translateY(50%)`.
- `span.qv-gmap-veh__disco`: photo or neutral disc with bus glyph (`ICONO_BUS_PATH`); `span.qv-gmap-veh__anillo`: 3 px ring in line color.
- Optional `.qv-gmap-veh__alerta` (20 px badge top-right with severity icon + count), `.qv-gmap-veh__molinos` ("M"/"M2", bottom-left), `.qv-gmap-veh__estado` (18 px state glyph bottom-right, white 1 px outline via drop-shadows).
- `span.qv-gmap-veh__placa` (L2625): plate chip below: `font 700 11px Oxanium, letter-spacing .03em; padding 0 5px 0 4px; border-left:4px solid var(--qv-gmap-veh-linea); background rgb(15 17 26/.85); color #fff; radius 3px`, plus an inset 1px translucent white line. Selected: halo `::before` (inset -8px, 2px primary border) and plate pushed down (`top: calc(100% + 15px)`).
- A11y: `role=button`, `aria-pressed`, `tabIndex=0`, `aria-label` built by `etiquetaVehiculo` (plate, state, description, alert, Molinos).

Current state-to-shape mapping (`GLIFOS_ESTADO`, `route-map-vehiculo.ts:87-102`; viewBox 28):
- `reportando`: circle with a navigation arrow (fill `--qv-color-success`).
- `detenido`: rounded square with inner square (fill `--qv-color-info`, cyan, not red/green).
- `perdido` (label "Sin señal"): triangle with "!" (fill `--qv-color-danger`).
- `en_pausa`: hexagon/diamond-like polygon with pause bars (fill `--qv-color-warning`).
- `finalizado`: outlined circle with check (stroke `--qv-estado-inactivo`).
- `inactivo`: outlined circle with moon.
- `sin_datos`: dashed outlined circle with "?" (not drawn on the map: no fix).
Fill colors come from `.qv-gmap-veh--est-*` (L2735-2747): reportando `--qv-color-success`, detenido `--qv-color-info`, perdido `--qv-color-danger`, en_pausa `--qv-color-warning`, default `--qv-estado-inactivo`.

Comp's mapping differs: three states only, shape in the pill TEXT PREFIX: reportando = green pill `#15803d`, plain text ("4701EHA"); en pausa/warn = amber `#b45309` pill with "– " prefix ("– 5163NCF"); alert/bad = red `#b91c1c` pill with "! " prefix ("! 4120MZX"); selected = purple `--pri` pill 104x36 r18, 17px, with 26 px translucent halo circle (`opacity .22`). Pills: `rect x=-38 y=-13 w=76 h=26 rx=13 fill=<state> stroke=#fff stroke-width=2.5`, text Oxanium 800 13px white, centered; wider (88) when prefixed. No photo disc, no line-colored ring, no separate glyph. (The comp's "shape repeated for state" is the glyph prefix, not a circle/diamond/square on the pill: the CTO plan's "círculo, rombo, cuadrado" appears in the status dot `.st` instead: `.st.ok .dot` circle, `.st.warn .dot` rotated 3px-radius square = diamond, `.st.bad .dot` square with radius 2.)

What it takes (frontend only, no API change):
1. New marker variant (e.g. `pinType:'vehicle'` + a flag or a mobile-only class) in `crearElementoVehiculo`: render a pill `span` with the plate, background by state class, white 2.5 px border, `border-radius:999px`, `font:800 13px Oxanium`, padding for 76x26; add the textual prefix glyph ("-" / "!") or keep the existing 18 px glyph shrunk inside the pill. Keep `aria-label`, `role`, `aria-pressed`, keyboard.
2. Map the 7 `estadoFrescura` values to the comp's 3 colors (reportando -> ok `#15803d`; en_pausa/detenido(?) -> amber; perdido -> red; inactivo/finalizado/sin_datos -> gray). The comp does not define detenido, finalizado, inactivo: **decision needed**. Existing colors use cyan for detenido.
3. Photo disc, line ring and the alert badge / Molinos "M" would be lost visually unless kept as small adjuncts to the pill. The alert badge (severity icon + count) and the Molinos badge carry operational information not in the comp: keep them attached to the pill (position top-right / bottom-left) or the comp loses information. Flag as a risk.
4. Selected state: purple pill with halo; today `.qv-gmap-veh--seleccionado::before`.
5. Anchor change: root height 44 -> 26, the `translateY(50%)` anchoring and `.qv-gmap--clickable::after` tap target (L2572, 44 px min target) need rechecking; pill is 26 px high, below the 44 px target unless the hit area is enlarged.
6. Cache/signature: `firmaPunto` (route-map-puntos.ts:47-67) includes `estadoFrescura`, so the element is recreated on state change (confirmed by the field list at L47/L67); a new class does not need a signature change if derived from the same fields.
7. Scope to <=720: either CSS-only (`@media (max-width:720px)` restyling `.qv-gmap-veh` children: hide `__disco`, `__anillo`, `__estado`; restyle `__placa` as pill with state background using `--qv-gmap-est`, and add the prefix through `::before` content: reportando none, en_pausa "- ", perdido "! ") or a new `variant` prop. The CSS-only route is smallest, because `--qv-gmap-est` already exists per state (L2735-2747). Caveat: the current plate chip is outside the 44 px root (below the disc, `top:calc(100% + 8px)`), so the pill must become the anchor element (`top:50%`/centered); also `forced-colors` rules at L2877 for `__placa` must be rechecked. Desktop keeps the disc. Aria-label already carries the state text.
8. MapLibre engine parity (`quivo-vehicle-labels`, sprites `quivo-bus-<estado>`) would not change if En vivo stays on Google (it does, `page.tsx:618`); say "not applied" in the PR.
9. Colors: the comp's pill fills (#15803d, #b45309, #b91c1c) are the darkened tones, = `--qv-estado-reportando-texto` (#166534, different), `--qv-molinos` (#b45309, same), `--qv-estado-perdido-texto` (#b91c1c, same). For 4.5:1 with white at 13 px bold, use these text-tone tokens and not `--qv-color-success`.

## 6. Cross-cutting scoping and risk notes

- Every comp rule must be gated at <=720 px; Hoy is already forked by `useEsMovil`, Salidas partially, Alertas and En vivo are not.
- Do not change `Card`, `.qv-card`, `.qv-live-btn` or `.qv-plate` unconditionally: used by many desktop screens (`.qv-live-btn` also in En vivo HUD desktop).
- Dark mode: the comp defines a full dark set; the repo has dark tokens (tokens.css L113). Every new color needs a dark counterpart.
- Reduced motion: the comp's pulse animation is disabled under `prefers-reduced-motion`.
- a11y of new pieces: tab badge text, overflow menu (focus management, Escape, `aria-haspopup`), collapsible "Salidas recientes" (`aria-expanded`), segmented designation (already pressed-state buttons), pill markers (keep `aria-label`).
- QA constraint in memory: validate with the existing emulator/PWA flow; this audit did not run any browser or emulator (instructed not to).

## 7. Summary: what already exists vs needs new data

Frontend only (data exists):
- State, speed, vuelta, line, last-fix age on Hoy results and the vehicle sheet (`PosicionEnVivo`).
- Severity counts (chips), "N graves" chip, open-alert count for the tab badge.
- Pending sanctions count on Alertas link (query exists, `sancionesApi`).
- "12 de 15" (`resumenFlota`), "hace N s" (`useSaludRefresco`), line selector (`lineas`), "Sigue 2:40", recent-departure count, terminal name + number in fila.
- Designación segmented (`SeccionVuelta` mutation exists), Llamar/WhatsApp/URLs.
- Pill markers by state (see section 5).

Needs new API field or a join (not confirmed to exist):
- Street/address text ("Av. Tiquipaya", "Av. Tiquipaya y calle Jordán").
- Driver name per fila row ("Bravo Soliz Javier"): not in `FilaSalidaPanelItem` as far as I saw; a join with `useJornadasHoy` is possible.
- Union name in headers/user card, user full name and initials ("LQ"): only `email` and `rol` seen on `user`.
- Line id for filtering Alertas by line: `InfraccionHoy.lineaNombre` seen; `lineaId` not confirmed.
- "Solo lectura" tag on Rutas: product fact, not data.

## 8. Proposed ordered PRs (each shippable alone)

1. **PR 1: Mobile token block + type base (low risk).** Scoped `@media (max-width:720px)` tokens (section 1), font/weight decisions, dark counterparts, no visual rewrite. Nothing else depends on it besides colors. Risk: low; verify desktop unaffected (no unconditional edits) and that `--qv-text-secondary` override, if used, does not darken unwanted areas.
2. **PR 2: Shell: single solid header + tab bar badge.** Mobile header replacing glass topbar + `PageHeader` (new `MobileHeader` slot with title/subtitle/right), tab bar height 76 and badge (`MobileTab.badge`, hook in `DashboardShell`), 16 px side padding. Touches `layout.tsx` (design-system and app), CSS L5021-5120, L5422+. Risk: medium (all pages affected; double-title regressions, En vivo `bare` layout, `operador` role has no Alertas tab).
3. **PR 3: Plate (sign style) + shared mobile primitives.** `PlateBadge` `size` and sign variant behind a modifier or mobile media rule; `.tile`, `.card`, `.btn`, `.tag`, `.lbl` mobile primitives. Risk: medium (12 desktop usages; limit to <=720, check tables in Vehículos/Reglas/Rotaciones/Reportes at phone width).
4. **PR 4: Hoy.** Tiles (number-first, semantic colors, red alerts tile + graves chip), search (purple border 60 px), result card with state/speed/vuelta/line tag, purple Llamar and green WhatsApp, header pill. Frontend only. Risk: low-medium (Hoy fork isolated). Decide KPI order (CTO says summary first; comp B shows search first).
5. **PR 5: Alertas.** Severity chips + count, flat list, neutral cards, severity badge, time format, 3-button row ("Ver en mapa" decision), pending-sanctions count, status filter relocated. Rules inside the media block. Risk: medium (desktop shares the page; filter semantics).
6. **PR 6: Salidas.** `FilaMovil` (rebuilt list: position box, first row highlighted with 42 px countdown and big Despachar), overflow menu (Al final / Retirar with existing confirm dialogs), collapsible "Salidas recientes", freq card with inline Guardar, new header copy. Risk: high-ish (new menu a11y, driver name data gap, dispatch is an operational action: test confirm flows and the `habilitado` / anticipated paths).
7. **PR 7: Más as a page.** `/mas` route, list from `NAV_ITEMS` filtered by role (excluding tab items), user card, red outlined logout, tab becomes a link; remove or keep the drawer. Risk: medium (role coverage for operador/admin_sindicato, route guard, losing items not in the comp, drawer a11y tests, `isNavActive` for the Más tab).
8. **PR 8: En vivo map chrome.** Two floating chips (line selector chip, "12 de 15 · hace 3 s"), moving Flota/Siguiente alerta/Días anteriores/severity counters somewhere. Risk: high (functional loss if features are dropped; needs product decisions; `barra-mando.tsx` is shared with desktop at <1024).
9. **PR 9: Map pill markers (mobile only).** CSS-first restyle of `.qv-gmap-veh` at <=720 (pill by state, prefix glyph, keep alert/Molinos badges, selected purple), 44 px hit area, forced-colors check. Risk: medium-high (marker anchoring, tap target, color mapping for detenido/finalizado/inactivo undefined in the comp, no engine parity with MapLibre).
10. **PR 10: Vehicle sheet.** Big plate, close square button, stats tiles (Vuelta N / Alertas), designation segmented on top, Llamar + Ver recorrido primary, rest to expanded section. Risk: medium (dense component, Escape/focus behaviors at `panel-vehiculo.tsx:335-348` must be preserved).

Suggested order rationale: tokens, shell and primitives first (everything else depends on them), then low-risk Hoy and Alertas, then Salidas and Más, then the high-risk En vivo trio last.

## 9. Not confirmed / not verified

- Whether `user` in `useAuth` carries a name or union name; whether `FilaSalidaPanelItem` carries a driver name; whether `InfraccionHoy` has `lineaId`; whether `/rutas` is read-only on mobile; the actual street-name source for any location text.
- Oxanium weights actually loaded (next/font default range assumed).
- `panel-flota.tsx`, `.qv-vuelta__*` CSS, `route-map-google.tsx` outside the marker code, and the MapLibre engine details were read only partially.
- The comp's "44 px countdown" (intro text) vs CSS `42px`: I quote the CSS, 42 px.
- No rendering or measurement was done (instructed not to start browsers); the dimensions of production come from CSS and the screenshots only.

Skipped/unchecked per ponytail: no code, no tests, no desktop regression check; the main risk is the En vivo chrome and Salidas rebuild, where the comp drops features (Flota, Días anteriores, alert counters, driver data) that need a product decision before work starts.