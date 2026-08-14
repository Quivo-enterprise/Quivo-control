# Plan de implementación — autenticación móvil e identidad QUIVO

> Estado: **implementado y verificado en Android**  
> Fecha de decisión: **2026-08-01**  
> Responsable principal: **Codex**  
> Objetivo de coordinación: permitir que Claude avance en `apps/web` sin solapar los
> cambios de la aplicación móvil ni sus contratos de autenticación.

## 1. Decisiones confirmadas

- La aplicación móvil seguirá la identidad visual del Design System QUIVO ubicado en
  `/home/jairomgr/Proyectos/Web/Design_System_QUIVO`.
- El acceso será una autenticación encadenada de dos entidades:
  1. **Vehículo:** placa + PIN emitido por el sindicato.
  2. **Chofer:** documento de identidad + PIN personal.
- Son dos credenciales independientes y dos pasos de validación. No se documentará como
  MFA estricto, porque ambos secretos pertenecen a la misma categoría de factor.
- Tras validar ambos pasos, el backend resolverá la asignación vigente y devolverá el
  contexto operativo: vehículo, chofer, sindicato, ruta, línea, turno y asignación.
- La línea no se inferirá directamente del vehículo. Se obtendrá mediante
  `asignacion -> ruta -> linea`.
- El inicio de sesión requiere conexión. Una sesión ya iniciada podrá seguir registrando
  GPS y eventos offline; la renovación y sincronización ocurrirán al recuperar conexión.

## 2. División de trabajo para evitar conflictos

### Codex — alcance reservado

- `apps/mobile/**`
- Módulo/endpoints nuevos de autenticación operativa móvil en `apps/api/**`
- Contratos móviles nuevos en `packages/shared/**`
- Cambios de esquema y migraciones estrictamente necesarios para:
  - credencial del chofer;
  - desafíos de acceso;
  - sesiones operativas.
- Pruebas de contrato, autenticación móvil, contexto operativo y almacenamiento seguro.

### Claude — alcance web

- `apps/web/**`: combos, formularios, visualización y consumo de las APIs administrativas.
- Puede corregir endpoints administrativos existentes si un combo web necesita datos
  reales, procurando limitar esos cambios a los módulos CRUD ya existentes.
- No debe implementar en paralelo el login móvil ni crear contratos alternativos para
  vehículo/chofer/sesión operativa.
- Si la web necesita tocar `packages/shared`, `packages/db` o un archivo de API que también
  aparezca en este plan, debe revisar primero `git diff` y actualizar esta sección o dejar
  una nota en `docs/handoff.md` antes de continuar.

## 3. Flujo funcional previsto

### Paso 1 — validar vehículo

La pantalla pedirá placa y PIN. La placa se normalizará antes de enviarla. El servidor:

- buscará un vehículo activo;
- verificará el PIN contra `Vehiculo.credencialHash`;
- aplicará rate limiting y respuestas de error genéricas;
- emitirá un desafío corto, de un solo propósito, ligado al vehículo y al dispositivo.

El desafío no dará acceso a endpoints de negocio ni contendrá el PIN.

### Paso 2 — validar chofer

La pantalla pedirá documento de identidad y PIN. El servidor:

- verificará el PIN contra el hash de credencial del chofer;
- comprobará que vehículo y chofer estén activos y pertenezcan al mismo sindicato;
- consumirá/inutilizará el desafío del paso anterior;
- buscará una asignación publicada, vigente y compatible con vehículo, chofer y jornada;
- creará o reanudará una sesión operativa vinculada a asignación, vehículo, chofer y
  dispositivo.

Si existen varias asignaciones válidas, la API devolverá las opciones para que el chofer
elija; no seleccionará una silenciosamente.

### Paso 3 — contexto operativo

La respuesta final tendrá, como mínimo:

```ts
type ContextoOperativoMovil = {
  sesionId: string;
  asignacion: { id: string; fecha: string; horario: string; venceAt: string };
  vehiculo: { id: string; placa: string; tipo: string; marca: string; modelo: string };
  conductor: { id: string; nombre: string; documentoIdentidad: string };
  sindicato: { id: string; nombre: string };
  linea: { id: string; codigo: string; nombre: string; color: string };
  ruta: { id: string; sentido: string };
};
```

Ninguna respuesta expondrá `credencialHash`, PINes ni detalles que permitan enumerar
vehículos o choferes.

## 4. Contratos HTTP previstos

Los nombres definitivos se declararán primero con Zod en `packages/shared`:

```text
POST /v1/mobile/auth/vehiculo
POST /v1/mobile/auth/conductor
POST /v1/mobile/auth/refresh
POST /v1/mobile/auth/logout
GET  /v1/mobile/auth/contexto-operativo
PUT  /v1/mobile/credenciales/vehiculos/:id
PUT  /v1/mobile/credenciales/conductores/:id
```

- `vehiculo` recibe placa, PIN y `deviceId`; devuelve el desafío corto.
- `conductor` recibe desafío, documento y PIN; devuelve tokens y contexto operativo.
- `refresh` rota la sesión renovable.
- `logout` revoca la sesión en el servidor y elimina secretos locales.
- `contexto-operativo` permite recuperar el paquete después de reiniciar la app.

## 5. Cambios de datos previstos

- Conservar `Vehiculo.credencialHash`, ya existente.
- Agregar una credencial hasheada al chofer; nunca almacenar ni devolver el PIN en texto.
- Implementar `sesiones_operativas` según el modelo técnico existente:
  asignación + vehículo + chofer + dispositivo + inicio/fin + estado.
- El desafío del vehículo es corto, de un solo uso, ligado al dispositivo y persistido sólo
  como hash. Los access/refresh móviles también son opacos, revocables y separados del
  access token administrativo.
- Toda consulta operativa respetará tenant y RLS; el sindicato se derivará de la identidad
  validada, nunca de un `sindicatoId` confiado al cliente.

## 6. Port nativo del Design System QUIVO

El paquete web no se importará directamente porque sus componentes usan DOM y CSS. Se
portarán sus decisiones visuales a componentes React Native.

Tokens base acordados:

- Primario: `#3226B4`
- Primario fuerte: `#3123C7`
- Primario suave: `#DCD9FB`
- Acento: `#FD9E15`
- Fondo de página: `#F1F1F8`
- Superficie/tarjeta: `#FFFFFF`
- Texto principal: `#1A1A2E`
- Texto secundario: `#4B4B6B`
- Texto tenue: `#9191B0`
- Tipografía de títulos: Oxanium
- Tipografía de cuerpo: Montserrat
- Tipografía técnica: JetBrains Mono

Componentes nativos previstos:

- `QuivoButton`
- `QuivoCard`
- `QuivoTextField`
- `QuivoHeader`
- indicador de pasos vehículo -> chofer -> contexto
- mensajes de error/estado accesibles

Se respetarán objetivos táctiles de al menos 48 dp, contraste, estado de carga, teclado,
lectores de pantalla y tamaños de texto de Android.

## 7. Estructura móvil prevista

```text
apps/mobile/src/
├── features/auth/          pantallas, estado y cliente de autenticación
├── features/operacion/     contexto y sesión operativa
├── shared/api/             cliente HTTP y validación de respuestas
├── shared/components/      componentes QUIVO nativos
├── shared/security/        SecureStore y ciclo de tokens
└── shared/theme/           tokens QUIVO para React Native
```

`App.tsx` dejará de ser la pantalla única del spike y pasará a componer el flujo de
autenticación y operación. La lógica de GPS/outbox existente se conservará y se integrará
después del contexto operativo; no se eliminará.

## 8. Seguridad mínima obligatoria

- Guardar tokens exclusivamente con almacenamiento seguro nativo (`expo-secure-store` o
  equivalente), nunca en AsyncStorage ni SQLite.
- Mantener eventos GPS/outbox sin secretos de autenticación.
- Hash y verificación de PIN sólo en backend mediante una implementación auditada.
- Rate limiting estricto por IP en los endpoints de acceso, desafío ligado a dispositivo y
  máximo de intentos de chofer por desafío.
- Errores genéricos para evitar enumeración.
- Tokens de acceso cortos, refresh rotatorio/revocable y logout server-side.
- No registrar PINes, tokens, desafíos ni hashes en logs, Sentry o auditoría.
- Invalidar desafíos consumidos, vencidos o reutilizados.

## 9. Pruebas y criterios de aceptación

- Vehículo válido + chofer válido + asignación vigente abre el contexto correcto.
- PIN incorrecto en cualquiera de los pasos no revela qué campo falló.
- Chofer de otro sindicato o no asignado al vehículo es rechazado.
- Asignación vencida, borrador o inexistente no inicia recorrido.
- La ruta devuelve la línea correcta y todos los datos pertenecen al mismo tenant.
- Un desafío no puede reutilizarse ni intercambiarse entre dispositivos.
- Reiniciar la app recupera la sesión desde almacenamiento seguro.
- Sin red durante un recorrido, GPS/outbox continúan y sincronizan al reconectar.
- Logout revoca refresh token y limpia secretos locales.
- Typecheck, lint, tests de contrato/API/móvil y build Android quedan en verde.

## 10. Orden de implementación

1. Contratos Zod y pruebas de contrato.
2. Esquema/migraciones y seeds de desarrollo sin PINes en texto persistido.
3. Autenticación backend en dos pasos y resolución de asignación/contexto.
4. Tokens/componentes QUIVO nativos.
5. Pantallas vehículo, chofer y contexto operativo.
6. SecureStore, refresh, restauración de sesión y logout.
7. Integración del GPS/outbox existente con la sesión operativa.
8. Verificación E2E en Android por ADB usando la IP LAN del backend.

## 11. Resultado verificado — 2026-08-01

- Migración aplicada y seed idempotente con asignación publicada para la jornada Bolivia.
- Contratos Zod, backend móvil, guard, rotación/revocación y endpoints administrativos
  implementados.
- Cambio de PIN invalida desafíos/sesiones vinculadas y crea auditoría sin PIN ni hash.
- Port nativo de colores, tipografías y componentes QUIVO completado.
- Flujo vehículo -> chofer -> operación probado contra la API real desde `Pixel_10_Pro`.
- Restauración de jornada desde SecureStore comprobada tras detener y reabrir el proceso.
- Metro entrega el bundle Android correctamente con pnpm mediante `apps/mobile/index.js`.
- APK debug compilado e instalado como `com.quivotech.conductor`.
- Headers de autorización/cookies eliminados globalmente de los logs HTTP.

## 12. Fuera de alcance de este cambio

- Rediseño o corrección de combos de la web administrativa: corresponde a Claude.
- Login administrativo email+contraseña existente.
- iOS.
- Fotos/evidencia multimedia.
- Sustituir la tecnología de tracking GPS actual.
