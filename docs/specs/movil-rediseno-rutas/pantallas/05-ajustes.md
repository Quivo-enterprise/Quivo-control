# Pantalla 5 — Ajustes

Lee `README.md` y `pantallas/reglas-burbujas.md`. Archivo: `apps/mobile/src/features/perfil/ajustes-screen.tsx`.
La visual se puede rehacer entera. **No cambia** `use-operacion-settings.tsx` (qué ajustes existen, sus
valores por defecto y qué hace cada uno), ni `rescate-dia1*`, ni el escalado de texto grande (que se
mantiene en todos los textos).

## Lo que se vio en el teléfono
- Cada ajuste ocupa 3 a 5 líneas: título, descripción y una pista gris ("Requiere permisos de audio",
  "Útil con planes limitados"). Seis ajustes necesitan dos pantallas de scroll.
- **Registro automático de controles** tiene un interruptor encendido pero deshabilitado: parece que se
  puede apagar y no se puede. Además lleva la pastilla `AUTOMÁTICO` y el texto "Próximamente: validación manual".
- La pastilla `ACTIVO` junto a "Trabajar offline" repite lo que ya dice el interruptor.
- "Rescate de datos — día 1" le habla al chofer de "outbox": es lenguaje técnico.

## Diseño
- Cabecera como en Perfil (‹ de 44 y título `Ajustes`).
- **Filas de 64**: icono en círculo de 44, título (Text md semibold) y **una sola línea** de descripción
  (Text sm `secondary`, `numberOfLines={2}` como tope con texto grande) y el `Switch` a la derecha. **Toda
  la fila** cambia el interruptor (`accessibilityRole="switch"`, `accessibilityState.checked`).
- La pista gris desaparece. Solo se muestra cuando aplica, como una línea `warning`. Por ejemplo, voz
  activada sin permiso de audio, si ese dato ya existe en la pantalla. No se agrega lógica nueva para detectarlo.
- **Grupos** (títulos en Text sm `secondary`, como en Perfil):
  1. **Durante el recorrido**:
     - Navegación por voz — `Te dice las paradas y los avisos.`
     - Sonido de confirmación — `Una campanita al registrar cada punto.`
  2. **Pantalla**:
     - Texto grande — `Letras más grandes para leer al sol.`
  3. **Conexión**:
     - Trabajar sin conexión — `Guarda todo y lo envía cuando vuelva la señal.`
     - Ahorro de datos — `Usa menos datos móviles en segundo plano.`
  4. **Registro de puntos**: **una fila informativa, sin interruptor**: icono `shield-checkmark` en
     `success`, `Automático`, `Cada punto se registra solo al pasar por él.` Sin pastillas ni "próximamente".
  5. **Ayuda**, solo si hay puntos para rescatar, como hoy:
     - una burbuja con `Enviar recorrido guardado` (título) y `Hay 101 puntos de tu recorrido en el teléfono
       que todavía no se enviaron.`;
     - el botón primario `Enviar ahora` (la misma acción de hoy) y, debajo, sus estados actuales
       (en curso, hecho, error) con el mismo texto que hoy pero sin palabras técnicas.
- Las pastillas `AUTOMÁTICO` y `ACTIVO` se quitan.

## Criterio de aceptación
- Los seis ajustes y el registro automático entran en una pantalla de 360×800 sin scroll (con texto normal).
- Ningún interruptor que no se pueda cambiar.
- Ninguna palabra técnica: outbox, sync, payload, etc.
- Con texto grande todo crece y nada se corta.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-05-ajustes.md`.
