# QUIVO Control — landing

Landing de producto con el estilo de la landing principal de QUIVO: logotipo sin isotipo, navegación con indicador fluido, temas claro/oscuro y footer compartido adaptado a las secciones de Control.

## Desarrollo y comprobación

Desde la raíz del monorepo:

```sh
pnpm --filter @quivo/landing dev
pnpm --filter @quivo/landing typecheck
pnpm --filter @quivo/landing lint
pnpm --filter @quivo/landing build
pnpm --filter @quivo/landing start
```

Puerto local: 3200. Usar Node 22, según el requisito del monorepo. Detener `dev` antes de compilar: Next comparte la carpeta `.next` entre desarrollo y producción.

## Contacto y publicación

- El formulario solicita nombre, línea, ciudad, cantidad de líneas y vehículos aproximados (opcional) para coordinar una demostración. Envía los datos a `POST /v1/public/demo-request`; la API los valida y guarda la solicitud, y devuelve el mensaje y el enlace de WhatsApp para continuar la conversación. Si la API no responde, ofrece el enlace de WhatsApp como respaldo y lo indica en pantalla.
- `NEXT_PUBLIC_PANEL_URL` configura el enlace «Entrar al panel». El valor local por defecto es `http://localhost:3100/login`, correspondiente a `apps/web` con `scripts/dev-all.sh`. Configurar la URL pública del panel de Control antes de publicar. Consultar `.env.example`.
- `NEXT_PUBLIC_API_URL` configura la base pública de la API (sin `/v1`), normalmente `https://api.myquivo.com`. `NEXT_PUBLIC_DEMO_WHATSAPP_NUMBER` configura el respaldo de WhatsApp.
- La vista del panel es una demostración de QUIVO Control: usa el recorrido de la Línea 120 como caso visual, con cuatro trufis animados y un feed de estados en vivo simulado.
- El simulador contiene ejemplos ficticios. Los testimonios anteriores no se muestran porque no tienen fuentes verificables en el proyecto.
- La vista pública muestra un hero a pantalla completa de QUIVO Control; la Línea 120 aparece solo como caso visual en la foto y el panel de demostración, junto con pasos de funcionamiento, capacidades de seguimiento, preguntas y contacto.
- El simulador y los testimonios se conservan en el código, pero no se muestran porque el primero usa datos ficticios y los segundos no tienen fuentes verificables.

## Fotografías

El hero usa `brand/vehicles/cochabamba/linea-120-tiquipaya.webp`, una foto de la Línea 120 encontrada en el proyecto de Tiquipaya. El panel reutiliza `RouteMap` de `@quivo/design-system`, por lo que presenta el mismo mapa vectorial de OpenStreetMap/OpenFreeMap del panel administrativo, con el recorrido real de demostración y cuatro marcadores que avanzan sobre la ruta. `mapa-linea-120-route-wide.webp` queda como respaldo visual si el navegador no puede cargar los tiles.

## Exportación para HostGator / Apache

Con Node 22, desde la raíz del monorepo:

```sh
LANDING_STATIC_EXPORT=1 \
NEXT_PUBLIC_API_URL=https://api.myquivo.com \
NEXT_PUBLIC_DEMO_WHATSAPP_NUMBER=59168482323 \
NEXT_PUBLIC_PANEL_URL=https://quivo-web-424426714260.southamerica-west1.run.app/login \
pnpm --filter @quivo/landing build
```

La carpeta `apps/landing/out/` contiene el sitio estático completo (incluidos
`_next/` y `brand/`). Publicar su contenido en la raíz documental de
`control.myquivo.com`, después de identificar esa carpeta en cPanel y respaldar
el contenido existente. No subir el repositorio ni archivos de credenciales.
El modo normal de desarrollo y `next start` siguen disponibles sin
`LANDING_STATIC_EXPORT=1`.

Verificar el enlace al panel y la API antes de cada publicación. La migración
`packages/db/prisma/migrations/20260906120000_demo_requests` debe estar aplicada
en la base de datos de la API. En producción, `CORS_ORIGIN` debe incluir
`https://control.myquivo.com`.

El build local no publica automáticamente el sitio: subir el contenido de
`out/` a la raíz documental configurada en cPanel.
