# Pantalla 3 — Perfil (y la foto del vehículo)

Lee `README.md` y `pantallas/reglas-burbujas.md`. La parte visual de Perfil se puede **rehacer entera**;
lo que importa es que sea fácil de usar y que siga la línea de las burbujas. La lógica no cambia.

## Lo que NO cambia
- Hooks y datos: `use-perfil-query.ts`, `use-operacion-settings.tsx`, `use-vehiculo-foto.ts`,
  `vehiculo-foto-core.ts`, `rescate-dia1*`, la navegación a `Ajustes`, la búsqueda de actualización y el
  `CerrarSesionDialog`.
- **Texto grande**: hoy Perfil escala sus textos con `useTextScale` y `settings.textoGrande`
  (`fontSize * scale` y `allowFontScaling={!settings.textoGrande}`). Ya se perdió una vez en un rediseño:
  mantenlo en **todos** los textos nuevos.
- `aviso-foto-vehiculo.tsx` no se toca (es de codex-trabajo2 en la fase 2a del mapa).

## Orden de la pantalla (de arriba hacia abajo)
1. **Cabecera** `QuivoHeader` con ‹ de 44 y el título `Perfil`.
2. **Tarjeta del vehículo**: la protagonista, porque es lo que el conductor viene a ver o a actualizar.
   - **Con foto**: la foto ocupa todo el ancho de la burbuja, en 16:9 y con `innerRadius`.
     - Encima de la foto, abajo a la izquierda, la **placa** como chapa: pastilla blanca, Oxanium 700 de 22,
       con espaciado entre letras y borde `borderStrong`.
     - Arriba a la derecha, un botón de cámara de 44 (`BotonBurbuja`) con
       `accessibilityLabel="Cambiar foto"`.
     - Tocar la foto la abre a pantalla completa (`Modal` negro, foto `contain`, ✕ de 44 arriba a la derecha).
   - **Sin foto**: el mismo recuadro 16:9 en `surfaceSoft`. Adentro, centrados, la silueta del vehículo
     (`SiluetaVehiculo` de `features/vecinos-ruta/silueta-vehiculo.tsx`, en `textTertiary`), el texto
     `Agrega una foto de tu vehículo` y el botón primario `Tomar foto`. Es la única acción primaria de la pantalla.
   - **Subiendo**: velo blanco al 70 % sobre el recuadro con `Loader` y `Subiendo…`. No hay otra pastilla de estado.
   - **Error**: una línea en `danger` bajo el recuadro con el mensaje y `Reintentar` (`ghost`).
     Si `requiereAjustes`, la acción pasa a `Abrir ajustes`.
   - **No se pudo cargar** (`estadoFoto === 'desconocido'`): recuadro con icono de nube tachada y
     `No se pudo cargar la foto`. Nunca debe parecer "sin foto".
   - Debajo del recuadro, en una línea: `Toyota Hiace · blanco` (Text md) a la izquierda y
     `Actualizada 26/10` (Text sm `secondary`) a la derecha, si la foto tiene fecha.
3. **Tarjeta del conductor**, compacta, en una fila: `Avatar` de 44 con su estado, nombre (`Heading` sm),
   `CI … · Sindicato …` (Text sm `secondary`, una línea con elipsis) y, a la derecha, la pastilla
   `EN VIVO` / `EN ESPERA`. Sin el bloque centrado gigante de hoy.
4. **Opciones**: una burbuja con filas de 52 separadas por `Divider`. Cada fila lleva icono en círculo de 44,
   título, descripción corta en `secondary` y ›.
   - `Ajustes de operación`, con la descripción `Voz, texto grande y alertas`.
   - `Sincronización`, con la descripción `Actualizar mis datos`. Mientras se recargan los datos (si la
     consulta ya expone `isFetching` o `isRefetching`), el › cambia por un `Loader` pequeño. No agregues lógica nueva.
5. **Aplicación**: la misma burbuja de filas, con `Versión` (valor a la derecha) y `Buscar actualización`
   (deshabilitada con su motivo, como hoy).
6. **Cerrar sesión**: `Button` outline `danger` a ancho completo, de 52, separado `24` de lo anterior.

- Títulos de sección (`Vehículo`, `Opciones`, `Aplicación`) en `Text` sm `secondary`, en minúscula inicial,
  alineados con el borde de las burbujas (no con su texto interior).
- El contenido se desplaza (`ScrollView`) con márgenes `edge` a los costados y un margen inferior que
  respete `insets.bottom`.

## Archivos
- Reescribir: `src/features/perfil/perfil-screen.tsx` y `src/features/vehiculo-foto/foto-vehiculo-section.tsx`
  (puedes partirla en `components/` dentro de `vehiculo-foto/`).
- Si la placa como chapa se repite (Perfil y login), créala como `src/shared/components/placa-chapa.tsx`.
  Del login **no** toques nada: solo deja el componente listo.

## Criterio de aceptación
- Agregar o cambiar la foto: un toque desde que se abre Perfil. Ver la foto en grande: un toque.
- Con foto, sin foto, subiendo, error y "no se pudo cargar" se distinguen sin leer con atención.
- En 360 dp nada se corta. Con texto grande activado, todo crece y nada se superpone.
- Una sola acción primaria visible.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-03-perfil.md`.
