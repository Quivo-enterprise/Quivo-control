# Convención de módulos de dominio

Cada carpeta es un módulo NestJS autocontenido (doc técnico §2, §3): controller + service +
repository propios. **Un módulo solo importa de otro a través de su `index.ts`** (el barrel
que exporta su `*.module.ts` y, si aplica, tipos/servicios explícitamente públicos) — nunca
haciendo deep-import a un archivo interno de otro módulo (`import { X } from '../otro/otro.service.js'`
está prohibido; usar `import { OtroModule } from '../otro/index.js'`).

Esto es lo que permite extraer un módulo (ej. `tracking`/`sync`) como servicio propio más
adelante sin romper al resto (camino de escalado, doc técnico §10).

Módulos y su alcance (RF del doc de Producto):

| Módulo           | RF    | Estado                         |
| ---------------- | ----- | ------------------------------ |
| `auth`           | —     | esqueleto, real en QUI-219     |
| `sindicatos`     | 01-04 | esqueleto, real en QUI-220     |
| `socios`         | 05-09 | esqueleto, real en QUI-221     |
| `vehiculos`      | 10-14 | esqueleto, real en QUI-222     |
| `conductores`    | 15-19 | esqueleto, real en QUI-223     |
| `lineas`         | 20-23 | esqueleto, real en QUI-224     |
| `rutas`          | 24-33 | esqueleto, real en QUI-225     |
| `control-points` | 34-39 | esqueleto, real en QUI-226     |
| `reglas`         | 40-50 | esqueleto, real en QUI-244     |
| `rotaciones`     | 51-57 | esqueleto, real en QUI-231/232 |
| `tracking`       | 58-66 | esqueleto, real en QUI-241     |
| `sync`           | 67-73 | esqueleto, real en QUI-240     |
| `reportes`       | 74-80 | esqueleto, real en QUI-246/249 |
| `auditoria`      | 81-84 | esqueleto, real en QUI-230/248 |
