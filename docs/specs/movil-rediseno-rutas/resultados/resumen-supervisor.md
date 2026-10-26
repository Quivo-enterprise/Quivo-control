# Resumen del supervisor — noche del 26-oct-2026

Rama `feat/mobile-rediseno-rutas` (sale de `main` en `53b1731`). Nada subido a GitHub ni publicado.

## Commits
| Commit | Qué |
|---|---|
| `b6fd19e` | Paso 0: `packages/design-system-native` dentro del repo, fuentes, puente de tokens, `quivoBubble`, specs |
| `8a305ab` | Design system: fuentes de marca en Android (`fontStyle`) y placeholder legible |
| `e9f655a` | codex-trabajo2 · it. 1: Button, Input, Card, diálogo único, login, splash, asignación |
| `b2e2e6c` | codex-trabajo1 · it. 1: primitivas de burbuja, cabecera por estado, hoja compacta, acciones del mapa |
| `7d2dc7b` | Correcciones para la iteración 2 |
| `9428847` | codex-trabajo2 · it. 2: Perfil, Ajustes, foto del vehículo, regreso en la cabecera |
| `6a23cbe` | codex-trabajo1 · it. 2: toast, banner, designación, Reportar con motivos rápidos, fila, vecinos con proximidad |

Cada commit: typecheck sin errores, tests 87/87 (1079), lint sin errores (las advertencias ya existían).

## Lo que corregí yo (los Codex lo hicieron mal)
- **Fuentes:** todo el design system salía en Roboto en Android. Agregué `fontStyle(kind, weight)` en la copia local
  y `Montserrat_700Bold` en la app. **Hay que llevarlo a `Quivo-UI-UX`** (anotado en `packages/design-system-native/README.md`).
- **Token `textMuted`:** en tema claro es `#1a1a1a`, casi negro. El placeholder del login parecía un valor escrito.
  Pasé los placeholders a `textTertiary`. El token del original también hay que revisarlo.
- **Formato:** los dos Codex (esfuerzo `low`) entregaron código compactado en líneas de 200+ caracteres; lo pasé por
  Prettier y les puse la regla.
- **Botón cargando:** mostraba "…" en vez del spinner.
- **Perfil:** había perdido el ajuste "Texto grande"; lo volví a conectar.
- **Metro:** se caía por los `.lock` de `.claude-flow/` (plugin ruflo); quedó excluido en `metro.config.js`.

## Lo que se vio en el Motorola
- Login: fondo y logo aprobados intactos, Oxanium/Montserrat, placeholder gris, "Ingresar" único. ✔
- **Mapa y pantallas internas: no se pudieron ver.** La build `.piloto` del teléfono no trae la API key de
  Google Maps y se cierra al entrar al mapa (`IllegalStateException: API key not found`). No es del rediseño.
  Hace falta recompilar el nativo con `GOOGLE_MAPS_ANDROID_API_KEY`. El teléfono quedó con la sesión de prueba
  (`1001ABC`) iniciada, así que al abrir la app va directo al mapa y se cierra hasta esa recompilación.
- `apps/mobile/.env` apunta a un túnel de ngrok que está caído (404). Para probar usé un `.env.local` temporal
  con `http://192.168.1.17:3001` y ya lo borré.

## Para que decidas
1. **El PIN del login se ve en claro** (no tiene `secureTextEntry`). Ya era así antes del rediseño; no lo cambié.
2. **Nombre de la parada:** el paquete del día no lo trae; la hoja muestra "Punto de control N". Para el
   "Siguiente parada: Cruce Taquiña" de la propuesta hay que agregar el nombre al contrato (backend).
3. **"Sales detrás de PLACA":** `use-fila-salida` no expone la placa de adelante ni la de atrás (backend).
4. **Solapes en ruta sin verificar:** vecinos, toast, banner y aviso de designación se apilan por cálculo; con
   todos a la vez puede haber superposición. Hay que verlo en el teléfono con la API key.
5. El toast de "Punto N registrado" ya no se cierra con un toque, pero tampoco tapa la pantalla (antes era un
   modal a pantalla completa). Si lo quieres tocable, es un cambio chico.
6. Lo que pidieron tus compañeros y no entra sin backend sigue en `ux-propuestas-equipo.md` (WhatsApp, hoja de
   ruta, calendario, grupo, autocontrol, sanciones, pausa con motivo).

## Estado del entorno
- Tus cambios sin commit (metro fijado, `@expo/config-plugins`, plugin de red) siguen sin tocar.
- Metro detenido. La suspensión del equipo quedó bloqueada por 12 h (`systemd-inhibit`, "Claude supervisor").
