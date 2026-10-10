# Documentación de QUIVO Control — índice

**Por dónde empezar:**
1. [`handoff.md`](handoff.md): estado actual y punto de retome. Leer primero.
2. [`srs/README.md`](srs/README.md): qué tiene que hacer el sistema (requisitos, hallazgos, decisiones abiertas).
3. [`arquitectura/vision-general.md`](arquitectura/vision-general.md): cómo está armado.
4. [`plan-saneamiento.md`](plan-saneamiento.md): plan vigente de orden técnico.

**Reglas de precedencia:**
- El código manda sobre la documentación.
- El SRS manda sobre planes viejos en *qué* hace el sistema.
- Los planes mandan en *qué hay que hacer*. El handoff registra *qué se hizo*.
- Si encontrás una contradicción, se corrige el doc en el mismo PR.

## Referencia (vigente)

| Documento | Qué es |
|---|---|
| [`srs/`](srs/README.md) | SRS (ISO 29148 liviano), reconstruido desde el código el 2026-10-10 |
| [`glosario.md`](glosario.md) | Vocabulario del dominio |
| [`arquitectura/vision-general.md`](arquitectura/vision-general.md) | C4 contexto y contenedores, monorepo, decisiones, deuda estructural |
| [`datos/modelo.md`](datos/modelo.md) | ERD, diccionario de datos, RLS, particiones, migraciones |
| [`calidad/linea-base.md`](calidad/linea-base.md) | Línea base de typecheck y tests, y huecos de pruebas |
| [`documento-tecnico-cto.md`](documento-tecnico-cto.md) | Diseño técnico original (2026-08). Tiene derivas frente al código; el SRS registra las contradicciones |
| [`plan-maestro.md`](plan-maestro.md) | Plan base del proyecto (stack, fases) |
| [`adr/`](adr/) | Decisiones de arquitectura (pendiente: renumerar e indexar, plan de saneamiento Fase 1) |
| [`deuda-abierta.md`](deuda-abierta.md) | Deuda de seguridad y escalabilidad |
| [`estados-red-vs-captura.md`](estados-red-vs-captura.md) | Qué fallas se muestran al chofer |
| [`categorizacion-colores-y-estados.md`](categorizacion-colores-y-estados.md) | Guía de color y estado |
| [`infra-gcp-prod.md`](infra-gcp-prod.md) | Infraestructura de producción |
| [`costos-gcp-2000.md`](costos-gcp-2000.md) | Costos de 10 a 2000 conductores (vigente) |
| [`dev/credenciales-demo.md`](dev/credenciales-demo.md) | Usuarios demo de desarrollo (sin secretos) |

## Operación

| Documento | Qué es |
|---|---|
| [`runbooks/alta-de-conductor-android.md`](runbooks/alta-de-conductor-android.md) | Alta de conductor y permisos de ubicación |
| [`runbooks/retencion-gps.md`](runbooks/retencion-gps.md) | Retención y restauración GPS |
| [`piloto/checklist-aceptacion-e2e.md`](piloto/checklist-aceptacion-e2e.md) | Umbrales de aceptación y criterios de aborto del piloto |
| [`piloto/planilla-acompanante.md`](piloto/planilla-acompanante.md) | Planilla del acompañante |

## Planes

| Plan | Estado |
|---|---|
| [`plan-saneamiento.md`](plan-saneamiento.md) | **Vigente**, en ejecución |
| [`plan-ubicacion-fluida.md`](plan-ubicacion-fluida.md) | **Vigente**: Fases A y B hechas, spike S1/S2 en calle |
| [`plan-apk-build-11.md`](plan-apk-build-11.md) | **Vigente** (runbook de release del APK) |
| [`plan-correccion-post-piloto-2026-09-09.md`](plan-correccion-post-piloto-2026-09-09.md) | Vigente, en ejecución parcial |
| [`plan-cola-terminales.md`](plan-cola-terminales.md) | Aparcado |
| [`plan-evolucion-vehiculo.md`](plan-evolucion-vehiculo.md), [`plan-unicidad-placa.md`](plan-unicidad-placa.md) | Parcial; desactualizados frente al schema (SRS §2) |
| [`plan-backend-quivo-rutas.md`](plan-backend-quivo-rutas.md) | Parcial, superseded por el ADR de public-mobility |
| `plan-v2-app-y-mapa-en-vivo`, `plan-salida-apk-v2`, `plan-ruta-real-z12`, `plan-siembra-produccion`, `plan-apk-conductor-usable`, `plan-cierre-pr51`, `plan-integracion-redesign-jairo`, `plan-movil-login-y-pruebas`, `plan-costos-2000`, `plan-experimento-puntos-gps`, `plan-en-vivo-resumen-sesion`, `plan-piloto-lunes-17-agosto` | **Completados.** Se moverán a `archivo/` (plan de saneamiento, Fase 1) |

## Histórico

[`archivo/`](archivo/README.md): documentos superseded, con el motivo de cada uno.

## Pendiente de la Fase 1 (plan de saneamiento)

- Renumerar e indexar los ADR (hay dos `0002`) y hacer el backfill de decisiones.
- Partir `handoff.md` (más de 4k líneas) en estado actual y bitácora.
- Mover los planes completados a `archivo/`.
- Corregir las contradicciones listadas en cada dominio del SRS (§5 de cada uno).
- Referencia de la API (OpenAPI commiteado y chequeo de drift en CI).
- Runbooks de release y rollback.
