# Fuentes de las fotos mock (`/en-vivo` simulado)

Búsqueda timeboxeada (~15 tool calls de WebSearch/WebFetch) por fotos reales de trufis de las
líneas Z12 y 120 en Cochabamba. **No se encontró ninguna foto específica de esas dos líneas**
con licencia reutilizable (se revisaron Wikimedia Commons, Flickr, Google/Bing vía búsqueda
web, Los Tiempos, Opinión y la Trufi App). Resultado, por archivo:

## `z12-1.jpg` — FOTO REAL de un trufi de Cochabamba (línea genérica, NO específica de Z12)

- **Fuente:** Wikimedia Commons, [File:Micros de Transporte Público, Cochabamba.jpg](https://commons.wikimedia.org/wiki/File:Micros_de_Transporte_P%C3%BAblico,_Cochabamba.jpg)
- **URL directa original:** https://upload.wikimedia.org/wikipedia/commons/2/25/Micros_de_Transporte_P%C3%BAblico%2C_Cochabamba.jpg
- **Autor:** MollySVH (Flickr), revisada y confirmada por FlickreviewR 2 el 2021-04-03.
- **Licencia:** Creative Commons Attribution 2.0 Generic (CC BY 2.0).
- **Qué muestra:** un bus/trufi de la **línea 3V** ("Spiddy Gonzales"), fotografiado en
  Cochabamba el 2019-03-26. Es un trufi real cochabambino, pero de OTRA línea (3V, no Z12) —
  se usa acá porque el plan permite usar "una de un trufi cochabambino genérico" cuando no
  aparece una foto específica de la línea pedida.
- **Procesado:** recortada a cuadrado centrado (1494×1494 del original 1974×1494) y redimensionada a 256×256, JPEG calidad ~80, con ImageMagick (`convert`).
- **Caveat de licencia (ya señalado en el plan, Decisión 5):** es una foto de un tercero (uso
  bajo CC BY 2.0, sin más permiso que el que da esa licencia) — sirve solo para esta demo
  interna y temporal. La placa que se ve en la foto (no visible/tapada en el recorte) no
  corresponde a la placa mock asignada al trufi.

## `z12-2.jpg` y `l120-1.jpg` — PLACEHOLDERS (no son fotos reales)

No se encontró una segunda foto real reutilizable dentro del timebox de búsqueda (la única
otra candidata específica de Cochabamba, de Flickr/Takashi Matsumura, es "All rights
reserved" — no reutilizable; otra encontrada en Wikimedia Commons, "Sindicato de trufis.jpg",
resultó ser de Villa Montes, Tarija, NO de Cochabamba).

Ante eso, y siguiendo la instrucción explícita del encargo ("si no aparece nada, crear
placeholders neutrales con silueta de minibús"), se generaron 2 placeholders con
ImageMagick: fondo sólido + silueta de minibús + etiqueta de línea.

- `z12-2.jpg`: fondo azul `#2563eb` (mismo azul de la línea Z12), silueta blanca, texto "Z12".
- `l120-1.jpg`: fondo gris oscuro `#334155` (neutral — el blanco `#ffffff` real de la Línea
  120 no serviría de fondo, taparía la silueta blanca), silueta blanca, texto "LINEA 120".

Ambos 256×256 JPEG calidad ~80, generados con `convert -size 256x256 xc:'<color>' -draw ...`.

## Búsquedas realizadas (para que quede registro de qué se intentó)

- WebSearch: "trufi línea Z12 Cochabamba foto", "trufi línea 120 Cochabamba foto minibus",
  "trufi Cochabamba minibus site:commons.wikimedia.org", `"trufi" Cochabamba transporte
  público foto minibus Los Tiempos`, "MollySVH flickr Cochabamba trufi bus", `"línea 120"
  Cochabamba trufi foto Facebook OR "los tiempos" OR opinion.com.bo`, "Cochabamba trufi bus
  colorido foto site:commons.wikimedia.org OR site:flickr.com", `Cochabamba "trufi" OR
  "micro" bus colorido pexels OR unsplash OR wikimedia`.
- WebFetch: página del archivo de Wikimedia Commons, categorías "Buses in Bolivia" / "Buses
  in Cochabamba", búsqueda de MediaSearch en Commons, foto de Takashi Matsumura en Flickr,
  "Sindicato de trufis.jpg", atlasofpopulartransport.mit.edu/cochabamba-1 (sin fotos).
