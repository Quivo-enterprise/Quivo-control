# QUIVO Conductor — contexto visual y funcional para concept art

> Documento de contexto para diseñadores, herramientas generativas y dirección de arte.
> Fuente: implementación real de `apps/mobile` al 3 de agosto de 2026.
> Plataforma canónica: Android, orientación vertical, app operativa para conductores de transporte público urbano.

## 1. Idea central

QUIVO Conductor es la aplicación que acompaña al chofer durante su jornada. Primero confirma el vehículo y la identidad personal; después carga la asignación vigente y transforma el teléfono en una consola de recorrido: mapa, línea, ruta, puntos de control, GPS, novedades y sincronización.

La experiencia debe sentirse:

- confiable y directa, apta para usar en movimiento y bajo luz exterior;
- tecnológica, pero cercana al transporte urbano boliviano;
- operativa, no administrativa;
- segura, sin parecer una app bancaria;
- clara en teléfonos Android de gama baja;
- funcional aunque la conexión sea inestable.

Frase conceptual: **“La jornada completa, conectada a la ruta.”**

## 2. Qué es canon y qué puede explorar el concept art

### Canon de producto

- Nombre visible: **QUIVO Conductor**.
- Marca dentro de la app: **QUIVO CONTROL**.
- Android vertical; no existe versión iOS en el alcance actual.
- Autenticación encadenada: vehículo y luego chofer.
- Contexto de transporte sindicalizado: conductor, vehículo, sindicato, línea, ruta, turno y asignación.
- Pantalla operativa dominada por un mapa real.
- GPS en primer y segundo plano.
- Registro de puntos de control y novedades.
- Operación offline con eventos pendientes que se sincronizan al reconectar.
- Interfaz clara; no hay modo oscuro implementado.

### Exploración permitida para concept art

- Mostrar el teléfono dentro de una cabina de bus urbano o sobre un soporte de tablero.
- Usar una ciudad andina/boliviana contemporánea como contexto ambiental.
- Representar movimiento mediante luces urbanas, trazos de ruta o profundidad, sin ensuciar la UI.
- Mostrar un conjunto de pantallas o una pantalla hero con detalles ampliados.
- Elevar ligeramente el acabado del cristal, sombras y mapa, conservando los tokens QUIVO.

No presentar una exploración como función existente.

## 3. Persona y situación de uso

**Usuario principal:** conductor de bus, minibús o vehículo de transporte urbano afiliado a un sindicato.

**Entorno:** cabina del vehículo, vibración, ruido, luz solar, uso rápido con una mano, conectividad móvil intermitente y dispositivo Android económico.

**Objetivos del conductor:**

1. Entrar a la jornada correcta sin confundir vehículo, chofer o turno.
2. Ver la ruta y su posición de un vistazo.
3. Iniciar y finalizar el recorrido con seguridad.
4. Saber cuál es el siguiente punto de control y cuánto avanzó.
5. Registrar un desvío, bloqueo o incidente sin abandonar el recorrido.
6. Continuar trabajando sin red y saber qué queda pendiente.

## 4. ADN visual QUIVO

QUIVO combina una base violeta tecnológica con un acento naranja enérgico. Las superficies son blancas o gris-lila muy claro, los títulos tienen una geometría distintiva y la información operativa usa jerarquías cortas y contundentes.

### Paleta oficial

| Token | Valor | Uso visual |
| --- | --- | --- |
| Primario | `#3226B4` | Botones principales, avatar, iconos activos, ubicación |
| Primario fuerte | `#3123C7` | Barra de sistema y pantalla de carga |
| Primario suave | `#DCD9FB` | Bordes y estados secundarios |
| Primario sutil | `#EFEEFC` | Fondos de navegación, progreso y selección |
| Acento | `#FD9E15` | Marca Q, progreso, siguiente control, spinner |
| Acento fuerte | `#E0880A` | Texto de advertencia no crítica |
| Acento suave | `#FFEFD9` | Fondo de pendientes y avisos offline |
| Fondo de página | `#F1F1F8` | Pantallas de acceso y fallback |
| Tarjeta | `#FFFFFF` | Formularios, botones secundarios y navegación |
| Texto principal | `#1A1A2E` | Títulos y contenido prioritario |
| Texto secundario | `#4B4B6B` | Descripciones y metadatos |
| Texto tenue | `#9191B0` | Ayuda, placeholders e iconos inactivos |
| Borde | `#D9D9E8` | Inputs y tarjetas |
| Éxito | `#16805D` | GPS activo, confirmaciones y estado sincronizado |
| Éxito suave | `#DDF4EA` | Pills y mensajes positivos |
| Peligro | `#C53B4A` | Finalizar, errores y acciones destructivas |
| Peligro suave | `#FBE5E8` | Fondos de error |

Las líneas de transporte tienen un color dinámico propio. En los datos de demostración, la línea L1 usa `#5B4DFF`.

### Tipografía

| Familia | Rol |
| --- | --- |
| **Oxanium** | Marca, títulos grandes, códigos de línea, etiquetas operativas y números destacados |
| **Montserrat** | Texto de interfaz, formularios, botones, nombres y descripciones |
| **JetBrains Mono** | Información técnica cuando sea necesaria; está disponible, pero no domina las pantallas actuales |

Jerarquía de referencia:

- título principal: Oxanium Bold, 30/37;
- estado de ruta: Oxanium Bold, 22;
- título de hoja: Montserrat SemiBold, 18;
- cuerpo: Montserrat Regular, 12–14;
- microetiqueta en mayúsculas: Oxanium Bold, 8–11, con tracking amplio;
- botón: Montserrat SemiBold, 15.

### Forma, espacio y material

- Escala espacial: 4, 8, 12, 16, 24, 32 y 48 dp.
- Radios: 4, 8, 12, 16 y 24 dp; pills completamente redondas.
- Objetivos táctiles: 48 dp o más; botones principales de al menos 52 dp.
- Tarjetas normales: blanco, borde lila-gris de 1 dp, radio 16, sombra suave.
- Elementos sobre mapa: vidrio blanco al 76–90 %, blur claro, borde blanco translúcido y sombra más marcada.
- La hoja de control compacta tiene radio 24 y flota a 8 dp de los bordes.
- El naranja se usa como acento, no como fondo dominante.
- El vidrio se reserva para contenido sobre mapa o imagen; no cubrir toda la app con glassmorphism.

### Marca e iconografía

- Marca compacta actual: cuadrado naranja de 38 × 38 dp, radio 12, con una **Q** oscura en Oxanium Bold.
- Junto a la marca aparece `QUIVO CONTROL` en violeta y mayúsculas.
- Una línea naranja de 4 dp separa la barra superior del contenido.
- Iconos lineales, extremos redondeados, trazo violeta o gris: ruta, alerta triangular, usuario, volver y ubicación.
- No existe un asset de logotipo, icono de aplicación o splash ilustrado dentro del módulo actual; la Q tipográfica es la referencia implementada.

## 5. Arquitectura de experiencia

```text
Preparación de recursos
└── Restauración de jornada
    ├── Sin sesión → Validar vehículo
    │   └── Identificar chofer
    │       ├── Una asignación → Operación
    │       └── Varias asignaciones → Elegir turno → Operación
    └── Sesión local vigente → Operación + reconciliación online
```

La pantalla de operación se divide en dos capas:

```text
Mapa a pantalla completa
├── Tarjeta de identidad y línea, flotante arriba
├── Avisos temporales debajo de la tarjeta
├── Ruta, paradas, controles, ubicación y botón de recentrado
└── Hoja de control flotante abajo
    ├── Vista compacta
    └── Vista expandida
        ├── Ruta
        ├── Novedad
        └── Perfil
```

## 6. Pantallas y objetos visuales

### A. Preparación / restauración

Composición:

- fondo violeta fuerte completo;
- spinner naranja grande;
- palabra `QUIVO` blanca, Oxanium Bold, tracking amplio;
- mensaje breve en lila suave: `Preparando QUIVO…`, `Recuperando tu jornada…` o `Preparando tu contexto operativo…`;
- si fallan los recursos, se quita el spinner y el mensaje cambia a naranja suave.

Sensación: arranque sólido, técnico y sereno. No usar ilustraciones recargadas.

### B. Conecta tu vehículo — paso 1 de 2

Objetos, de arriba hacia abajo:

1. Marca Q naranja + `QUIVO CONTROL`.
2. Título `Conecta tu vehículo`.
3. Subtítulo sobre la credencial entregada por el sindicato.
4. Indicador horizontal `1 Vehículo — 2 Chofer`; paso 1 violeta activo.
5. Tarjeta blanca de formulario.
6. Campo `Placa del vehículo`, ejemplo `1234-ABC`.
7. Campo seguro `PIN del vehículo`, entre 6 y 12 dígitos.
8. Ayuda: el PIN identifica al vehículo, no al chofer.
9. Error inline, cuando corresponda.
10. Botón violeta `Validar vehículo`.
11. Pie centrado `ACCESO OPERATIVO SEGURO` y una explicación corta.

Fondo gris-lila claro, margen general de 24 dp y separaciones amplias. Teclado y scroll son parte del comportamiento, pero no deben dominar el concept art.

### C. Identifícate como chofer — paso 2 de 2

Objetos:

1. Mismo encabezado de marca.
2. Título `Identifícate como chofer`.
3. Subtítulo sobre la asignación activa.
4. Indicador con ambos pasos activos.
5. Pill verde suave `VEHÍCULO VALIDADO · 1001ABC`.
6. Tarjeta blanca.
7. Campo `CI boliviano`, con complemento y expedición opcionales.
8. Campo seguro `PIN personal`.
9. Validación o error del documento.
10. Botón violeta `Ingresar a mi jornada`.
11. Botón blanco con borde violeta suave `Cambiar vehículo`.

El pill verde debe comunicar continuidad y confianza, no una celebración exagerada.

### D. Elige tu turno — bifurcación opcional

Esta pantalla aparece únicamente si existen varias asignaciones válidas.

Objetos:

- encabezado QUIVO;
- título `Elige tu turno` y explicación;
- lista vertical de tarjetas;
- por tarjeta: `TURNO MAÑANA/TARDE/NOCHE`, código y nombre de línea, sentido de ruta y botón `Seleccionar turno`;
- error general si la selección falla;
- botón secundario `Volver a comenzar`.

La tarjeta debe hacer evidente que el turno es una asignación operacional, no una reserva de viaje del pasajero.

### E. Operación sobre mapa — vista hero

Es la imagen principal recomendada para el concept art.

#### Capa de mapa

- mapa Leaflet/OpenStreetMap sin controles estándar visibles;
- polyline de la ruta con el color dinámico de la línea, grosor 4;
- marcadores de origen, destino y paradas;
- puntos de control circulares de 8 px:
  - siguiente punto en naranja `#FD9E15`;
  - demás puntos en gris `#9191B0`;
- ubicación actual: círculo violeta de 9 px con aro blanco de 3 px;
- botón flotante blanco de recentrado, circular, 48 × 48, violeta y con sombra;
- al iniciar GPS, el mapa sigue la ubicación con zoom cercano; al detenerlo, encuadra la ruta completa.

#### Tarjeta superior de identidad

Superficie de vidrio blanco, radio 16, altura mínima 72:

- avatar circular violeta de 48 con iniciales blancas;
- nombre del conductor;
- placa, marca y modelo del vehículo;
- a la derecha, código grande de línea en Oxanium;
- debajo del código: `GPS ACTIVO` verde o `EN ESPERA`.

Ejemplo visual no sensible:

```text
[CM] Carlos Mamani                 L1
     1001ABC · Mercedes-Benz       GPS ACTIVO
     OF-1721
```

#### Avisos flotantes

- offline o pendientes: naranja fuerte sobre naranja suave;
- asignación vencida o error de paquete: rojo sobre rojo suave;
- control cumplido: pill verde suave `Punto de control registrado`;
- todos aparecen debajo de la tarjeta superior y no bloquean el mapa completo.

#### Hoja de control compacta

Panel de vidrio fuerte, casi blanco, flotante en la parte inferior:

1. Franja de acciones rápidas con tres celdas blancas:
   - icono ruta + `RUTA` en violeta;
   - alerta + `NOVEDAD` en rojo;
   - usuario + `PERFIL` en violeta.
2. Microetiqueta `LISTO PARA SALIR` o `RECORRIDO EN CURSO`.
3. Título: turno de la línea, próximo control o ruta completada.
4. Pill de sync: verde `Sin pendientes` o naranja `N pendiente(s)`.
5. Barra de progreso de 5 dp: fondo lila sutil y avance naranja.
6. CTA violeta `Iniciar recorrido` o CTA rojo `Finalizar recorrido`.
7. Error GPS corto, si existe.

La hoja debe dejar suficiente mapa visible y priorizar una acción principal inequívoca.

### F. Hoja expandida — Ruta

Al abrir una acción, la hoja ocupa todo el espacio operativo con fondo blanco:

- encabezado de 72 dp con botón circular `volver al mapa`;
- kicker `RECORRIDO`;
- título `Opciones de jornada`;
- contenido con scroll;
- navegación inferior fija: Ruta, Novedad y Perfil;
- tab activa sobre fondo lila muy claro.

Contenido de Ruta:

- `Estado de la ruta` y pill de sincronización;
- próximo control o estado completado;
- barra de progreso;
- resumen `X de Y controles · Z puntos GPS`;
- filas de información: Ruta, Sentido y Turno;
- botón Iniciar/Finalizar;
- errores GPS y sync.

### G. Hoja expandida — Novedad

Objetos:

- título `Reportar una novedad`;
- descripción: desvíos, bloqueos o incidentes;
- textarea alto con ejemplo `desvío por corte de calle`;
- botón `Guardar novedad`;
- confirmación verde `Novedad guardada en el dispositivo`;
- navegación inferior persistente.

La confirmación habla del dispositivo porque la app puede estar offline. No representar una nube “enviado” si todavía está pendiente.

### H. Hoja expandida — Perfil

Objetos:

- título `Conductor y vehículo`;
- filas clave/valor para conductor, documento, vehículo y sindicato;
- botón secundario `Cerrar sesión`;
- el botón queda bloqueado mientras el GPS está activo;
- navegación inferior persistente.

### I. Confirmación de finalizar

Diálogo nativo con:

- título `¿Finalizar el recorrido?`;
- explicación de que el GPS dejará de registrar;
- opción neutral `Seguir recorriendo`;
- opción destructiva `Finalizar`.

Debe sentirse deliberado: detener el tracking no puede ocurrir por un toque accidental.

### J. Fallback del mapa

Si el mapa falla, el resto de la operación permanece disponible. Mostrar un bloque lila claro con el mensaje: `No se pudo cargar el mapa. El recorrido y la sincronización funcionan igual.`

## 7. Inventario completo de componentes UI

| Objeto | Variantes o estados | Participación |
| --- | --- | --- |
| Safe area Android | top y bottom | Protege contenido del sistema |
| Status bar | clara sobre violeta fuerte | Chrome de la app |
| Límite naranja | franja de 4 dp | Firma visual superior |
| Loading screen | carga, restauración, error visual | Arranque y transiciones |
| QuivoHeader | eyebrow, título, subtítulo | Acceso y selección |
| Marca Q | cuadrado naranja | Identidad compacta |
| Step indicator | paso 1, paso 2 | Vehículo → chofer |
| QuivoCard | tarjeta blanca elevada | Formularios y asignaciones |
| QuivoTextField | normal, ayuda, error, seguro | Placa, CI y PINes |
| QuivoButton | primario, secundario, peligro, loading, disabled, pressed | Acciones principales |
| Vehicle pill | éxito | Confirma vehículo validado |
| Assignment card | mañana, tarde, noche | Selección opcional |
| Route map | carga, listo, siguiendo, fallback | Base de operación |
| Route polyline | color por línea | Recorrido asignado |
| Stop marker | origen, destino, intermedia | Referencia de ruta |
| Control marker | próximo, restante | Cumplimiento operativo |
| Current position | esperando, seguimiento | Ubicación del vehículo |
| Recenter button | sin posición, con posición | Recupera seguimiento |
| QuivoGlassCard | blur ajustable | Identidad sobre mapa |
| Avatar de iniciales | dos letras | Conductor sin fotografía |
| Route badge | código + GPS activo/espera | Línea y tracking |
| Notice | offline/aviso, peligro, éxito | Feedback no bloqueante |
| TripControlSheet | compacta, expandida | Consola de jornada |
| QuickAction | ruta, novedad, perfil | Acceso desde mapa |
| Sync pill | sin pendientes, N pendientes | Estado offline/sync |
| Progress bar | 0–100 % | Controles completados |
| Expanded header | back + título | Contexto de hoja completa |
| Bottom navigation | ruta, novedad, perfil; activa/inactiva | Navegación operativa |
| InfoRow | etiqueta + valor | Resumen contextual |
| Observation textarea | vacío, escrito, enviando | Novedades |
| Confirmation dialog | cancelar, destructivo | Finalización segura |

## 8. Objetos de dominio y relación

```text
Sindicato
├── Conductor
├── Vehículo
└── Línea
    └── Ruta
        ├── Geometría
        ├── Paradas
        └── Puntos de control

Asignación = conductor + vehículo + ruta + fecha + turno + vencimiento
└── Sesión operativa = asignación + dispositivo + tokens + estado
    ├── Paquete del día
    ├── Recorrido GPS
    ├── Cumplimientos de control
    ├── Observaciones
    └── Eventos de inicio y fin
```

| Objeto | Datos esenciales | Manifestación visual |
| --- | --- | --- |
| Sindicato | id, nombre | Perfil y pertenencia operacional |
| Conductor | id, nombre, CI | Login, avatar, tarjeta y perfil |
| Vehículo | id, placa, tipo, marca, modelo | Login, pill, tarjeta y perfil |
| Línea | id, código, nombre, color | Badge, tarjeta de turno, mapa y ruta |
| Ruta | id, sentido, geometría | Mapa, resumen y filas de información |
| Parada | id, tipo, orden, coordenada | Marcador de origen/destino/intermedia |
| Punto de control | id, orden, coordenada, radio, obligatorio | Marcador, próximo control y progreso |
| Asignación | id, fecha, turno, vencimiento | Selección y habilitación del recorrido |
| Sesión operativa | sesión, contexto, dispositivo | Jornada restaurable y segura |
| Dispositivo | deviceId estable | Liga desafío, sesión y eventos; no se muestra |
| Desafío de vehículo | token corto y vencimiento | Transición vehículo → chofer; nunca se muestra |
| Paquete del día | asignación, ruta, línea, paradas, controles | Permite operar incluso sin red |
| Posición actual | latitud y longitud | Marcador violeta en el mapa |
| Punto GPS | posición, precisión, velocidad | Contador y evidencia del recorrido |
| Cumplimiento | control, posición, distancia, origen app | Progreso y confirmación verde |
| Observación | sesión y texto | Tab Novedad y confirmación local |
| Evento de recorrido | inicio o fin | Cambia tracking y CTA |
| Evento outbox | id, dispositivo, fecha, tipo, payload, estado | Se resume en el pill de pendientes |
| Lote de sync | hasta 500 eventos | Proceso automático; no requiere pantalla propia |
| Access/refresh tokens | secretos y expiraciones | Sesión restaurable; nunca se muestran |
| Métricas de batería/huecos | muestras y tiempos | Diagnóstico interno; no son parte de la UI principal |

## 9. Estados operativos que el arte debe contemplar

| Estado | Señal visual principal |
| --- | --- |
| Preparando | fondo violeta + spinner naranja |
| Sin sesión | login de vehículo |
| Vehículo confirmado | pill verde y paso 2 activo |
| Varias asignaciones | lista de turnos |
| Listo para salir | mapa encuadrado + CTA violeta |
| Recorrido activo | `GPS ACTIVO`, seguimiento cercano y CTA rojo |
| Próximo control | marcador naranja + número de control |
| Control registrado | confirmación verde + progreso incrementado |
| Ruta completada | título de completado + progreso 100 % |
| Offline | aviso naranja, funcionalidad conservada |
| Eventos pendientes | pill naranja con cantidad |
| Sin pendientes | pill verde |
| Asignación vencida | aviso rojo y CTA de inicio bloqueado |
| GPS con error | texto rojo corto, mapa y contexto visibles |
| Mapa con error | fallback lila; controles operativos disponibles |
| Finalización solicitada | diálogo de confirmación destructiva |

## 10. Comportamiento offline como parte del concepto

El offline no es un error terminal. Una sesión iniciada conserva su contexto y el paquete del día. Cada ubicación, cumplimiento, observación, inicio o fin se guarda primero en SQLite como evento local. Los eventos pasan por los estados `pendiente`, `enviado` y `acusado`; la UI simplifica todo esto a una cantidad de pendientes.

Los secretos de sesión viven en almacenamiento seguro, separados de los eventos. Al reconectar, la app renueva la sesión si hace falta y sincroniza automáticamente, sin exigir que el conductor gestione lotes ni reintentos.

Visualmente: **offline significa naranja y continuidad; rojo se reserva para bloqueos reales o riesgo de pérdida de operación.**

## 11. Composición recomendada para una lámina de concept art

Formato sugerido: lámina horizontal 16:9 o vertical editorial, con dispositivos Android en proporción aproximada 9:20.

- Centro: pantalla hero de recorrido activo sobre mapa, a mayor escala.
- Izquierda: vehículo y chofer, mostrando el acceso en dos pasos.
- Derecha: hoja expandida Ruta y Novedad.
- Detalles flotantes: muestra de paleta, marcador de siguiente control, avatar, pill de sync y barra de progreso.
- Contexto ambiental opcional: interior sobrio de bus urbano, luz de mañana andina, ciudad desenfocada fuera del parabrisas.
- Mantener la interfaz frontal y legible; el ambiente apoya, no compite.

Para una sola pantalla, elegir **Operación sobre mapa — recorrido activo**.

## 12. Prompt maestro para generar el concept art

```text
Diseña una lámina de concept art de alta fidelidad para “QUIVO Conductor”, una aplicación
Android vertical destinada a choferes de transporte público urbano sindicalizado en Bolivia.
La pantalla hero muestra un recorrido activo sobre un mapa urbano limpio de OpenStreetMap:
una ruta violeta dinámica, paradas, puntos de control grises, el próximo control naranja y
la ubicación actual como un círculo violeta con aro blanco. Sobre el mapa flota una tarjeta
de vidrio blanco con avatar de iniciales, nombre del conductor, placa y modelo del bus,
código grande de línea “L1” y estado verde “GPS ACTIVO”. Abajo flota una hoja de control
blanca translúcida con tres accesos lineales —Ruta, Novedad, Perfil—, texto “RECORRIDO EN
CURSO”, “Próximo control · #4”, un pill verde “Sin pendientes”, barra de progreso naranja y
botón rojo “Finalizar recorrido”.

Incluye pantallas secundarias más pequeñas: “Conecta tu vehículo”, “Identifícate como
chofer” y una hoja expandida con estado de ruta. Usa estrictamente la identidad QUIVO:
violeta #3226B4, violeta fuerte #3123C7, naranja #FD9E15, fondo #F1F1F8, blanco, texto
#1A1A2E, éxito #16805D y peligro #C53B4A. Títulos geométricos estilo Oxanium, cuerpo
Montserrat, iconografía lineal redondeada, tarjetas de radio 16–24 px, sombras suaves y
glassmorphism reservado a overlays del mapa. Diseño accesible, táctil, confiable, moderno,
sobrio y apto para luz exterior y teléfonos Android de gama baja. Presentación profesional
de producto, UI frontal nítida, grilla consistente y amplio espacio respirable. Como ambiente
secundario, una cabina contemporánea de bus urbano boliviano con luz de mañana andina y la
ciudad desenfocada, sin tapar la interfaz.
```

### Prompt negativo

```text
No iPhone, no iOS notch como protagonista, no modo oscuro, no estética fintech, no delivery,
no taxi ni ride-hailing, no pagos, no boletos de pasajero, no QR, no wallet, no e-commerce,
no dashboards administrativos, no gráficas complejas, no fotografías de perfil, no cámara,
no gradientes neón, no exceso de glassmorphism, no naranja dominante, no interfaz futurista
ilegible, no controles diminutos, no mapa saturado, no funciones no descritas.
```

## 13. Reglas para mantener fidelidad

1. El mapa es el protagonista durante la jornada; no sustituirlo por una ilustración abstracta.
2. El código de línea debe ser más visible que el nombre largo.
3. El inicio usa violeta; la finalización usa rojo y confirmación.
4. El próximo control es naranja; los restantes son grises.
5. La posición actual siempre es violeta con aro blanco.
6. El progreso de controles es naranja sobre lila claro.
7. Verde significa confirmado, GPS activo o sin pendientes.
8. Naranja suave significa offline, aviso o eventos pendientes.
9. No mostrar PINes, tokens, hashes, deviceId ni credenciales reales.
10. No convertir al conductor en pasajero: esta es una herramienta de operación.
11. No añadir pagos, venta de pasajes, chat, multimedia o analítica como si ya existieran.
12. Si una IA visual deforma textos largos, conservar solo textos cortos clave y componer la tipografía final posteriormente.

## 14. Fuentes de verdad dentro del repositorio

- Tema: `apps/mobile/src/shared/theme/quivo-theme.ts`
- Flujo principal: `apps/mobile/App.tsx`
- Acceso: `apps/mobile/src/features/auth/`
- Operación y mapa: `apps/mobile/src/features/operacion/`
- Componentes nativos QUIVO: `apps/mobile/src/shared/components/`
- Contexto de autenticación: `packages/shared/src/auth/mobile.ts`
- Paquete offline: `packages/shared/src/sync/paquete-dia.ts`
- Eventos y sincronización: `packages/shared/src/sync/evento.ts`
- Configuración Android: `apps/mobile/app.json`
