# Pruebas de aceptación — panel administrativo

Estas pruebas ejercitan el panel web en Chromium contra el API y PostgreSQL locales. Usan
exclusivamente los datos idempotentes del seed, por lo que no crean ni cambian entidades de
negocio.

Cubren los criterios del primer hito administrativo:

- `admin_quivo` ve y usa los módulos exclusivos **Sindicatos** y **Usuarios**.
- `admin_sindicato` no puede abrir esos módulos por menú ni escribiendo la URL y solo ve su
  propia flota.
- El recorrido operacional sembrado es consultable desde **Rutas → Rotaciones → Reglas y
  sanciones → Reportes**.

## Ejecutar localmente

Con Docker activo, preparar el esquema y los datos semilla una vez (el comando es
idempotente):

```bash
pnpm test:acceptance:prepare
```

Después, ejecutar las pruebas:

```bash
pnpm test:acceptance
```

Por defecto Playwright levanta un API aislado en `:3002` y una web aislada en `:3101`; si ya
están activos, los reutiliza. Para apuntar a un entorno ya iniciado, definir ambos orígenes:
`ACCEPTANCE_API_URL=http://localhost:3001 ACCEPTANCE_BASE_URL=http://localhost:3100 pnpm test:acceptance`.
El API debe permitir ese origen en CORS y contener las cuentas de prueba documentadas en
`apps/api/README.md`.
