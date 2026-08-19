# Archivo de documentos

Documentos que dejaron de estar vigentes. Se conservan porque explican **por qué** se tomaron
decisiones que hoy se dan por sentadas, no porque sirvan de guía.

> **Regla de lectura: nada de acá es fuente de verdad.** Si un documento archivado contradice a
> uno vivo, gana el vivo. Antes de usar cualquier procedimiento de estos, verificá contra el
> código o contra el documento que lo reemplazó.

Archivado el 2026-08-19.

| Documento | Murió | Por qué | Qué lo reemplaza |
|---|---|---|---|
| [`0001-railway-vs-flyio.md`](0001-railway-vs-flyio.md) | 2026-08-14 | ADR anulado. Nunca se ejecutó: no se creó cuenta ni se aprovisionó nada en Railway ni en Fly.io. La cuenta de GCP de la organización se reactivó y evaluar dos proveedores nuevos dejó de tener retorno. El propio documento avisa "no usar nada de esto como guía de despliegue" | [`adr/0002-gcp.md`](../adr/0002-gcp.md) |
| [`plan-repo-github.md`](plan-repo-github.md) | 2026-07-20 | Bootstrap del repositorio: decidir monorepo vs. repos separados y crearlo en la org. Ejecutado; el repo existe desde entonces | — (la estructura vive en [`plan-maestro.md`](../plan-maestro.md) §Estructura) |
| [`plan-auth-movil-quivo.md`](plan-auth-movil-quivo.md) | 2026-08-01 | Plan de la autenticación encadenada vehículo→conductor. El propio documento se declara "implementado y verificado en Android" | Ninguno lo reemplaza. **Sigue siendo la descripción escrita del contrato de auth móvil**: si hay que cambiarlo, leer esto primero y después el código (`auth-movil.service.ts`) |
| [`coordinacion-agentes.md`](coordinacion-agentes.md) | 2026-08-03 | Canal de mensajes para evitar solapamientos entre dos agentes (Codex y Claude) trabajando en paralelo. Sin mensajes nuevos desde esa fecha; el modo de trabajo con dos agentes concurrentes se terminó | — |
| [`ramas-sprint-m6.md`](ramas-sprint-m6.md) | 2026-08-13 | Auditoría de cierre: verificó con `git merge-base`/`rev-list` que las 3 ramas del sprint M6 estaban íntegramente en `main` antes de borrarlas. Las ramas ya se borraron | — |
| [`plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md) | 2026-08-14 | Plan para retomar el proyecto tras el merge del PR #1: destrabar el CI (8 de 8 corridas rojas), reconstruir el design system perdido y reescribir el roadmap de Valentina. Ejecutado; el propio documento se declara "registro cerrado" | El estado del CI y del roadmap vive en [`handoff.md`](../handoff.md) |
| [`plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md) | 2026-08-15 | Apuntaba el piloto al 5–19 de octubre y trataba el spike GPS como gate previo. Ambas premisas cayeron cuando el CTO adelantó el piloto al 17 de agosto. **Era la única fuente de varios hallazgos que siguen abiertos: se rescataron antes de archivarlo** | [`plan-piloto-lunes-17-agosto.md`](../plan-piloto-lunes-17-agosto.md) para alcance y fechas · [`deuda-abierta.md`](../deuda-abierta.md) para los hallazgos rescatados · [`adr/0002-gcp.md`](../adr/0002-gcp.md) para la arquitectura de despliegue |
| [`plan-despliegue-panel-web.md`](plan-despliegue-panel-web.md) | 2026-08-16 | Plan de una sola tarea: subir `apps/web` a Cloud Run antes del piloto. Ejecutado el mismo día (PR #23); el panel está desplegado | El procedimiento quedó automatizado y versionado en `scripts/deploy-web.sh`, con sus tres trampas documentadas ahí |

## Lo que se rescató antes de archivar

`plan-finalizacion-piloto.md` era la única fuente escrita de hallazgos todavía abiertos. Todo lo
que seguía siendo cierto el 2026-08-19 y no estaba registrado en ningún otro lado se movió a
[`deuda-abierta.md`](../deuda-abierta.md): los hallazgos de seguridad que no se cerraron
(`audit_log` sin `REVOKE` ni `ip`/`userAgent`, los `GET` sin auditar, los 8 servicios sin filtro
por `sindicatoId`, helmet/CSP, inyección de fórmulas en el CSV, `pnpm audit`, la SQLite del móvil
sin cifrar y su razonamiento, Sentry ausente en `apps/web`), el criterio de gate del k6 que nunca
corrió, las brechas de escalabilidad, la contingencia completa ante un NO-GO del spike GPS con el
costeo del Plan B en Kotlin, el trámite de Google Play para `ACCESS_BACKGROUND_LOCATION`, y las
tres cosas que al checklist de aceptación todavía le faltan.

Ese mismo documento lleva la lista de lo que **sí** se cerró (RLS de `gps_points`, guardarraíl de
`JWT_SECRET`, rotación del refresh web, `usesCleartextTraffic`, `enableShutdownHooks`, Dockerfiles
y despliegue, Sentry móvil, migración de SDK), para que nadie lo reabra al leer el plan viejo.

## Qué NO está acá

Siguen vivos en `docs/`: `handoff.md`, `plan-maestro.md`, `documento-tecnico-cto.md`,
`plan-piloto-lunes-17-agosto.md`, `plan-ruta-real-z12.md`, `plan-v2-app-y-mapa-en-vivo.md`,
`plan-salida-apk-v2.md`, `plan-evolucion-vehiculo.md`, `spike-gps.md`, `deuda-abierta.md`,
`contexto-concept-art-app-movil-quivo.md`,
`QUI-339-auditoria-accesibilidad.md`, `adr/0002-gcp.md`, y todo `runbooks/`, `piloto/` y
`pasantias/`.

Dos casos que se evaluaron para archivar y **se dejaron vivos a propósito**:

- **`spike-gps.md`** — el spike dejó de ser gate previo (se absorbió en la prueba de campo), pero
  sus 4 criterios GO siguen sin medirse: las trazas de las jornadas del 17 y 18 de agosto salieron
  de Geo Tracker, no de la app propia. Es el único documento con el protocolo de medición y la
  tabla de resultados a completar.
- **`plan-piloto-lunes-17-agosto.md`** — el piloto ya ocurrió, pero ningún documento lo reemplazó
  como fuente de verdad de alcance y fechas, y es donde vive la lista de hardening diferido y el
  arranque del entorno local.
