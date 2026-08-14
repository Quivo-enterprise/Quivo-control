# ADR 0001 — Railway vs Fly.io para staging/producción inicial

**Estado:** propuesto, sin aprovisionar (decisión pendiente de confirmación del usuario antes
de crear cuenta/recursos reales — ver `docs/handoff.md`).
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

**Pendiente.** No se crea cuenta ni se aprovisiona ningún recurso cloud en este cycle
(Cycle 12) — el usuario confirmó "solo local por ahora" durante el kickoff. El
`docker-compose.yml` de la raíz cubre el entorno de desarrollo; el deploy automático a
staging se diseña (workflow de CI) pero queda inactivo hasta esta decisión.
