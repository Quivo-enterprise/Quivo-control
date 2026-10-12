'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { cx } from '../utils.js';
import { Loader } from './primitives.js';
import type { RouteMapProps } from './route-map-impl.js';

export type { RouteMapProps };

// `route-map-impl.js` importa MapLibre GL a nivel de módulo, y MapLibre toca `window`/WebGL
// al cargar. `React.lazy` no ejecuta el `import()` hasta que React
// intenta renderizar `RouteMapImpl` — así que definir el lazy acá arriba es seguro; lo que
// hay que evitar es *renderizarlo* durante SSR (ver `mounted` más abajo).
const RouteMapImpl = lazy(() =>
  import('./route-map-impl.js').then((module) => ({ default: module.RouteMap })),
);
// Motor Google Maps (`engine="google"`): chunk aparte, solo se descarga si alguna pantalla lo pide.
const RouteMapGoogleImpl = lazy(() =>
  import('./route-map-google.js').then((module) => ({ default: module.RouteMap })),
);

/**
 * Wrapper client-only de `RouteMap` — es el que se exporta desde el barrel (`index.ts` sigue
 * apuntando a `./ui/RouteMap.js`; la API pública — nombre, props — no cambia).
 *
 * Nunca renderiza la implementación real (`route-map-impl.tsx`, con MapLibre GL) durante el
 * prerender de Next: hasta que `mounted` pasa a `true` (recién ocurre en el `useEffect`, que
 * solo corre en cliente tras el primer render) pinta el mismo placeholder que el componente ya
 * usaba para `loading` — mismo `Loader`, respetando `height`/`className` para no saltar el
 * layout. Una vez montado, `React.lazy` + `Suspense` cargan `route-map-impl.js` (y con él
 * MapLibre) de forma perezosa; mientras ese chunk no llegó, se ve el mismo placeholder como
 * fallback de `Suspense` — es un flash breve y esperado, no un bug.
 */
export function RouteMap(props: RouteMapProps) {
  // Default espejado del que usa `route-map-impl.tsx` — necesario acá para que el placeholder
  // (pre-mount y fallback de Suspense) tenga la misma altura que el mapa real una vez montado.
  const { height = '420px', className, engine = 'maplibre' } = props;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const placeholder = (
    <div className={cx('qv-route-map', className)} style={{ height }}>
      <div className="qv-route-map__loading">
        <Loader label="Cargando mapa..." />
      </div>
    </div>
  );

  if (!mounted) return placeholder;

  return (
    <Suspense fallback={placeholder}>
      {engine === 'google' ? <RouteMapGoogleImpl {...props} /> : <RouteMapImpl {...props} />}
    </Suspense>
  );
}
