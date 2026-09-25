import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Antes de este archivo, `apps/api` no tenía `vitest.config.*` propio: vitest transformaba
 * TypeScript con esbuild puro (el default de Vite), que NO emite `design:paramtypes`
 * (evanw/esbuild#257 — esbuild no implementa `emitDecoratorMetadata`). Sin esa metadata,
 * Nest no puede resolver de qué tipo es un parámetro decorado con `@Query()`/`@Body()`, así
 * que `ZodValidationPipe` (`src/common/validation/zod-validation.pipe.ts`) nunca encuentra
 * `metatype.schema` y deja pasar el valor crudo sin coercionar — un comportamiento que NO
 * reproduce lo que corre en producción (`tsc`, que sí emite esa metadata). Ver el análisis
 * completo en `src/modules/sync/sync-errores.controller.integration.test.ts`.
 *
 * La solución es transformar con `@swc/core` (vía `unplugin-swc`) en vez de esbuild: swc sí
 * implementa `decoratorMetadata`, igual que `tsc`. Así los tests corren con la MISMA metadata
 * de decoradores que producción, en vez de una aproximación distinta.
 *
 * Nota: esto NO toca `pnpm dev` (que sigue con `tsx watch`, motor esbuild, sin esta metadata
 * — ver el apartado correspondiente en README.md de este paquete).
 */
export default defineConfig({
  // No había `vitest.config.*` antes de este archivo, así que no hay includes/env/timeouts
  // custom que preservar: `test` queda sin tocar a propósito, para heredar los defaults de
  // vitest tal cual corrían hoy (glob `**/*.{test,spec}.?(c|m)[jt]s?(x)`, sin `globals`,
  // sin timeouts especiales). Lo único nuevo acá es el transform vía swc.
  plugins: [
    // `tsconfigFile` no se pasa: por default unplugin-swc lee `tsconfig.json` del cwd
    // (`apps/api/tsconfig.json`), que ya trae `experimentalDecorators`/`emitDecoratorMetadata`
    // en `true`. Igual se fuerzan acá de forma explícita en `jsc.transform` (que unplugin-swc
    // mergea sobre lo inferido del tsconfig) para que este config no dependa silenciosamente
    // de que nadie toque esas dos flags en el tsconfig más adelante.
    swc.vite({
      jsc: {
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
      // El paquete es ESM (`"type": "module"` en package.json) — mantener la salida en
      // ES modules en vez de que swc la baje a CommonJS.
      module: {
        type: 'es6',
      },
    }),
  ],
});
