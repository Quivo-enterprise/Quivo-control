# codex-trabajo2 · Iteración 1

## Archivos tocados

- `apps/mobile/src/shared/components/Button.tsx`: adapta variantes, tamaños y estados al botón nativo; conserva iconos y estilos externos con una pieza local.
- `apps/mobile/src/shared/components/Input.tsx`: integra el campo nativo y conserva máscara, estilos de carcasa y multilínea mediante una pieza local con tokens.
- `apps/mobile/src/shared/components/Card.tsx`: monta las variantes existentes sobre `Card` nativo y conserva cabecera y pie.
- `apps/mobile/src/shared/components/quivo-confirm-dialog.tsx`: unifica tarjeta, títulos, mensaje y acciones; reemplaza el blur por un fondo oscurecido.
- `apps/mobile/src/shared/components/cerrar-sesion-dialog.tsx`: reutiliza el patrón de confirmación conservando el aviso sobre el GPS.
- `apps/mobile/src/shared/components/quivo-header.tsx`: añade la flecha circular de 44 px, centra el título con espacio simétrico y usa tipografía del design system.
- `apps/mobile/src/features/auth/vehicle-login-screen.tsx`: actualiza campos, botón Ingresar, aviso informativo y espaciado; conserva el gradiente y el logo aprobados.
- `apps/mobile/src/features/auth/splash-screen.tsx`: usa Loader, Heading y Text para los tres estados; conserva los textos y el reintento.
- `apps/mobile/src/features/auth/assignment-selection-screen.tsx`: convierte las asignaciones en tarjetas táctiles con insignia, turno, salida y ruta; conecta la zona táctil de la flecha con el `onBack` existente.

## Design system

`Button` en el adaptador compartido; `Input` en el adaptador compartido; `Card` en el adaptador compartido; `Heading` y `Text` en diálogos, cabecera y pantallas de entrada; `Loader` en splash; `Badge` en la hora de salida. Se usan tokens de color, espacio, radio, tamaño de fuente y elevación.

## Huecos y pendientes

- El `Button` nativo solo admite texto: el adaptador local mantiene iconos, contenido React y `textStyle` que usan otras pantallas.
- El `Input` nativo no expone máscara, `inputShellStyle`, `containerStyle`, `labelStyle` ni el radio multilínea: el adaptador local mantiene esos casos.
- El `Card` nativo no tiene cabecera, pie ni variantes `glass` e `interactive`: el adaptador los compone.
- No hay componente nativo de diálogo ni botón de icono; el diálogo se compone con tokens.
- La acción de regreso en la pantalla de asignaciones se conecta con una zona táctil local sobre la flecha de `QuivoHeader`; el contrato público compartido permanece igual.
- No se hizo captura en el Motorola; la revisión visual a 360 dp queda para el supervisor.

## Verificación

- `pnpm --filter @quivo/mobile typecheck`: terminó con código 0.
- `pnpm --filter @quivo/mobile lint`: terminó con código 0, 0 errores y 11 advertencias; una en `splash-screen.tsx` y las demás en otros archivos.
- `pnpm --filter @quivo/mobile test`: 87 archivos y 1079 pruebas aprobadas.
- Dentro del sandbox del proceso secundario, `pnpm` no pudo iniciar por `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` en un almacén de solo lectura. Los tres comandos anteriores se ejecutaron después desde el entorno principal, tras el último cambio de código.

No se hicieron commits ni se inició Metro. Los cambios concurrentes o preexistentes en otros archivos del repositorio no forman parte de esta entrega.
