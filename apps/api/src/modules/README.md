# Convención de módulos de dominio

Cada carpeta es un módulo NestJS autocontenido (doc técnico §2, §3): controller + service +
repository propios. **Un módulo solo importa de otro a través de su `index.ts`** (el barrel
que exporta su `*.module.ts` y, si aplica, tipos/servicios explícitamente públicos) — nunca
haciendo deep-import a un archivo interno de otro módulo (`import { X } from '../otro/otro.service.js'`
está prohibido; usar `import { OtroModule } from '../otro/index.js'`).

Esto es lo que permite extraer un módulo (ej. `tracking`/`sync`) como servicio propio más
adelante sin romper al resto (camino de escalado, doc técnico §10).

Módulos y su alcance (RF del doc de Producto):

| Módulo           | RF    | Estado                                                            |
| ---------------- | ----- | ----------------------------------------------------------------- |
| `auth`           | —     | ✅ real (QUI-219)                                                  |
| `sindicatos`     | 01-04 | ✅ real (QUI-220)                                                  |
| `socios`         | 05-09 | ✅ real (QUI-221)                                                  |
| `vehiculos`      | 10-14 | ✅ real (QUI-222)                                                  |
| `conductores`    | 15-19 | ✅ real (QUI-223)                                                  |
| `lineas`         | 20-23 | ✅ real (QUI-224)                                                  |
| `rutas`          | 24-33 | ✅ real (QUI-225)                                                  |
| `control-points` | 34-39 | ✅ real (QUI-226)                                                  |
| `reglas`         | 40-50 | ✅ real (QUI-244) — evidencia auto-vinculada queda pendiente de M3 |
| `rotaciones`     | 51-57 | ✅ real (QUI-230..234)                                             |
| `tracking`       | 58-66 | esqueleto — bloqueado por M3 (QUI-216 spike GPS sin hardware)      |
| `sync`           | 67-73 | esqueleto — bloqueado por M3                                       |
| `reportes`       | 74-80 | esqueleto — bloqueado por M3 (necesita datos reales de tracking)  |
| `auditoria`      | 81-84 | ✅ real (QUI-230/248)                                              |
