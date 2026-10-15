# Plan — PC intermedios de la línea 16 por fase (PR #164, 2026-10-15)

## Objetivo
Agregar PC intermedios cada ~2 km a la L16, separados por fase. Así el APK con fases (#165) detecta
solo los de la fase actual y no hay doble detección en las calles que comparten ida y regreso.

## Plan de PC (17, en orden de marcha)

| Orden | PC | Rol | Fase |
|---|---|---|---|
| 0 | Salomón Romero | `terminal` | ambas |
| 1–7 | km 2–14 | — | ida |
| 8 | Honduras | `retorno` | límite |
| 9–14 | km 16–26 | — | regreso |
| 15 | Molinos | `espera` | regreso |
| 16 | km 28 | — | regreso |

Notas:
- El km 26 queda a unos 20 m de la bifurcación de Molinos (v43). Es un PC en la bifurcación y es válido en las dos vueltas.
- La bajada de Molinos se reincorpora en el km 26.02, antes del km 28, así que el km 28 no se saltea en las vueltas vía Molinos.

## Reglas de generación
- Intermedios cada 2000 m dentro de cada fase: la ida va de 0 a sHonduras y el regreso de sHonduras al fin.
- Un candidato se descarta si queda a menos de 300 m de otro intermedio de la **misma** fase.
- Un candidato se descarta si queda a menos de 500 m de un PC con rol activo en su fase. SR y Honduras cuentan para las dos fases; Molinos, solo para el regreso.
- Se quitó la guarda de 250 m previa a Honduras: con #161, los intermedios no disparan `pc_omitido`.

## Emparejamiento con lo que hay en prod
- **Estado de prod verificado el 15/10:** 3 PC activos (orden 0 SR, 1 Molinos, 2 Honduras), todos sin `rol`, con coordenadas idénticas al plan.
- **PC con rol:** se emparejan por `rol`. Si ninguno lo tiene, se usa el PC sin rol más cercano a menos de 50 m. El PATCH les pone `rol` y `orden` y conserva el id y el historial.
- **Intermedios:** se emparejan por `orden`. Tiene un comentario `shortcut:` que pide emparejar por cercanía antes de re-trazar.
- Si queda un PC activo sin emparejar o hay ambigüedad, el script aborta antes de escribir.
- Si la API desplegada no devuelve `rol` (versión anterior a #154), aborta con un mensaje explícito.

## Orden de salida (obligatorio)
1. Deploy de la API con #154 y #161.
2. Dry-run de `cargar-linea-16.ts` contra prod: debe emparejar los 3 PC existentes y planear 14 POST.
3. APK con fases (#165) instalado en `1616PIL`, `1616PIB` y `1616PIC`.
4. `cargar-linea-16.ts --apply`.

Sin #161, los PC de regreso km 26/28 (a unos 185 m de los km 2/4 de ida) disparan un `pc_omitido` falso de Honduras en cada vuelta. Con el APK viejo, que no filtra por fase, hay doble detección.

## Verificación
- Tests de `scripts/lib/trazar-por-calles.test.ts`: 50/50.
- `--solo-puntos` offline: plan de 17 PC estable.
- El dry-run contra prod (15/10) abortó contra la API vieja, como se esperaba. Repetirlo después del deploy.
