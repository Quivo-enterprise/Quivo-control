# ADR 0002 — Public Mobility API como frontera de datos para pasajeros

**Estado:** Aceptado  
**Fecha:** 2026-08-18

## Contexto

QUIVO Control es propietario de la información operativa de organizaciones, líneas, rutas, variantes, geometrías y paradas. QUIVO Rutas necesita esa información para la experiencia pasajero, pero no puede consultar la base de datos ni consumir los endpoints administrativos protegidos por tenant y rol.

Además, que un recurso esté operativo no significa que sea apto para publicación pública. Las paradas del legado contienen nombre y referencia que Control no modelaba todavía.

## Decisión

Control expondrá una frontera de solo lectura bajo `/v1/public/mobility` con DTOs específicos de pasajero. Los endpoints solo devuelven recursos cuyo `publicStatus` sea `publicado` y cuyos recursos operativos dependientes estén activos.

`Linea`, `Ruta`, `Variante` y `Parada` incorporan un estado editorial (`borrador`, `validado`, `publicado`, `archivado`) independiente de su estado operativo. La transición se gestiona de manera autenticada en `/v1/mobility-publications/:resource/:id`; los recursos existentes se inicializan como borrador, nunca se publican automáticamente mediante una migración.

Las paradas reciben `nombre` y `referencia` para permitir ficha y búsqueda pública. Las geometrías se siguen representando como GeoJSON, sin exponer entidades Prisma ni acceso directo a PostGIS.

## Consecuencias

- Rutas puede cachear catálogo público sin recibir datos personales o administrativos.
- La carga de datos requiere una revisión editorial explícita antes de que aparezca en la app.
- El siguiente paso es ampliar la Mobility API con autocompletado, proximidad, QR y planner, manteniendo el mismo límite de publicación.
- La migración debe aplicarse antes de habilitar los endpoints en un ambiente compartido.

