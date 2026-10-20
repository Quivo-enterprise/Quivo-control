# Runbook — día D: prueba real con 30 conductores

> Borrador del 19/10. Los campos `<…>` se completan en D-3, después del deploy r21. Plan:
> [`plan-dia-30.md`](plan-dia-30.md).

## Antes de D

| Cuándo | Qué | Quién | Hecho |
|---|---|---|---|
| D-5 o antes | Secreto `SENTRY_DSN_API` creado; token viejo de Sentry revocado | CTO | [ ] |
| D-4 | Ensayo B en el entorno efímero con todos los criterios en pase (ver plan, sección B) | Claude | [ ] |
| D-4 | Credenciales de los 30 creadas (script con `--apply`); rotación **publicada** | Claude + CTO | [ ] |
| D-3 | Deploy r21 (`scripts/deploy-gcp.sh r21-<fecha> --solo api` y `--solo worker`); `/v1/health/ready` ok | CTO | [ ] |
| D-3 | `scripts/observabilidad-gcp.sh` sin `--apply`, revisar, y después con `--apply` | CTO | [ ] |
| D-3 | Alerta de prueba llega al mail; error de prueba de la API aparece en Sentry | CTO + Claude | [ ] |
| D-3 | PITR con `--con-reinicio`, **fuera de horario** (reinicia la base) | CTO | [ ] |
| D-2 | **Congelamiento:** ni deploys ni OTAs hasta después de D | todos | [ ] |
| D-1 | Ensayo de login: cada chofer entra una vez en su teléfono (checklist de abajo) | CTO | [ ] |

Datos para volver atrás (se completan en D-3):
- Revisión de la API anterior a r21: `quivo-api-00025-vrj` (r20). Revisión r21: `<…>`.
- Imagen del worker anterior: `southamerica-west1-docker.pkg.dev/quivo-control-prod/quivo/api:r20-20261019`.
- OTA vigente en los teléfonos: `4781deab` (runtime `547d52e7…`). Group anterior para `republish`: `<…>`.

## Checklist por teléfono (imprimir uno por chofer)

Chofer: ________________  Placa: ____________

- [ ] APK 16 instalado (Perfil muestra versión 16).
- [ ] OTA `4781deab` en Perfil. Si no aparece: cerrar la app del todo y abrirla dos veces (la 1.ª descarga, la 2.ª
      aplica).
- [ ] Ubicación: "Permitir todo el tiempo".
- [ ] Batería: "Sin restricciones" para Quivo.
- [ ] Xiaomi/Redmi/POCO: "Inicio automático" activado. Huawei: "Inicio de apps", gestionar manualmente, todo activado.
- [ ] Login hecho en D-1 con placa + PIN propios.
- [ ] Datos móviles con saldo para todo el día.

Regla del día: **nadie entra con la placa de otro chofer desde otro teléfono.** Cada login cierra las otras sesiones
de ese vehículo.

## Día D — orden en la calle

1. **Regreso desde Honduras** (1 trufi): al cruzar el PC de Honduras tiene que cambiar solo a la línea de regreso.
2. **Vecinos** (2 trufis): una sola fila por vehículo, mismas distancias en los dos, sin inversiones en Honduras ni en
   Salomón Romero; mirar qué pasa con uno esperando en Molinos.
3. **Molinos:** designar desde el panel; el chofer recibe el aviso al arrancar la vuelta.
4. **Los 30:** arranque de turno con todos.

## Qué miro en vivo (Claude, solo lectura)

| Señal | Dónde | Normal | Frenar si |
|---|---|---|---|
| Logins | logs de Cloud Run: `POST /v1/mobile/auth/sesion` por status | 200 | > 3 respuestas 429 por placa distinta en 5 min |
| Errores API | Sentry (proyecto de la API) + 5xx en Cloud Run | 0 | > 5 5xx en 5 min, o un error nuevo que se repite |
| Errores móvil | Sentry `quivo-control-conductor` | 0 nuevos | crash o error repetido en > 2 teléfonos |
| Base | Cloud SQL: CPU y conexiones | CPU < 40 %, conexiones < 30 | CPU > 80 % o conexiones > 40 por 5 min |
| Redis | memoria | plana | sube sin parar |
| Ingesta | logs del worker: `cola pendiente=N` | aparece seguido, N chico | deja de aparecer por > 3 min con choferes activos (worker trabado) o N crece sin parar |
| Panel | `/en-vivo` | 30 vehículos frescos | vehículos "sin reportar" que no vuelven en 2 min |

## Volver atrás

- **API:** `gcloud run services update-traffic quivo-api --project quivo-control-prod --region southamerica-west1
  --to-revisions=quivo-api-00025-vrj=100`
- **Worker:** `gcloud run worker-pools deploy quivo-worker --project quivo-control-prod --region southamerica-west1
  --image southamerica-west1-docker.pkg.dev/quivo-control-prod/quivo/api:r20-20261019` (verificar antes de D que
  esta forma conserva los flags del deploy; si no, re-desplegar desde el commit de r20 con
  `scripts/deploy-gcp.sh r20-20261019 --solo worker`).
- **OTA:** `eas update:republish --group <group anterior>` (lo corre el CTO).
- r21 no trae migraciones nuevas de base: volver la API o el worker no requiere tocar la DB.

## Plan B operativo

Si la app no sirve para un chofer (no entra, no reporta): el control sigue con el registro manual de siempre para ese
trufi y se anota placa + hora + síntoma para revisarlo después. La prueba no se corta por un teléfono.

## Después de D

- Informe: métricas reales (pico de conexiones, CPU, p95, 429, errores) contra el ensayo B; decisión del tier de SQL.
- Pendientes: A4 (vencimiento de rotaciones al worker), A5 (archivo GPS, antes de enero), Fase 2, OSRM, OTA desde CI.
