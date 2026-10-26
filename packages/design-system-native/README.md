# @quivo/design-system-native

Copia de `Quivo-UI-UX/packages/design-system-native/src` (commit `46ef625`, 2026-10-24) para la app
del conductor. Vive dentro del repo, como `packages/design-system` para la web, porque EAS solo sube
este repo: un `link:` al repo hermano rompería el build.

No se edita acá. Los cambios van primero a `Quivo-UI-UX` y se vuelven a copiar `src/`.

## Diferencias locales con Quivo-UI-UX (llevarlas al original)
- `fontStyle(kind, weight)` en `tokens.ts`, usado por `Text`, `Heading`, `Badge`, `Button`, `Input`, `Switch` y
  `Avatar`: en Android una fuente de expo-font solo trae su variante normal y `fontWeight: "700"` caía a Roboto.
  El peso se elige por nombre de archivo (`Montserrat_600SemiBold`, `Oxanium_700Bold`, …) y `fontWeight` queda
  en `"normal"`. Antes, `Text` ni siquiera ponía `fontFamily`.
- `Input`: el placeholder y el texto de ayuda usan `textTertiary`; `textMuted` en claro es `#1a1a1a` y el
  placeholder parecía un valor escrito (el token `textMuted` del original también hay que revisarlo).
