'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  RouteMap,
  Select,
  Tag,
  type MapPoint,
  type MapRoute,
  type MapZone,
} from '@quivo/design-system';
import type { ContextoEnVivo, SesionEnVivoResumen } from '@quivo/shared';
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
  const ahora = useReloj();

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

      {sesiones.isLoading && <span>Cargando sesiones...</span>}

      {sesiones.isError && (
        <Alert variant="danger" title="No se pudo cargar el listado de sesiones">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span>{mensajeError(sesiones.error)}</span>
            <span>
              <Button size="sm" variant="secondary" onClick={() => void sesiones.refetch()}>
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
              ahora={ahora}
              recibidoEn={traza.dataUpdatedAt}
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
            <Alert variant="info" title="Vehículo detenido">
              {presentacion.descripcion}
            </Alert>
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
              {mensajeError(traza.error)} — se sigue mostrando la última posición conocida.
            </Alert>
          )}

          {traza.isError && !datos && (
            <Alert variant="danger" title="No se pudo cargar la traza">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span>{mensajeError(traza.error)}</span>
                <span>
                  <Button size="sm" variant="secondary" onClick={() => void traza.refetch()}>
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
                  <Button size="sm" variant="secondary" onClick={() => void contexto.refetch()}>
                    Reintentar
                  </Button>
                </span>
              </div>
            </Alert>
          )}

          {contexto.data && datos && datos.puntos.length === 0 && (
            <Alert variant="info" title="Esperando el primer punto GPS">
              La ruta y los puntos de control ya están dibujados. En cuanto el teléfono sincronice
              su primer fix, el vehículo aparece en el mapa.
            </Alert>
          )}

          <RouteMap
            height="520px"
            loading={contexto.isLoading}
            routes={contexto.data ? construirRutas(contexto.data, datos) : []}
            markers={
              contexto.data ? construirMarcadores(contexto.data, datos, presentacion.color) : []
            }
            zones={contexto.data ? construirZonas(contexto.data) : []}
            fitMode="once"
            fitKey={sesionId}
            followPoint={
              seguir && ultimoPunto ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng } : null
            }
            onUserPan={() => setSeguir(false)}
          />
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
  ahora,
  recibidoEn,
}: {
  datos: TrazaAcumulada | undefined;
  sesion: SesionEnVivoResumen | undefined;
  ahora: number;
  recibidoEn: number;
}) {
  const fuente = datos ?? sesion;
  if (!fuente) return <span>Cargando estado...</span>;

  // El listado se refresca cada 30 s y la traza cada 10 s: si los datos vienen del listado,
  // el `dataUpdatedAt` de la traza no aplica y se usa el `servidorTs` de esa misma respuesta
  // como referencia (antigüedad congelada hasta el próximo refresco, nunca adelantada).
  const referencia = datos ? recibidoEn : Date.parse(fuente.servidorTs);
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
        <strong>{presentacion.etiqueta}</strong>
        {datos && (
          <Tag variant="neutral">
            {datos.puntos.length} punto{datos.puntos.length === 1 ? '' : 's'}
          </Tag>
        )}
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última posición capturada hace <strong>{formatearAntiguedad(antiguedadFix)}</strong>
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última sincronización al servidor hace{' '}
        <strong>{formatearAntiguedad(antiguedadIngesta)}</strong>
      </span>
    </div>
  );
}

/** Re-renderiza cada segundo para que las antigüedades corran solas entre polls. */
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

function construirMarcadores(
  contexto: ContextoEnVivo,
  traza: TrazaAcumulada | undefined,
  colorVehiculo: string,
): MapPoint[] {
  const marcadores: MapPoint[] = contexto.puntosControl.map((pc, index) => {
    const cumplimiento = traza?.cumplimientos.find(
      (c) => c.puntoControlId === pc.id && c.validadoPor === 'worker',
    );
    const cumplido = cumplimiento?.cumplido ?? false;
    return {
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      label: `Punto de control ${index + 1}`,
      description: cumplimiento
        ? `${cumplido ? 'Cumplido' : 'No cumplido'} — ${cumplimiento.distanciaM.toFixed(0)} m`
        : 'Todavía sin pasada validada',
      color: cumplido ? '#16a34a' : '#94a3b8',
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
    color: '#94a3b8',
  }));
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
