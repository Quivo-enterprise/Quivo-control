'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  Loader,
  PageHeader,
  RouteMap,
  Select,
  Tag,
  type MapPoint,
  type MapRoute,
  type MapZone,
} from '@quivo/design-system';
import type { ContextoEnVivo, CumplimientoRecorrido, SesionEnVivoResumen } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { ApiError } from '../../../src/lib/api/client';
import {
  useContextoEnVivo,
  useRecargarTraza,
  useSesionesEnVivo,
  useTrazaEnVivo,
} from '../../../src/lib/en-vivo/use-en-vivo';
import {
  antiguedadViva,
  formatearAntiguedad,
  intervaloPoll,
  PRESENTACION_FRESCURA,
  type TrazaAcumulada,
} from '../../../src/lib/en-vivo/traza';

/** Color fijo de la traza GPS real, igual que en el detalle histórico
 * (`/reportes/recorridos/[id]`) para que las dos pantallas se lean igual. */
const COLOR_TRAZA = '#2563eb';

export default function EnVivoPage() {
  const { token } = useAuth();
  const router = useRouter();

  const sesiones = useSesionesEnVivo(token);
  const [sesionId, setSesionId] = useState<string | null>(null);
  // "Seguir" mueve la cámara detrás del vehículo. Arrastrar el mapa lo apaga (`onUserPan`)
  // para que el panel no le pelee el control al usuario.
  const [seguir, setSeguir] = useState(true);

  // La sesión por defecto es la primera del listado: el server ya ordena por último fix (no
  // por `inicio`), así que es la que tiene datos más frescos. Se recalcula si la sesión
  // elegida desaparece del listado.
  const listado = useMemo(() => sesiones.data ?? [], [sesiones.data]);
  useEffect(() => {
    if (listado.length === 0) return;
    if (sesionId && listado.some((s) => s.id === sesionId)) return;
    setSesionId(listado[0]?.id ?? null);
  }, [listado, sesionId]);

  const contexto = useContextoEnVivo(token, sesionId);
  const traza = useTrazaEnVivo(token, sesionId);
  const recargarTraza = useRecargarTraza(sesionId);

  const sesion = listado.find((s) => s.id === sesionId);
  const datos = traza.data;
  const ultimoPunto = datos?.puntos.at(-1);
  const finalizada = Boolean(datos ? datos.sesionFin : sesion?.fin);
  const pollPausado = intervaloPoll(datos) === false;

  const estado = datos?.estadoFrescura ?? sesion?.estadoFrescura ?? 'sin_datos';
  const presentacion = PRESENTACION_FRESCURA[estado];

  // Memoizado sobre lo que realmente cambia (contexto de la ruta, traza, color del estado) y
  // NO sobre cada render de la página: sin esto, `RouteMap` recibe un `MapPoint[]` nuevo en
  // cada tick de `useReloj` (1 Hz) y `buildDivIcon` genera un `L.DivIcon` nuevo cada vez —
  // react-leaflet lo compara por referencia y reemplaza el nodo del DOM del marcador, así que
  // la animación `qv-pulse` del vehículo se reinicia cada segundo y nunca completa un ciclo.
  // Con el reloj movido adentro de `PanelFrescura` (ver más abajo) esto ya no pasa por el tick
  // del reloj, pero se mantiene igual: cualquier otro cambio de estado ajeno a estos datos
  // (ej. alternar "Seguir vehículo") tampoco debe recalcular ni la polilínea de ~4300 puntos
  // ni los íconos.
  const routes = useMemo(
    () => (contexto.data ? construirRutas(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  const markers = useMemo(
    () => (contexto.data ? construirMarcadores(contexto.data, datos, presentacion.color) : []),
    [contexto.data, datos, presentacion.color],
  );
  const zones = useMemo(() => (contexto.data ? construirZonas(contexto.data) : []), [contexto.data]);

  const cambiarSesion = (nuevo: string) => {
    setSesionId(nuevo);
    setSeguir(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="En vivo"
        subtitle={
          contexto.data
            ? `${contexto.data.vehiculo.placa} · ${contexto.data.conductor.nombre} · ${contexto.data.linea.nombre}`
            : 'Seguimiento de los vehículos de la jornada'
        }
        actions={
          sesionId ? (
            <Button
              size="sm"
              variant={seguir ? 'primary' : 'secondary'}
              disabled={!ultimoPunto}
              onClick={() => setSeguir((valor) => !valor)}
            >
              {seguir ? 'Siguiendo vehículo' : 'Seguir vehículo'}
            </Button>
          ) : undefined
        }
      />

      {sesiones.isLoading && <Loader label="Cargando sesiones…" />}

      {sesiones.isError && (
        <Alert variant="danger" title="No se pudo cargar el listado de sesiones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span>{mensajeError(sesiones.error)}</span>
            <span>
              <Button
                size="sm"
                variant="secondary"
                aria-label="Reintentar cargar sesiones"
                onClick={() => void sesiones.refetch()}
              >
                Reintentar
              </Button>
            </span>
          </div>
        </Alert>
      )}

      {!sesiones.isLoading && !sesiones.isError && listado.length === 0 && (
        <Alert variant="info" title="No hay sesiones para mostrar">
          Ningún vehículo inició un recorrido en la jornada de hoy y no quedaron sesiones abiertas
          de días anteriores. La pantalla se actualiza sola en cuanto arranque una.
        </Alert>
      )}

      {listado.length > 0 && (
        <Card header="Sesión">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ minWidth: '22rem', flex: 1 }}>
              <Select
                label="Vehículo / dispositivo"
                options={listado.map(opcionDeSesion)}
                value={sesionId ?? ''}
                onChange={(event) => cambiarSesion(event.target.value)}
                fullWidth
                helperText={
                  listado.length > 1
                    ? `${listado.length} sesiones — puede haber varias del mismo vehículo si se usó más de un teléfono.`
                    : undefined
                }
              />
            </div>
            <PanelFrescura
              datos={datos}
              sesion={sesion}
              recibidoEn={traza.dataUpdatedAt}
              sesionesRecibidoEn={sesiones.dataUpdatedAt}
            />
          </div>
        </Card>
      )}

      {sesionId && (
        <>
          {presentacion.esFalla && (
            <Alert variant="danger" title={`${presentacion.etiqueta} — el teléfono no sincroniza`}>
              {presentacion.descripcion}
            </Alert>
          )}

          {estado === 'detenido' && (
            // No es `Alert`: ese componente fija `role="alert"` (equivale a
            // `aria-live="assertive"`) y este aviso se monta/desmonta en cada poll de 10 s —
            // "vehículo detenido" no es una falla (ver `PRESENTACION_FRESCURA`), así que no
            // amerita interrumpir al lector de pantalla cada vez. Mismo markup que `Alert`,
            // con `aria-live="polite"` en vez de `role="alert"`.
            <div className="qv-alert qv-alert--info" aria-live="polite">
              <strong className="qv-alert__title">Vehículo detenido</strong>
              <div className="qv-alert__body">{presentacion.descripcion}</div>
            </div>
          )}

          {finalizada && (
            <Alert variant="info" title="Sesión finalizada">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>Esta sesión ya cerró. El recorrido completo se ve en el histórico.</span>
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push(`/reportes/recorridos/${sesionId}`)}
                  >
                    Ver en el histórico
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {pollPausado && (
            <Alert variant="warning" title="Seguimiento en pausa">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>
                  No llega nada al servidor desde hace{' '}
                  {formatearAntiguedad(datos?.inactivaDesdeMs ?? null)}, así que el panel dejó de
                  consultar. Las sesiones no se cierran solas, por eso el corte se mide por
                  inactividad real y no por la hora de fin.
                </span>
                <span>
                  <Button size="sm" variant="secondary" onClick={() => void traza.refetch()}>
                    Reanudar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {traza.isError && datos && (
            <Alert variant="warning" title="No se pudo actualizar la traza">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>
                  {mensajeError(traza.error)} — se sigue mostrando la última posición conocida.
                </span>
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Reintentar cargar traza"
                    onClick={() => void traza.refetch()}
                  >
                    Reintentar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {traza.isError && !datos && (
            <Alert variant="danger" title="No se pudo cargar la traza">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>{mensajeError(traza.error)}</span>
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Reintentar cargar traza"
                    onClick={() => void traza.refetch()}
                  >
                    Reintentar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {datos && !datos.completa && !datos.hayMas && (
            <Alert variant="warning" title="Traza incompleta">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>
                  Se dibujaron {datos.puntos.length} de {datos.totalPuntos} puntos: falta un tramo.
                </span>
                <span>
                  <Button size="sm" variant="secondary" onClick={recargarTraza}>
                    Recargar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {contexto.isError && (
            <Alert variant="danger" title="No se pudo cargar la ruta de la sesión">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>{mensajeError(contexto.error)}</span>
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Reintentar cargar ruta"
                    onClick={() => void contexto.refetch()}
                  >
                    Reintentar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {contexto.data && datos && datos.puntos.length === 0 && (
            // No es `Alert` (ver el aviso "Vehículo detenido" más arriba, mismo motivo): esto
            // no es una falla, solo el estado normal antes del primer fix.
            <div className="qv-alert qv-alert--info" aria-live="polite">
              <strong className="qv-alert__title">Esperando el primer punto GPS</strong>
              <div className="qv-alert__body">
                La ruta y los puntos de control ya están dibujados. En cuanto el teléfono
                sincronice su primer fix, el vehículo aparece en el mapa.
              </div>
            </div>
          )}

          <RouteMap
            height="520px"
            loading={contexto.isLoading}
            routes={routes}
            markers={markers}
            zones={zones}
            fitMode="once"
            fitKey={sesionId}
            followPoint={
              seguir && ultimoPunto ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng } : null
            }
            onUserPan={() => setSeguir(false)}
          />

          {/* `RouteMap` no expone ningún `aria-*` propio y la única descripción de cada punto
              de control (cumplido/distancia) vive en un popup de Leaflet, solo alcanzable con
              mouse. Este resumen textual repite esa misma información para lectores de
              pantalla — oculto visualmente con `.qv-visually-hidden` (ya existe en el design
              system), no oculto del árbol de accesibilidad. */}
          {contexto.data && (
            <div className="qv-visually-hidden">
              <h2>Puntos de control</h2>
              <ul>
                {contexto.data.puntosControl.map((pc, index) => {
                  const cumplimiento = ultimaPasada(datos, pc.id);
                  return (
                    <li key={pc.id}>
                      Punto de control {index + 1}:{' '}
                      {cumplimiento
                        ? `${cumplimiento.cumplido ? 'cumplido' : 'no cumplido'}, a ${cumplimiento.distanciaM.toFixed(0)} metros`
                        : 'todavía sin pasada validada'}
                    </li>
                  );
                })}
              </ul>
              <p>
                {ultimoPunto
                  ? `Última posición conocida: ${new Date(ultimoPunto.ts).toLocaleTimeString('es-BO')}.`
                  : 'Todavía no hay ninguna posición conocida.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Las **dos** antigüedades, siempre juntas: `antiguedadFixMs` dice cuándo se capturó la
 * última posición y `antiguedadIngestaMs` cuándo llegó al servidor. Separadas distinguen
 * "el vehículo está parado" (fix viejo, ingesta fresca) de "el teléfono no sincroniza"
 * (las dos viejas), que es justo lo que hace útil la pantalla. Ambas se miden contra el
 * reloj del servidor vía `servidorTs`.
 */
function PanelFrescura({
  datos,
  sesion,
  recibidoEn,
  sesionesRecibidoEn,
}: {
  datos: TrazaAcumulada | undefined;
  sesion: SesionEnVivoResumen | undefined;
  recibidoEn: number;
  sesionesRecibidoEn: number;
}) {
  // El tick de 1 Hz vive ACÁ, no en `EnVivoPage`: si estuviera arriba, forzaría un re-render
  // de toda la página (mapa incluido) cada segundo — `RouteMap` recompondría marcadores,
  // reiniciando la animación `qv-pulse` del vehículo antes de que complete un ciclo.
  // Confinado a esta hoja, el tick solo repinta este panel de texto.
  const ahora = useReloj();
  const fuente = datos ?? sesion;
  if (!fuente) return <Loader label="Cargando estado…" />;

  // El listado se refresca cada 30 s y la traza cada 10 s: si los datos vienen del listado
  // (todavía no llegó la primera respuesta de `posiciones`, o la query de traza está en error
  // sin data), la referencia tiene que ser el `dataUpdatedAt` de ESA query — el reloj del
  // navegador en el momento real en que esa respuesta llegó —, no `servidorTs` parseado como
  // si fuera un `recibidoEnMs`: eso da un offset de EXACTAMENTE 0 en `offsetRelojServidorMs`
  // (`Date.parse(servidorTs) - Date.parse(servidorTs)`), así que `antiguedadViva` termina
  // comparando `Date.now()` contra `ts` sin corregir el reloj del navegador — el bug preciso
  // que existe para evitar. Con `sesionesRecibidoEn` la antigüedad queda congelada hasta el
  // próximo refresco del listado, pero nunca desincronizada del reloj del servidor.
  const referencia = datos ? recibidoEn : sesionesRecibidoEn;
  const presentacion = PRESENTACION_FRESCURA[fuente.estadoFrescura];
  const antiguedadFix = antiguedadViva(fuente.ultimoFixTs, fuente.servidorTs, referencia, ahora);
  const antiguedadIngesta = antiguedadViva(
    fuente.ultimoIngresoTs,
    fuente.servidorTs,
    referencia,
    ahora,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', minWidth: '18rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          aria-hidden
          style={{
            width: '0.625rem',
            height: '0.625rem',
            borderRadius: '50%',
            background: presentacion.color,
            display: 'inline-block',
          }}
        />
        {/* Solo la etiqueta va en `aria-live`: cambia por poll (cada 10 s), no cada segundo
            como las dos líneas de antigüedad de abajo — envolverlas también spamearía al
            lector de pantalla. */}
        <span aria-live="polite" aria-atomic="true">
          <strong>{presentacion.etiqueta}</strong>
        </span>
        {datos && (
          <Tag variant="neutral">
            {datos.puntos.length} punto{datos.puntos.length === 1 ? '' : 's'}
          </Tag>
        )}
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última posición capturada hace{' '}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatearAntiguedad(antiguedadFix)}
        </strong>
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última sincronización al servidor hace{' '}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatearAntiguedad(antiguedadIngesta)}
        </strong>
      </span>
    </div>
  );
}

/** Re-renderiza cada segundo para que las antigüedades corran solas entre polls. Vive dentro
 * de `PanelFrescura` (ver el comentario ahí) para no forzar un re-render de toda la página. */
function useReloj(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

function opcionDeSesion(sesion: SesionEnVivoResumen) {
  const dispositivo = sesion.deviceId.slice(0, 8);
  const estado = PRESENTACION_FRESCURA[sesion.estadoFrescura].etiqueta;
  return {
    value: sesion.id,
    label: `${sesion.vehiculoPlaca} · ${sesion.lineaNombre} · ${sesion.conductorNombre} · ${dispositivo} — ${estado}`,
  };
}

function construirRutas(contexto: ContextoEnVivo, traza: TrazaAcumulada | undefined): MapRoute[] {
  const rutas: MapRoute[] = [
    {
      id: 'ruta-asignada',
      label: 'Ruta asignada',
      color: contexto.linea.color,
      dashed: true,
      points: contexto.ruta.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    },
  ];
  if (traza && traza.puntos.length > 1) {
    rutas.push({
      id: 'traza-gps',
      label: 'Recorrido real',
      color: COLOR_TRAZA,
      points: traza.puntos.map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
  return rutas;
}

/**
 * Última pasada validada de un punto de control (no la primera). El server ya devuelve
 * `cumplimientos` ordenado `ts asc` (`en-vivo.service.ts`), así que el último elemento que
 * matchea es el más reciente.
 *
 * `CumplimientoPc` modela explícitamente varias pasadas por `(sesionId, puntoControlId)` con
 * la columna `pasada` (multi-vuelta, `schema.prisma`): un `.find()` (primera coincidencia) se
 * queda pegado a la primera pasada de la sesión — un punto de control fallado en la vuelta 1
 * y cumplido en la vuelta 2 quedaría "No cumplido" en el mapa el resto del día.
 */
function ultimaPasada(
  traza: TrazaAcumulada | undefined,
  puntoControlId: string,
): CumplimientoRecorrido | undefined {
  if (!traza) return undefined;
  let ultimo: CumplimientoRecorrido | undefined;
  for (const c of traza.cumplimientos) {
    if (c.puntoControlId === puntoControlId && c.validadoPor === 'worker') ultimo = c;
  }
  return ultimo;
}

function construirMarcadores(
  contexto: ContextoEnVivo,
  traza: TrazaAcumulada | undefined,
  colorVehiculo: string,
): MapPoint[] {
  const marcadores: MapPoint[] = contexto.puntosControl.map((pc, index) => {
    const cumplimiento = ultimaPasada(traza, pc.id);
    const cumplido = cumplimiento?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label: `Punto de control ${index + 1}`,
      description: cumplimiento
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimiento.distanciaM.toFixed(0)} m`
        : 'Todavía sin pasada validada',
      // `MapPoint.color` termina en `buildDivIcon` (`route-map-impl.tsx`), que lo escribe
      // como custom property CSS en un `style` inline (`--qv-map-pin-color:${color}`) — a
      // diferencia de `pathOptions.color` de Leaflet (ver `construirZonas`), acá `var()` SÍ
      // se resuelve.
      color: cumplido ? 'var(--qv-color-success)' : 'var(--qv-text-muted)',
      pinType: 'stop',
    };
  });

  const ultimo = traza?.puntos.at(-1);
  if (ultimo) {
    marcadores.push({
      lat: ultimo.lat,
      lng: ultimo.lng,
      label: `${contexto.vehiculo.placa} — última posición`,
      description: new Date(ultimo.ts).toLocaleTimeString('es-BO'),
      color: colorVehiculo,
      pinType: 'pulse',
    });
  }
  return marcadores;
}

function construirZonas(contexto: ContextoEnVivo): MapZone[] {
  return contexto.puntosControl.map((pc, index) => ({
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
    radiusMeters: pc.radioToleranciaM,
    label: `Tolerancia PC ${index + 1}`,
    // Hex literal a propósito, NO `var(--qv-text-muted)`: este color va a `pathOptions.color`/
    // `fillColor` de un `Circle` de Leaflet (`route-map-impl.tsx`), que termina en los
    // atributos de presentación SVG `stroke`/`fill` — ahí `var()` nunca se resuelve (a
    // diferencia de `construirMarcadores`, donde el color va a un `style` inline vía
    // `buildDivIcon`). Mismo valor que el token `--qv-text-muted` claro; no reacciona a
    // `prefers-color-scheme` en oscuro.
    color: '#94a3b8',
  }));
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
