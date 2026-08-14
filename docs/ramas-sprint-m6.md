# Ramas del sprint M6 — estado antes de borrarlas

> Documento de cierre. Registra qué contuvo cada rama del sprint M6 (Valentina, mobile UI)
> antes de que el chairman las borre del remoto. Cada afirmación de abajo está verificada con
> `git merge-base --is-ancestor` y `git log`/`git rev-list` contra `origin/main` — comando y
> salida real incluidos para que sea auditable. Generado 2026-08-13 como parte del cierre de
> `fix/vendorizar-design-system-ci-verde` (QUI-337).

## Resumen

Las 3 ramas están **completamente mergeadas en `origin/main`**: ninguna tiene commits propios
pendientes de integrar. Es seguro borrarlas.

| Rama | ¿Mergeada en `main`? | Commits adelante de `main` | Commits detrás de `main` | Contenido propio |
| --- | --- | --- | --- | --- |
| `qui-227-web-nextjs-scaffold` | Sí — merge commit [`98bae54`](#qui-227-web-nextjs-scaffold) (PR #1) | 0 | 1 | M0 → M6(parcial): todo el proyecto, de punta a punta |
| `feat/mobile-ui-valentina` | Sí — merge commit [`0416a28`](#feat-mobile-ui-valentina) (dentro de la anterior) | 0 | 7 | 1 commit propio: perfil, ajustes de sesión y estado operativo (M6) |
| `feat/mobile-ui-sprint-valentina` | Sí — merge commit [`fb815d3`](#feat-mobile-ui-sprint-valentina) (dentro de `qui-227-web-nextjs-scaffold`) | 0 | 12 ⚠️ (ver nota) | 1 commit propio: features operativos core (offline, GPS, sync de ruta) — ya viajaba en `qui-227-web-nextjs-scaffold` |

⚠️ **Nota sobre `feat/mobile-ui-sprint-valentina`:** el brief de esta tarea decía "0 commits
adelante, 8 atrás". La medición real da **12 atrás**, no 8 (ver comando y salida abajo). La
conclusión operativa no cambia — la rama sigue 100% mergeada y es segura de borrar — pero el
número exacto no coincidía con lo indicado, así que se reporta tal cual se lo pidió el CTO en
vez de escribir el dato original sin verificar.

---

## `qui-227-web-nextjs-scaffold`

La rama grande del proyecto. Se ramificó prácticamente desde el bootstrap del repo (`main`
solo tenía 2 commits de documentación antes de este merge) y acumuló, en orden: M0
(fundaciones — QUI-211..216), M1 (núcleo administrativo — QUI-217..229), M2 (rotaciones —
QUI-230..234), M3 (app móvil + sync — QUI-235..243), M4 (dashboard/reglas/auditoría —
QUI-244..249), M5 parcial (hardening, k6, retención GPS — QUI-250..253) y, sobre el final, dos
merges internos que traen contenido de M6 (mobile UI, ver las dos ramas de abajo).

Se mergeó a `main` en el **PR #1**, merge commit `98bae54`, título real en GitHub:
*"M3+M4+M5(parcial): app móvil, sync, dashboard/reportes, hardening"*.

**Nota de precisión:** el título del PR nombra solo M3+M4+M5, pero el rango de commits que trae
(`5e0f758..cecfe83b`, 74 commits) arranca en el scaffold del monorepo (QUI-211) — M0 y M1
también viajan en este mismo PR, no llegaron a `main` por separado. El título quedó desactualizado
a medida que creció el alcance de la rama; no es un error de fondo, solo un nombre que no
refleja el alcance completo.

**Verificación:**

```
$ git merge-base --is-ancestor origin/qui-227-web-nextjs-scaffold origin/main; echo $?
0

$ git log --oneline origin/main..origin/qui-227-web-nextjs-scaffold
(vacío)

$ git rev-list --left-right --count origin/qui-227-web-nextjs-scaffold...origin/main
0    1
```

(El "1 atrás" es el propio commit de merge `98bae54` en `main`, que no es ancestro de la rama
porque el commit de merge vive únicamente en `main`.)

```
$ gh pr view 1 --json title,mergeCommit,mergedAt,url
{"mergeCommit":{"oid":"98bae546470862119014e92ebd2133b0994d760f"},
 "mergedAt":"2026-08-14T02:28:11Z",
 "title":"M3+M4+M5(parcial): app móvil, sync, dashboard/reportes, hardening",
 "url":"https://github.com/Quivo-enterprise/Quivo-control/pull/1"}
```

---

## `feat/mobile-ui-valentina`

Contenido propio: **un solo commit**, `a7b0a72` — *"feat: implement user profile management,
session settings, and operational status tracking screens"* (2026-08-11). Coincide con lo
descrito en el brief: perfil/ajustes del sprint M6.

Se mergeó dentro de `qui-227-web-nextjs-scaffold` con el merge commit `0416a28` ("Merge
remote-tracking branch 'origin/feat/mobile-ui-valentina' into qui-227-web-nextjs-scaffold"),
que después viajó a `main` como parte del PR #1.

**Verificación:**

```
$ git merge-base --is-ancestor origin/feat/mobile-ui-valentina origin/main; echo $?
0

$ git log --oneline origin/main..origin/feat/mobile-ui-valentina
(vacío)

$ git rev-list --left-right --count origin/feat/mobile-ui-valentina...origin/main
0    7

$ git show --no-patch --format="%H %P %s" 0416a28
0416a28940097a20b13d25b3aa4b350c3445fd86 ac293238359439cab742d5222e339572ae4a61d \
  a7b0a7241918c4002d1636a35b4de832493365a9 Merge remote-tracking branch \
  'origin/feat/mobile-ui-valentina' into qui-227-web-nextjs-scaffold
```

---

## `feat/mobile-ui-sprint-valentina`

Contenido propio: **un solo commit**, `8d20f9a` — *"feat: implement core operational mobile
features including offline support, GPS tracking, and route synchronization"* (2026-08-09).
Es el mismo commit (mismo SHA, no un rebase/cherry-pick) que quedó incorporado en
`qui-227-web-nextjs-scaffold` vía el merge commit `fb815d3` ("Merge remote-tracking branch
'origin/feat/mobile-ui-sprint-valentina' into qui-227-web-nextjs-scaffold"). El resto del
historial de esta rama (commits anteriores a `8d20f9a`, ej. `a01c9d8`, `95c5e7b`, etc.) es
historia compartida con `qui-227-web-nextjs-scaffold` desde antes de que esta rama se creara —
no es contenido exclusivo suyo.

**Verificación:**

```
$ git merge-base --is-ancestor origin/feat/mobile-ui-sprint-valentina origin/main; echo $?
0

$ git log --oneline origin/main..origin/feat/mobile-ui-sprint-valentina
(vacío)

$ git rev-list --left-right --count origin/feat/mobile-ui-sprint-valentina...origin/main
0    12
```

```
$ git show --no-patch --format="%H %P %s" fb815d3
fb815d37b9600dd3f1a5b2e69786989f56bd0078 06d54de7cc1795fe05b2bed648ab4fbe4867defe \
  8d20f9a8f417a826e21e030f40af9454df3a5c13 Merge remote-tracking branch \
  'origin/feat/mobile-ui-sprint-valentina' into qui-227-web-nextjs-scaffold

$ git rev-parse origin/feat/mobile-ui-sprint-valentina
8d20f9a8f417a826e21e030f40af9454df3a5c13
```

---

## Conclusión

Las 3 ramas son seguras de borrar del remoto: no tienen ningún commit que no haya llegado ya a
`main` a través de `qui-227-web-nextjs-scaffold` / PR #1. El borrado (`git push origin --delete
<rama>`) queda a cargo del chairman, según la restricción de esta tarea.
