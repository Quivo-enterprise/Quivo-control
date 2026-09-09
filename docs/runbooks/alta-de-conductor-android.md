# Runbook — alta de un conductor en su teléfono Android

> **Para quién:** la persona que entrega el APK y acompaña al conductor la primera vez.
> **Cuánto lleva:** 5 minutos si el teléfono coopera.
> **Por qué existe:** el 2026-08-18 un conductor con un Samsung Galaxy A71 inició sesión sin
> problema y **no pudo iniciar el recorrido**: la app no accedía al GPS. No fue un bug de ese
> teléfono. Desde Android 11, el permiso que la app necesita **no se puede otorgar desde un
> diálogo** — hay que ir a Ajustes a mano. Cada alta que se haga sin este runbook tiene una
> probabilidad alta de terminar igual.

## Lo que hay que entender antes de empezar

La app necesita el permiso de ubicación **"Permitir todo el tiempo"**, no "Mientras se usa la
app". Son cosas distintas y Android las trata distinto:

- **"Mientras se usa la app"** deja de grabar en cuanto el conductor bloquea la pantalla o abre
  WhatsApp. El recorrido queda con agujeros, o vacío.
- **"Permitir todo el tiempo"** es la única opción que sirve.

Y el detalle que arruina las altas: **Android nunca ofrece "Permitir todo el tiempo" en el
diálogo.** El diálogo solo ofrece "Mientras se usa la app" / "Solo esta vez" / "No permitir". La
opción que necesitamos existe únicamente en la pantalla de Ajustes del permiso.

Peor: **si el conductor toca "No permitir" dos veces, Android deja de mostrar el diálogo para
siempre.** A partir de ahí la app no puede volver a pedirlo, y la única salida es Ajustes.

## Paso a paso

### 1. Antes de instalar

- Confirmar que el **GPS del teléfono esté encendido** (Ajustes → Ubicación → activado). Es
  independiente del permiso de la app; si está apagado, no hay permiso que alcance.
- Confirmar que haya **espacio libre** y batería por encima del 30%.
- Anotar **marca, modelo y versión de Android**. Se usa para el registro del piloto y para
  reconocer patrones cuando algo falla.

### 2. Instalar el APK

Se distribuye por sideload, no por Play Store. El teléfono va a pedir permiso para instalar de
orígenes desconocidos: aceptar.

**Si ya había una versión instalada, instalar encima — nunca desinstalar.** Desinstalar o usar
"Borrar datos" destruye las dos bases locales de la app, y con ellas cualquier recorrido que
todavía no se haya sincronizado.

### 3. Iniciar sesión

Una sola pantalla: **placa del vehículo + PIN del conductor**. El PIN es personal del conductor,
no del vehículo — dos choferes que manejan la misma unidad usan cada uno el suyo.

Si el conductor tiene más de una asignación vigente, aparece una segunda pantalla ("Elige tu
turno") para confirmar cuál va a iniciar. Con una sola asignación no aparece.

Si el login falla con credenciales correctas, casi siempre es que **no hay asignación cargada
para la fecha de hoy** — no es problema del teléfono. Se resuelve desde el panel.

Tras varios intentos fallidos el vehículo queda bloqueado unos segundos, y el bloqueo crece con
cada fallo (hasta un minuto). No es una falla: es el lockout. Esperar y reintentar con el PIN
correcto.

### 4. El permiso de ubicación — el paso que falla

Al tocar "Iniciar recorrido" por primera vez, Android muestra su diálogo.

**Decirle al conductor qué tocar, antes de que toque.** El reflejo natural es "No permitir", y
esa elección es cara de revertir.

1. En el diálogo, elegir **"Mientras se usa la app"**. Sí, esa: es lo máximo que el diálogo
   ofrece.
2. La app va a explicar que falta el segundo paso y va a abrir la pantalla de Ajustes.
3. Ahí, en **Permisos → Ubicación**, elegir **"Permitir todo el tiempo"**.
4. Volver a la app.

**Si el diálogo no aparece** (porque ya se rechazó antes), ir directo a:
`Ajustes → Aplicaciones → QUIVO Conductor → Permisos → Ubicación → Permitir todo el tiempo`.

También conviene aceptar el permiso de **notificaciones** cuando lo pida: la notificación
permanente es la única señal visible de que la app está grabando.

### 5. Samsung y One UI — el asesino clásico

Samsung apaga las apps en segundo plano de forma agresiva, y lo hace en silencio. En estos
teléfonos hay que desactivarlo a mano:

- `Ajustes → Batería → Límites de uso en segundo plano → Apps en suspensión` → **sacar QUIVO de
  la lista** si está.
- `Ajustes → Aplicaciones → QUIVO Conductor → Batería` → elegir **"Sin restricciones"**.

En **Xiaomi** el equivalente está en Ajustes → Aplicaciones → Permisos → Inicio automático, más
"Ahorro de batería → Sin restricciones". En **Huawei**, en Ajustes → Batería → Inicio de apps →
gestionar manualmente.

Sin este paso el conductor arranca bien y el recorrido se corta a mitad de camino, que es más
difícil de diagnosticar que un fallo al inicio.

### 6. Verificar que quedó bien

No dar el alta por buena hasta comprobar las tres:

1. La app muestra el recorrido iniciado y una **notificación permanente** en la barra de estado.
2. Bloquear la pantalla, caminar una cuadra, volver: el recorrido **sigue activo** y el contador
   de puntos subió.
3. Confirmar desde el panel que **llegaron puntos** de ese vehículo.

El punto 3 es el único que prueba la cadena completa. Los otros dos prueban el teléfono.

## Qué anotar de cada alta

| Dato | Por qué |
|---|---|
| Marca, modelo, versión de Android | Reconocer patrones por fabricante |
| Si el permiso quedó en "Todo el tiempo" | Es la causa nº 1 de recorridos vacíos |
| Si se desactivó la restricción de batería | Causa nº 1 de recorridos cortados a mitad |
| Placa del vehículo y CI del conductor | Correlacionar con lo que llega al panel |

## Si algo falla

- **"Inicié sesión pero no puedo iniciar el recorrido"** → permiso de ubicación. Volver al paso 4.
- **"Arrancó y a la media hora dejó de grabar"** → restricción de batería. Paso 5.
- **"No aparece la notificación"** → permiso de notificaciones denegado. Ajustes → Aplicaciones →
  QUIVO Conductor → Notificaciones.
- **"Dice que no hay recorrido asignado para hoy"** → no es el teléfono. Revisar la asignación en
  el panel.

Lo que **nunca** hay que hacer para "resolver" un problema: desinstalar la app o borrar sus datos
con recorridos sin sincronizar. Eso destruye evidencia que no se puede recuperar.
