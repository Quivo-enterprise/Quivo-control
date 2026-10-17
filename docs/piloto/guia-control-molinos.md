# Guía para el control — designar a Molinos (línea 16)

Desde el deploy `r18-20261017`. La designación se hace **solo desde el panel web**; la app del chofer únicamente
recibe el aviso.

## Dónde está
1. Panel web → **En vivo** (`/en-vivo`).
2. Seleccioná el vehículo (tocando su marcador en el mapa, o con "Siguiente alerta").
3. En el panel del vehículo, sección **"VUELTA N DE HOY"**: dos botones, **Directo | Vía Molinos**.
4. **Vía Molinos** designa; volver a **Directo** cancela.

Pueden designar: `operador` (control), `admin_sindicato` y `admin_quivo`. La sección solo aparece en rutas con una
variante con punto de espera (hoy, "Vía Molinos" de la línea 16).

## Cuándo se puede
- El chofer tiene la app con el **recorrido iniciado** (sesión activa, mandando GPS).
- El vehículo tiene una **vuelta en curso**: se abre al pasar por la terminal (Salomón Romero) con el recorrido
  iniciado. Antes de eso los botones están deshabilitados: "Todavía no pasó por la terminal."
- Desde ahí, **en cualquier momento**: en la ida, en Honduras o en el regreso.
- Por defecto toda vuelta arranca en **Directo**. Excepción: si en la vuelta anterior se lo designó tarde (ver abajo),
  la vuelta siguiente arranca ya en **Vía Molinos**.

## Qué pasa en cada caso

| Situación | Qué muestra o hace |
|---|---|
| Designación normal | El panel muestra "Avisado HH:MM · esperando que el chofer lo vea…" y el chofer recibe el aviso. |
| Ya pasó km 26 de regreso (la bifurcación) | Se acepta **para la próxima vuelta**: "Va a Molinos en la próxima vuelta." con botón Cancelar. El chofer recibe el aviso al arrancar esa vuelta. |
| Ya llegó a Molinos en esta vuelta | "Ya llegó a Molinos: la designación quedó cerrada." |
| Ya fue a Molinos hoy (en otra vuelta) | "Ya fue a Molinos hoy." — bloqueado. Límite: 1 vez por día. |
| Se lo designó antes y no subió | Se lo puede volver a mandar; vuelve a salir "Sugerido". |

## Límites conocidos
- Si el GPS no registra la llegada a Molinos, el sistema no cuenta que fue y permite mandarlo otra vez.
- Si el GPS no registra el paso por km 26, la designación tardía se detecta recién en km 28 (~2 km después); en ese
  tramo una designación cae en la vuelta actual y termina marcada como Molinos omitido.
