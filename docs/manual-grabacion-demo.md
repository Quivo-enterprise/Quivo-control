# Manual de uso de la demo — equipo de grabación

> Para quienes graban el video «QUIVO Control» (guion V3). Todo lo que se ve es una
> **demostración simulada**: no hay trufis reales, conductores reales ni datos reales. En edición,
> las tomas del panel y de la app se rotulan «Demostración».

## 1. Qué hay y quién lo usa

| Pieza | Dónde corre | Quién la opera | Escenas |
|---|---|---|---|
| **Panel del delegado** (web) | PC (o un celular en la misma red) | Delegado en cámara + un operador | E05, E07, E08 |
| **App del conductor** (APK) | Teléfono Android | Conductor en cámara + un operador | E05, E06, E08 |

Las dos son **simulaciones separadas** que no se hablan entre sí: lo que pasa en el teléfono no
aparece en el panel ni al revés. Nunca pongas las dos en el mismo plano esperando que coincidan.

Cada una tiene un **panel de operador oculto** para disparar situaciones (infracciones, pérdida
de señal, etc.). El panel **no debe verse en cámara**: se abre, se toca la acción, se cierra y
recién entonces se graba.

## 2. Antes de llegar al set (lo hace el técnico)

- [ ] PC con el panel levantado y abierto en `http://localhost:3110/en-vivo` (ver Anexo A).
- [ ] Teléfono Android con la app **QUIVO Conductor** (demo) instalada (ver Anexo B).
- [ ] El teléfono **con wifi o datos**: el mapa de fondo se descarga de internet.
- [ ] Teléfono en **No molestar** (que no entren notificaciones de WhatsApp en plena toma),
      brillo alto, batería cargada, rotación bloqueada en vertical.
- [ ] Recorrer una vez todas las pantallas del panel (la primera carga de cada una tarda unos
      segundos).

## 3. Panel del delegado (web)

### Arranque
1. En la PC, abrir `http://localhost:3110/en-vivo` en el navegador.
2. **F11** para pantalla completa. Zoom del navegador al 100 %.
3. Arranca limpio: sin el cartel «Modo simulación» y sin el panel de operador.

### Controles que se ven en cámara
- **Filtro de línea** (arriba a la izquierda): Todas · Z12 · Línea 120.
- **Menú de vistas** (columna izquierda): Mapa · Salidas · Novedades · Análisis · Configuración.
- **Franja de números** (arriba): En ruta · En cola · Finalizados · Sin señal · Atascados · Novedades.
- **Clic en un trufi** del mapa: abre su ficha con pestañas Resumen · Recorridos · Horario ·
  Sanciones · Paradas.
- **Escape** cierra el último panel abierto.

### Panel de operador (fuera de cámara)
- Tecla **`S`**: muestra u oculta el panel de simulación.
- Si hay una ficha de trufi abierta, la acción se aplica **a ese trufi**; si no, a uno al azar.
- Secciones: Infracciones (1, 2 o 3 trufis) · Tráfico (Atasco, Desvío no autorizado, Hora pico) ·
  Salidas (Fuera de orden, Finalizar recorrido) · Conductor (Reporte del conductor) ·
  Señal (Perder señal, Recuperar señal) · Demo (Pausar, **Reiniciar demo**).
- Si algo quedó desordenado entre tomas: `S` → **Reiniciar demo** → confirmar (o recargar la página).

### Si la toma es en celular (E05 alternativa)
Abrir en el celular `http://<IP de la PC>:3110/en-vivo` (misma red wifi). Las fichas se abren
como hoja desde abajo.

## 4. App del conductor (teléfono)

### Entrar
Abrir **QUIVO Conductor**. En «Conecta tu vehículo» escribir placa y PIN:

| Placa | Línea | Conductor con PIN **111111** | Conductor con PIN **222222** |
|---|---|---|---|
| **4521BQP** | Z12 | Freddy Choque | Norma Villca |
| **6248GNS** | Línea 120 | Hugo Rocha | Ruth Mamani |

La sesión queda guardada: si se cierra la app, vuelve a entrar sola.

### Qué hay en la pantalla del mapa
- **Tarjeta de arriba** (nombre, sindicato, línea): al tocarla abre el **Perfil**.
- **Botones redondos a la derecha**, de arriba a abajo:
  - Portapapeles → **Hoja de ruta** (solo antes de iniciar; después está en Perfil).
  - Signo «!» → **Reportar**.
  - Check → información del registro automático.
  - Mira → **centrar el mapa** (toque corto). *Mantener apretado 2 segundos abre el panel del operador.*
- **Panel azul de abajo**: próximo punto de control y el botón **COMENZAR RUTA / FINALIZAR RUTA**.
- Con el recorrido iniciado aparecen las tarjetas **ADELANTE** y **ATRÁS**: foto, placa,
  distancia por la ruta y minutos (o «En cola · sale HH:MM» si el de atrás todavía no salió).

### Panel del operador (fuera de cámara)
Mantener apretado ~2 s el botón **Mira** (centrar). Opciones:
- **Perder señal / Recuperar señal**.
- **Velocidad ×1 / ×4**: ×4 hace avanzar todo más rápido (para no esperar). Volver a ×1 antes de grabar.
- **Saltar al próximo punto de control**: el trufi llega al siguiente control y suena la confirmación.
- **Acercar trufi de adelante**: la distancia de ADELANTE baja a unos cientos de metros.
- **Reiniciar demo**: todo vuelve al inicio (el trufi propio a la cola). Pide confirmación.
- **Cerrar**.

### Perfil
- **Foto**: tocar el círculo → Tomar foto / Elegir de galería (se recorta cuadrada). Si la foto
  es muy pesada, la app pide intentar de nuevo.
- **Teléfono**: tocar la fila → teclado numérico → 8 dígitos (empieza con 6 o 7) → Guardar.
- Foto y teléfono quedan guardados **por conductor**: Freddy y Norma tienen cada uno el suyo.
- **Hoja de ruta**, **Ajustes de operación** (abajo del todo: «Datos usados hoy»),
  **Cerrar Sesión**.

## 5. Tomas por escena

Siempre: **vehículo detenido** cuando alguien toca el celular (regla del guion). Un dato por plano.

### E05 — Aparece QUIVO Control
| Toma | Qué hacer |
|---|---|
| 02:04–02:18 · App abierta | Teléfono con la app en la pantalla de ingreso o el mapa. |
| 02:18–02:25 · Delegado en PC | Panel en **Mapa**, filtro **Todas**, sin tocar nada: los trufis se mueven solos. |
| 02:25–02:31 · Sindicato organiza | Panel → menú **Salidas**. |

### E06 — Una jornada con QUIVO: el conductor (teléfono)
| Toma | Qué hacer |
|---|---|
| 02:36–02:45 · Abre la app | Ingreso con **4521BQP** + **111111** → Siguiente. |
| 02:45–02:56 · Hoja de ruta, recorrido, orden de salida | Botón **portapapeles** → Turno de hoy → bajar a **Orden de salida** («Sos el 1º · salís a las …») → bajar a **Recorrido**. Volver atrás. |
| 02:56–03:04 · Activa la jornada | **COMENZAR RUTA** (un toque). Cambia a «EN LÍNEA». |
| 03:04–03:16 · Registro automático | Mostrar el trufi avanzando. Para el aviso de punto de control: operador → **Saltar al próximo punto de control**. |
| 03:16–03:25 · Delante y detrás | Encuadrar las tarjetas **ADELANTE / ATRÁS** y los trufis con foto en el mapa. Para que la distancia baje en cámara: operador → **Acercar trufi de adelante**. |
| 03:25–03:36 · Sin conexión | Operador → **Perder señal** → cerrar panel → grabar el aviso «Sin conexión · guardando recorrido» con el contador subiendo (10–15 s) → operador → **Recuperar señal** → «Sincronizando…» → «Recorrido sincronizado». |
| 03:36–03:42 · Reporta fuera de orden | Botón **«!»** → «Vehículo fuera de orden» (ya viene marcado) → elegir la placa → **ENVIAR** → «Enviado al delegado» → **LISTO**. |
| 03:42–03:48 · Cambio de conductor | Tarjeta de arriba → Perfil → **Cerrar Sesión** → confirmar → misma placa **4521BQP** con PIN **222222** → entra **Norma Villca**. |

### E07 — El delegado (panel)
| Toma | Qué hacer |
|---|---|
| 03:48–04:03 · Cuántos, dónde, puntos de control | **Mapa**: encuadrar la franja de números. Clic en un trufi → Resumen → «Puntos de control X/N». |
| 04:03–04:17 · Orden, horarios, 24 h | **Salidas**: Cola de salida → Salidas de hoy → Recorridos del día. |
| 04:17–04:32 · Desvío, fuera de orden, reporte | `S` → **Desvío no autorizado** + **Reporte del conductor** → `S`. **Novedades** → clic en la novedad → **Ver en mapa** → en la ficha, elegir acción → **Confirmar** → volver a Novedades → escribir nota → **Marcar atendida**. |
| 04:32–04:49 · Atascos, demanda, horas pico | `S` → **Atasco** + **Hora pico** → `S`. Hacer **zoom** al tramo rojo punteado. Luego **Análisis** (barras por hora, «AHORA»). |
| 04:49–05:05 · Coordinar salidas | **Salidas** → **Adelantar** un trufi de la cola → **Despachar siguiente** → ícono WhatsApp **Avisar al conductor** (**no enviar**: número ficticio). |
| 05:05–05:16 · Historial, sanciones, paradas | Ficha de un trufi: **Recorridos** → **Horario** → **Sanciones** → **Paradas** (elegir → **Asignar**). |
| 05:16–05:24 · Cierre | **Mapa**, sin paneles abiertos. |

### E08 — Pensado para la realidad de la ruta
| Toma | Qué hacer |
|---|---|
| 05:24–05:34 · Solo celular + app | Teléfono con la app en el mapa; sin ningún otro aparato a la vista. |
| 05:34–05:42 · Pocos megas | App → tarjeta de arriba → **Ajustes de operación** → bajar hasta **«Datos usados hoy»**. (Cifra simulada: rotular «Demostración».) |
| 05:42–06:01 · Sin señal y sincroniza | Igual que E06 03:25 en la app. En el panel: abrir la ficha del trufi → `S` → **Perder señal** (queda gris, «Sin señal · hace m:ss») → esperar → **Recuperar señal** (se resalta el tramo guardado). |
| 06:01–06:10 · Configuración | Panel → **Configuración** → línea → horario → parada → punto de control y radio → **Guardar cambios**. |

## 6. Problemas comunes

| Pasa esto | Hacer esto |
|---|---|
| El mapa del teléfono queda gris, sin calles | Falta internet en el teléfono: conectar wifi o datos. |
| No hay trufi «ATRÁS» en ruta (dice «En cola») | Es correcto al inicio. Para que salga: operador → Velocidad ×4 unos segundos → volver a ×1. |
| El trufi de adelante está muy lejos | Operador → **Acercar trufi de adelante**. |
| Quedó todo desordenado | Operador → **Reiniciar demo** (app) · `S` → **Reiniciar demo** (panel). |
| Entró una notificación en plena toma | Activar **No molestar** y repetir. |
| El panel web muestra el cartel «Modo simulación» o el panel del operador | Tecla `S` para ocultarlo. |
| «Las credenciales no son válidas» | Revisar placa (sin guion está bien: 4521BQP) y PIN de 6 dígitos. |

## 7. Reglas del guion que aplican a la demo
- Nadie toca el celular con el vehículo en movimiento.
- No mostrar el panel del operador ni pantallas completas ilegibles: un dato por plano, usar zoom.
- WhatsApp: los números son ficticios — **no enviar** mensajes en cámara.
- El panel nunca decide solo: siempre se ve a una persona tomando la acción.
- Todo es simulado: rotular «Demostración» en edición. La foto del trufi **2345-ABC** es de
  Wikimedia (CC BY 2.0, MollySVH): si aparece, va en créditos. Las demás son íconos genéricos.
- En el teléfono la app se llama «QUIVO Conductor» (el guion dice «QUIVO Control»): evitar
  encuadrar el ícono del lanzador o resolverlo en edición.

---

## Anexo A — Levantar el panel (técnico)
En la PC, con el repo en la rama `mockup` (detalle en `DEMO-MOCK-WEB.md`):
```
pnpm install
pnpm --filter @quivo/design-system build
cd apps/web
NEXT_PUBLIC_MOCK_FLOTA=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true NEXT_PUBLIC_MOCK_GRABACION=true \
  pnpm exec next dev --port 3110
```
No necesita API, base de datos ni usuario: entra directo.

## Anexo B — Instalar la app (técnico)
- Archivo: `quivo-conductor-demo.apk`. Se instala **al lado** de la app real (no la reemplaza).
- Pasar el archivo al teléfono y abrirlo (permitir «instalar apps desconocidas»), o con cable/
  depuración: `adb install -r quivo-conductor-demo.apk`.
- Recompilar: ver `docs/guion-grabacion-mock.md`, sección «App del conductor».
