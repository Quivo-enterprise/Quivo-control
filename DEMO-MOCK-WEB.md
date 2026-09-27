# Demo del panel web mockeado (`/en-vivo`)

Rama `mockup`. El panel del delegado corre **100 % simulado en el navegador**: no hace falta API,
base de datos ni Docker. Todo el estado vive en la pestaña y se reinicia al recargar.

## Requisitos
- Node **22** (el repo pide `>=22 <23`).
- pnpm **11.3.0**: `corepack enable && corepack prepare pnpm@11.3.0 --activate`.

## Levantar
```bash
git clone -b mockup git@github.com:Quivo-enterprise/Quivo-control.git
cd Quivo-control
pnpm install
pnpm --filter @quivo/design-system build     # el web consume el dist/ del design system

cd apps/web
NEXT_PUBLIC_MOCK_FLOTA=true \
NEXT_PUBLIC_DEV_BYPASS_AUTH=true \
NEXT_PUBLIC_MOCK_GRABACION=true \
pnpm exec next dev --port 3110
```
Abrir **http://localhost:3110/en-vivo**. La primera carga de cada vista tarda unos segundos
porque Next compila. Recorré todas las vistas una vez antes de mostrar o grabar.

| Variable | Qué hace |
|---|---|
| `NEXT_PUBLIC_MOCK_FLOTA=true` | Reemplaza la flota real por la simulada |
| `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` | Entra sin login. Solo funciona con `next dev`, porque en builds de producción está bloqueado |
| `NEXT_PUBLIC_MOCK_GRABACION=true` | Modo grabación: oculta el badge «Modo simulación» y el panel de simulación. La tecla **`S`** los muestra y oculta |

Para ver el panel desde el celular, abrí `http://<ip-de-la-pc>:3110/en-vivo` en la misma red, o
usá DevTools en modo dispositivo a 390×844.

## Entrar con usuario (opcional)
- Usuario: `admin@quivo.com`
- Contraseña: `Sy+i3Ds5A3X+QQQaegCzwfbS`

Para usar el login real, levantá el web **sin** `NEXT_PUBLIC_DEV_BYPASS_AUTH` y con
`NEXT_PUBLIC_API_URL` apuntando a una API donde exista ese usuario. La API de producción **no
acepta logins desde `localhost`**, porque su CORS solo permite el dominio del panel desplegado.
Por eso, para el mock local, lo más simple es el modo sin login de arriba.

## Funcionalidades simuladas
**Flota:** 8 trufis, 5 de la **Z12** (borde azul `#2563eb`) y 3 de la **Línea 120** (borde
blanco). Se mueven por sus rutas reales de Cochabamba. El historial del día se siembra desde las
05:00 con horas pico a las 7-9, 12-14 y 18-20.

**Mapa**
- Marcadores con la foto del trufi en un marco redondo del color de la línea.
- Parpadeo por infracción: amarillo si es leve, naranja si es media, rojo si es grave.
- Filtro de línea arriba a la izquierda: **Todas** (por defecto), **Z12** y **Línea 120**. Cambia los trufis, la ruta y todas las vistas.
- En cada terminal se ve solo el primero de la cola, con la pastilla **«+N en cola»**.
- Franja KPI: En ruta · En cola · Finalizados · Sin señal · Atascados · Novedades.
- Tramo atascado en rojo punteado y traza de desvío.
- Paradas con alta demanda: punto pulsante, con «~N esperando» al pasar el mouse.

**Ficha del trufi (clic en un marcador)**
- Pestañas: Resumen · Recorridos · Horario · Sanciones · Paradas.
- Placa, puntos de control cumplidos (X/N), y qué trufi va adelante y cuál atrás.
- Infracciones: acciones según el tipo, aplicadas ahora o con plazo de hasta 30 días.
- Asignar la siguiente parada.
- WhatsApp al conductor. Los números son ficticios, no enviar.

**Vistas (menú de la izquierda)**
- **Salidas:** cola de salida por línea con la hora programada. Botones Despachar siguiente, Adelantar/Atrasar en la cola y Avisar al conductor. Tabla «Salidas de hoy» y recorridos del día de 00 a 24 h.
- **Novedades:** bandeja de desvíos, salidas fuera de orden, reportes del conductor, atascos y trufis sin señal.
  - Revisar → Ver en mapa.
  - Marcar atendida con una nota.
  - Crear infracción o escribir por WhatsApp.
- **Análisis:** barras de movimiento por hora (hoy y típico), franjas de hora pico y la hora actual marcada «AHORA».
- **Configuración:** por línea, horario (inicio, fin, frecuencia) y paradas (nombre, punto de control, radio de tolerancia). La línea se resalta en el mapa; **Guardar cambios**.

**Panel de simulación (tecla `S`)**
Si hay una ficha abierta, el escenario se aplica a **ese** trufi; si no, a uno visible al azar.
- **Infracciones:** en 1, 2 o 3 trufis.
- **Tráfico:** Atasco, Desvío no autorizado, Hora pico (on/off).
- **Salidas:** Fuera de orden, Finalizar recorrido.
- **Conductor:** Reporte del conductor por tipo (pinchazo, control policial, bloqueo de vía, falla mecánica, incidente con pasajero).
- **Señal:**
  - **Perder señal:** el marcador se congela en gris y muestra «Sin señal · hace m:ss».
  - **Recuperar señal:** muestra «Sincronizando N puntos…», el marcador salta y el tramo guardado se resalta.
- **Demo:** Pausar/Reanudar, Reiniciar demo (con confirmación).

La lista de tomas del video, escena por escena, está en
[`docs/guion-grabacion-mock.md`](docs/guion-grabacion-mock.md).

## Notas
- **Escape** cierra de a un panel.
- En tomas densas conviene hacer zoom: a vista de ciudad, los marcadores del centro se superponen.
- La foto del trufi `z12-1` es de Wikimedia (CC BY 2.0, MollySVH). Si aparece en el video, va con crédito.
