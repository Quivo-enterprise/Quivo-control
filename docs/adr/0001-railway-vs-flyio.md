# ADR 0001 — Railway vs Fly.io para staging/producción inicial

> **⚠️ ANULADO el 2026-08-14. Sustituido por [ADR 0002 — GCP](0002-gcp.md).**
>
> Nunca se ejecutó: no se creó cuenta ni se aprovisionó ningún recurso en Railway ni en Fly.io.
> Quedó obsoleto por un hecho externo — la cuenta de GCP de la organización se reactivó, y con
> facturación ya resuelta ahí, evaluar dos proveedores nuevos era trabajo sin retorno. Se
> conserva como registro histórico de por qué la infra estuvo sin decidir desde el Cycle 12;
> **no usar nada de este documento como guía de despliegue.**

**Estado:** ~~propuesto, sin aprovisionar~~ → **anulado** (2026-08-14), reemplazado por ADR 0002.
**Fecha:** 2026-07-20
**Contexto:** QUI-213, doc técnico §10.

## Problema

Necesitamos alojar 3 procesos (API NestJS, worker BullMQ, Redis) + Postgres 16 gestionado
con PostGIS, con deploy automático desde GitHub al mergear a `main`. Presupuesto objetivo:
US$50–150/mes (doc técnico §10, §13).

## Opciones evaluadas

| Criterio                               | Railway                                               | Fly.io                                                                      |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Postgres+PostGIS gestionado            | Sí, plugin oficial, PostGIS disponible como extensión | Fly Postgres (Machines) soporta extensiones, pero gestión algo más manual   |
| Redis gestionado                       | Sí, plugin oficial                                    | Sí (Upstash add-on o Redis en una Machine propia)                           |
| Deploy desde GitHub                    | Integración nativa por repo/branch, muy simple        | `fly deploy` vía GitHub Actions (un paso extra de CI)                       |
| Múltiples procesos (API + worker)      | Un servicio por proceso, fácil de separar             | Un `fly.toml` por app o "process groups" — más control, más configuración   |
| Precio de entrada                      | Plan Hobby ~US$5/mes + uso; escala con uso            | Sin plan fijo; se paga por Machines activas, puede ser más barato en reposo |
| Curva de aprendizaje / DX              | Muy baja, pensado para velocidad de MVP               | Media — más control pero más superficie de configuración                    |
| Regiones cercanas a Bolivia (latencia) | Limitado (US/EU)                                      | Más regiones, incluye São Paulo (`gru`)                                     |

## Recomendación (no ejecutada)

**Railway** para el MVP: prioriza velocidad de setup y DX sobre control fino de infraestructura,
coherente con el criterio de velocidad de desarrollo del council (`docs/plan-maestro.md`).
Fly.io queda como alternativa si la latencia a Bolivia o el costo en producción con tráfico
real lo justifican — no requiere reescritura (Docker-based en ambos).

## Decisión final

**Ninguna de las dos.** En el Cycle 12 quedó pendiente (no se creó cuenta ni se aprovisionó
ningún recurso cloud — el usuario confirmó "solo local por ahora" durante el kickoff), y el
2026-08-14 el CTO decidió **GCP**: ver [ADR 0002](0002-gcp.md).
