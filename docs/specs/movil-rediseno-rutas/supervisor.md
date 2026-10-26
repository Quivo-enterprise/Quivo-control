# Supervisor (Claude) — pasos y lanzamiento

## Paso 0 (supervisor, antes de lanzar a los Codex)
1. Traer el design system nativo **dentro del repo** como `packages/design-system-native` (copia de
   `Quivo-UI-UX/packages/design-system-native/src`), igual que ya se hace con `packages/design-system` para la web.
   Un `link:` a otro repo rompería el build en EAS, que solo sube este repo.
2. `apps/mobile/package.json`: `"@quivo/design-system-native": "workspace:*"` + `pnpm install` (con `DATABASE_URL` del `.env`: el postinstall de Prisma lo pide).
3. `App.tsx`: registrar también los alias `Oxanium` y `Montserrat` en `useFonts` (el design system pide la familia
   por nombre corto; la app carga `Oxanium_600SemiBold`, etc.). Sin esto, `Heading`/`Text` caen a la fuente del sistema.
4. `design-system.ts` (puente de tokens del design system, separado porque `quivo-theme.ts` lo usa lógica con tests) y `quivoBubble` en `quivo-theme.ts`
   (`touch 44 · padding 8 · gap 8 · radius 30 · innerRadius 22 · edge 12`) + superficie y borde de burbuja.
   `quivoColors` se mantiene por compatibilidad mientras dure la migración.
5. Verificar en el Motorola que la app arranca con un `Button` del design system (sin segunda copia de React:
   `paquetes-singleton.cjs` ya fuerza `react`/`react-native` desde `apps/mobile`).
6. Commit del paso 0 antes de lanzar.

## Lanzamiento (iteración N, los dos en paralelo)
```bash
CODEX_HOME=~/.codex-trabajo1 codex exec -C ~/Proyectos/QUIVO/Quivo-control -m gpt-6-sol \
  -c model_reasoning_effort=low -s workspace-write --add-dir ~/Proyectos/QUIVO/Quivo-rutas \
  --add-dir ~/Proyectos/QUIVO/Quivo-UI-UX \
  "Lee y ejecuta docs/specs/movil-rediseno-rutas/codex-trabajo1-iteracion-N.md"

CODEX_HOME=~/.codex-trabajo2 codex exec -C ~/Proyectos/QUIVO/Quivo-control -m gpt-6-sol \
  -c model_reasoning_effort=low -s workspace-write --add-dir ~/Proyectos/QUIVO/Quivo-rutas \
  --add-dir ~/Proyectos/QUIVO/Quivo-UI-UX \
  "Lee y ejecuta docs/specs/movil-rediseno-rutas/codex-trabajo2-iteracion-N.md"
```

## Revisión entre iteraciones
- `git diff` por dueño: confirmar que nadie salió de su tabla de propiedad ni tocó lógica.
- typecheck, lint y test.
- Metro local (`:8081`) + API local (`192.168.1.17:3001`); capturas en el Motorola con
  `adb exec-out screencap -p > captura.png`: login, splash, asignación, mapa (día sin iniciar / en recorrido /
  pausado), modales, perfil y ajustes.
- Anotar correcciones al final de `*-iteracion-2.md`, un commit por Codex y por iteración.
