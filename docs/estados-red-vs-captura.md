# Regla: transporte vs. captura en la pantalla del chofer

Referenciada desde el código (`operation-screen.tsx`, `use-gps-operativo.ts`,
`perfil-screen.tsx`, `next-control-sheet.tsx`) — Entrega 4 de
`docs/plan-correccion-post-piloto-2026-09-09.md`, que a su vez cierra el "Principio rector"
decidido por el CTO para esa corrección post-piloto.

## La regla

**La pantalla del chofer no tiene ningún widget cuyo valor dependa de la red.**

La app nunca miente sobre si está **registrando**; solo calla sobre si ya **envió**.

| Categoría | Ejemplo | El chofer ve |
|---|---|---|
| Falla de **CAPTURA** | GPS apagado, permiso revocado, no se puede escribir el dato, sesión irrecuperable, disco lleno | **Sí** — aviso claro, en lenguaje de chofer, accionable (botón al ajuste que corresponde) |
| Falla de **TRANSPORTE** | Sin cobertura, 5xx, timeout, 429, backlog del outbox, reintentos de refresh | **No** — invisible en pantalla; el evento va a Sentry, nunca a la UI |

El criterio para decidir en qué categoría cae algo nuevo: si la falla significa que la
evidencia (un punto GPS, un evento de control) **no se pudo grabar** o no se va a poder
recuperar de forma autónoma, es CAPTURA y se muestra. Si la evidencia **ya está grabada** en
SQLite y lo único que falta es que viaje por red al servidor, es TRANSPORTE y se oculta — el
outbox reintenta solo, con su propio backoff, y ningún widget debe reflejar ese proceso.

## Aplicación (Entrega 4)

- `OfflineBanner` (`apps/mobile/src/features/operacion/offline-banner.tsx`, eliminado) y el
  banner de `errorSync` en `operation-screen.tsx`: TRANSPORTE puro — sin conexión es el estado
  normal de un chofer manejando, y un fallo de sync es retransmisible sin acción posible del
  chofer. Se sacaron de pantalla.
- `pendientes >= 800` (`operation-screen.tsx`, eliminado): investigado antes de tocarlo.
  `contarEventosPendientes` (`apps/mobile/src/db/outbox.ts:320`) solo cuenta filas
  `estado != 'acusado'`, sin ningún tope de capacidad asociado. La única purga del outbox,
  `purgarAcusadosAntesDe` (`apps/mobile/src/db/outbox.ts:502`), borra exclusivamente eventos
  YA ACUSADOS fuera de una ventana de días — nunca eventos `pendiente`. Un backlog grande de
  pendientes no arriesga perder evidencia: es exactamente "los pendientes haciendo su
  trabajo" (texto del plan). Es TRANSPORTE y se oculta. Si en el futuro aparece un límite real
  de capacidad de SQLite (disco lleno, `SQLITE_FULL`), esa detección es CAPTURA y sí debe
  mostrarse — queda para la Entrega 26 (preflight), con una escritura canaria real, no un
  proxy del tamaño de la cola de sync.
- `use-gps-operativo.ts` — "no se pudo guardar una ubicación en el outbox" es una falla de
  escritura a SQLite (disco lleno, handle zombi), no de red: es CAPTURA. Se reescribió en
  lenguaje de chofer y accionable ("El teléfono no pudo guardar tu recorrido. Revisá el
  espacio disponible."), sin ocultarla. El `Sentry.captureException` técnico se conserva
  intacto para diagnóstico.
- `sesionIrrecuperable` (circuit breaker de refresh, Entrega 3,
  `apps/mobile/src/shared/api/refresh-circuit-breaker.ts`): un 401 transitorio con el circuito
  reintentando es TRANSPORTE (invisible). Recién cuando el circuito lleva abierto más de
  `UMBRAL_MS_SESION_IRRECUPERABLE` sin ningún probe exitoso se considera CAPTURA (la app no
  puede recuperar sesión sola) y el estado se expone — la Entrega 26 (preflight) es quien
  construye el aviso visible; esta entrega solo deja el flag/hook listo.
