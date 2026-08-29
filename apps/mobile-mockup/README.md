# QUIVO Mockup

Copia autónoma de la app móvil para validar pantallas y flujos rápidamente.

- No usa backend, API, GPS ni almacenamiento de sesión.
- El acceso usa únicamente celular del chofer y placa del vehículo.
- Los datos de la jornada y los puntos de control son estáticos.
- Los puntos inicial y final tienen una lista de salida simulada con posición, placas y hora estimada.
- La llegada a un control y el turno de salida usan alertas sonoras diferentes.

## Ejecutar

Desde la raíz del monorepo:

```bash
pnpm --filter @quivo/mobile-mockup start
```

También se puede abrir en Android o iOS con los scripts del paquete. No es necesario iniciar Docker ni `apps/api`.

## Datos precargados

- Celular: `700 12345`
- Placa: `1234 ABC`

El botón de acceso acepta cualquier celular con al menos siete dígitos y cualquier placa con cuatro caracteres o más, porque el flujo es únicamente de demostración.
