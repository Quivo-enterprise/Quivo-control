# Vecinos: solo la placa, el micro con su color y su perfil en un modal

Lee `README.md` y `pantallas/reglas-burbujas.md`. Ajusta las filas Delante/Detrás de la barra en ruta (2b) y
agrega un modal. **Decisiones del responsable.**

## Filas Delante / Detrás (`vecinos-ruta-card.tsx`, `FilaEnLinea`)
- Mostrar **solo lo esencial**:
  - el **micro brandeado con su color**: la `SiluetaVehiculo` más grande (56×32), pintada con `color` y
    `colorSecundario` del vecino (`colorVehiculoAHex` / `colorSecundarioAHex` de `color-vehiculo.ts`) y la
    variante según `tipo` (`silueta-vehiculo-variante.ts`), como ya prevé el componente;
  - la **placa**, protagonista, en Oxanium 700 de 20.
- Se quitan la etiqueta `DELANTE` / `DETRÁS`, el número interno y el "hace N min". La dirección ya la dan la
  posición de la fila y la flecha ˄ / ˅ de la derecha, que el responsable agregó y **se conserva** (está sin
  commit en `vecinos-ruta-card.tsx`; trabaja sobre ella).
- La **distancia se mantiene**, a la derecha, porque lleva el semáforo del #274 (verde, amarillo y rojo en
  Delante). Va en Text sm `tabular-nums`, más chica que la placa.
- Dato viejo: queda solo el punto `warning` en la esquina, sin texto.
- **Nadie / sin dato**: la silueta punteada `textTertiary` y `—` en lugar de la placa. La fila no se esconde.
- La fila con vecino es **tocable** (`accessibilityRole="button"`,
  `accessibilityLabel="Vehículo de adelante, placa 1234ABC, a 420 metros. Ver perfil"`) y abre el modal.
  Sin vecino no es tocable.

## Modal "perfil del vehículo" (nuevo, `vecinos-ruta/vecino-perfil-modal.tsx`)
Es como la tarjeta de vehículo de Perfil, pero en un modal más chico. **Por ahora sin funcionalidad**: no
pide nada al servidor y muestra lo que ya trae el dato del vecino.
- Usa el esqueleto de `QuivoConfirmDialog` (velo `quivoBubble.scrim`, tarjeta-burbuja de radio 30). Si
  acepta `children`, úsalo; si no, copia el esqueleto.
- **Contenido**, de arriba hacia abajo:
  1. el recuadro 16:9 en `surfaceSoft` con la `SiluetaVehiculo` grande, pintada con su color, en lugar de la foto;
  2. la placa como chapa (`shared/components/placa-chapa.tsx`) y, al lado, `Delante · 420 m` o
     `Detrás · 1,2 km` (con el semáforo en la distancia de Delante);
  3. `Toyota Hiace · blanco` (marca, modelo y color; si viene `numeroInterno`, `· Interno 12`);
  4. una burbuja interior en `primarySubtle` con el icono `time-outline`, el título `Próximamente` y el texto
     `Aquí vas a ver la foto del vehículo y los datos del conductor.`;
  5. el botón `Cerrar` (outline, ancho completo, 52).
- Si mientras está abierto el vecino cambia o desaparece, el modal sigue mostrando la placa con la que se
  abrió (guarda una copia al abrir) y la distancia se actualiza solo si es la misma placa.

## Archivos
- `vecinos-ruta-card.tsx` (filas), `silueta-vehiculo.tsx` (solo si necesitas un tamaño nuevo) y el nuevo
  `vecino-perfil-modal.tsx`.
- No cambies la lógica de `estado-vecinos.ts`, `use-vecinos-ruta.ts`, `color-vehiculo.ts` ni la alerta por
  voz de `vecinos-ruta-panel.tsx`.

## Criterio de aceptación
- Cada fila se lee de un vistazo: micro de color, placa y distancia.
- Un toque abre el perfil chico con "Próximamente", y Cerrar vuelve al mapa sin perder nada.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-07-vecinos.md`.
