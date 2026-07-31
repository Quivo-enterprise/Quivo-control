'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Loader,
  PageHeader,
  RouteMap,
  Select,
  Tag,
  type MapPoint,
} from '@quivo/design-system';
import type { Linea, Parada, PuntoControl, Ruta, TipoParada, Variante } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { lineasApi } from '../../../src/lib/api/lineas';
import { rutasApi } from '../../../src/lib/api/rutas';
import { paradasApi } from '../../../src/lib/api/paradas';
import { puntosControlApi } from '../../../src/lib/api/puntos-control';
import { variantesApi } from '../../../src/lib/api/variantes';
import { ApiError } from '../../../src/lib/api/client';

type Modo = 'ver' | 'dibujar-ruta' | 'agregar-parada' | 'agregar-punto-control';

const TIPOS_PARADA: { label: string; value: TipoParada }[] = [
  { label: 'Origen', value: 'origen' },
  { label: 'Intermedia', value: 'intermedia' },
  { label: 'Destino', value: 'destino' },
];

/** RF-24..33 (QUI-229) — editor visual de rutas sobre `RouteMap` (Leaflet, ver design
 * system) contra el API real de QUI-225/226. Sin biblioteca de mapas nueva: se reutiliza
 * el componente ya construido en vez de duplicar esa lógica en apps/web. */
export default function RutasPage() {
  const { token } = useAuth();

  const [lineas, setLineas] = useState<Linea[]>([]);
  const [lineaId, setLineaId] = useState<string>('');
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [rutaId, setRutaId] = useState<string>('');
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [puntosControl, setPuntosControl] = useState<PuntoControl[]>([]);
  const [variantes, setVariantes] = useState<Variante[]>([]);

  const [modo, setModo] = useState<Modo>('ver');
  const [puntosPendientes, setPuntosPendientes] = useState<MapPoint[]>([]);
  const [puntoPendiente, setPuntoPendiente] = useState<MapPoint | null>(null);

  const [sentido, setSentido] = useState('ida');
  const [tipoParada, setTipoParada] = useState<TipoParada>('intermedia');
  const [ordenParada, setOrdenParada] = useState('0');
  const [radioTolerancia, setRadioTolerancia] = useState('30');
  const [obligatorio, setObligatorio] = useState(true);
  const [nombreVariante, setNombreVariante] = useState('');

  const [loadingLineas, setLoadingLineas] = useState(true);
  const [loadingRutas, setLoadingRutas] = useState(false);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoadingLineas(true);
    lineasApi
      .listar(token)
      .then(setLineas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoadingLineas(false));
  }, [token]);

  useEffect(() => {
    if (!token || !lineaId) {
      setRutas([]);
      return;
    }
    setLoadingRutas(true);
    setRutaId('');
    rutasApi
      .listarPorLinea(token, lineaId)
      .then(setRutas)
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoadingRutas(false));
  }, [token, lineaId]);

  useEffect(() => {
    if (!token || !rutaId) {
      setParadas([]);
      setPuntosControl([]);
      setVariantes([]);
      return;
    }
    setLoadingDetalle(true);
    Promise.all([
      paradasApi.listarPorRuta(token, rutaId),
      puntosControlApi.listarPorRuta(token, rutaId),
      variantesApi.listarPorRuta(token, rutaId),
    ])
      .then(([p, pc, v]) => {
        setParadas(p);
        setPuntosControl(pc);
        setVariantes(v);
      })
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoadingDetalle(false));
  }, [token, rutaId]);

  const rutaSeleccionada = useMemo(() => rutas.find((r) => r.id === rutaId) ?? null, [rutas, rutaId]);

  function empezarDibujo() {
    setError(null);
    setRutaId('');
    setPuntosPendientes([]);
    setModo('dibujar-ruta');
  }

  function cancelarModo() {
    setModo('ver');
    setPuntosPendientes([]);
    setPuntoPendiente(null);
    setError(null);
  }

  function onMapClick(point: MapPoint) {
    if (modo === 'dibujar-ruta') {
      setPuntosPendientes((prev) => [...prev, point]);
    } else if (modo === 'agregar-parada' || modo === 'agregar-punto-control') {
      setPuntoPendiente(point);
    }
  }

  async function guardarRuta() {
    if (!token || puntosPendientes.length < 2) return;
    setGuardando(true);
    setError(null);
    try {
      const nueva = await rutasApi.crear(token, lineaId, {
        sentido,
        estado: 'activo',
        geometria: {
          type: 'LineString',
          coordinates: puntosPendientes.map((p) => [p.lng, p.lat]),
        },
      });
      setRutas((prev) => [nueva, ...prev]);
      setRutaId(nueva.id);
      cancelarModo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarParada() {
    if (!token || !puntoPendiente || !rutaId) return;
    setGuardando(true);
    setError(null);
    try {
      const creada = await paradasApi.crear(token, rutaId, {
        tipo: tipoParada,
        orden: Number(ordenParada),
        coord: { type: 'Point', coordinates: [puntoPendiente.lng, puntoPendiente.lat] },
      });
      setParadas((prev) => [...prev, creada]);
      cancelarModo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPuntoControl() {
    if (!token || !puntoPendiente || !rutaId) return;
    setGuardando(true);
    setError(null);
    try {
      const creado = await puntosControlApi.crear(token, rutaId, {
        orden: Number(ordenParada),
        radioToleranciaM: Number(radioTolerancia),
        obligatorio,
        coord: { type: 'Point', coordinates: [puntoPendiente.lng, puntoPendiente.lat] },
      });
      setPuntosControl((prev) => [...prev, creado]);
      cancelarModo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarVariante() {
    if (!token || !rutaId || !nombreVariante.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const creada = await variantesApi.crear(token, rutaId, { nombre: nombreVariante.trim() });
      setVariantes((prev) => [...prev, creada]);
      setNombreVariante('');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const rutasParaMapa =
    modo === 'dibujar-ruta'
      ? [{ id: 'pendiente', points: puntosPendientes, dashed: true }]
      : rutaSeleccionada
        ? [
            {
              id: rutaSeleccionada.id,
              points: rutaSeleccionada.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
            },
          ]
        : [];

  const stopsParaMapa: MapPoint[] = paradas.map((p) => ({
    lat: p.coord.coordinates[1],
    lng: p.coord.coordinates[0],
    label: `Parada (${p.tipo})`,
    description: `Orden ${p.orden}`,
    pinType: 'stop',
  }));

  const zonasParaMapa = puntosControl.map((pc) => ({
    lat: pc.coord.coordinates[1],
    lng: pc.coord.coordinates[0],
    radiusMeters: pc.radioToleranciaM,
    label: `Punto de control (orden ${pc.orden}${pc.obligatorio ? ', obligatorio' : ''})`,
  }));

  const markersParaMapa: MapPoint[] = puntoPendiente
    ? [{ ...puntoPendiente, label: 'Punto marcado', pinType: 'pulse' }]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader title="Rutas" subtitle="RF-24..33 — editor sobre mapa (QUI-229)." />
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Card header="Línea">
            {loadingLineas ? (
              <Loader label="Cargando líneas..." />
            ) : (
              <Select
                id="linea"
                name="linea"
                options={[
                  { label: 'Seleccionar...', value: '' },
                  ...lineas.map((l) => ({ label: `${l.codigo} — ${l.nombre}`, value: l.id })),
                ]}
                value={lineaId}
                onChange={(event) => {
                  setLineaId(event.target.value);
                  cancelarModo();
                }}
              />
            )}
          </Card>

          {lineaId && (
            <Card
              header="Rutas"
              footer={
                <Button size="sm" onClick={empezarDibujo} disabled={modo === 'dibujar-ruta'}>
                  + Nueva ruta
                </Button>
              }
            >
              {loadingRutas ? (
                <Loader label="Cargando rutas..." />
              ) : rutas.length === 0 ? (
                <span>Sin rutas todavía.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {rutas.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setRutaId(r.id);
                        cancelarModo();
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        border: 'none',
                        cursor: 'pointer',
                        background: r.id === rutaId ? 'var(--qv-color-primary)' : 'transparent',
                        color: r.id === rutaId ? '#fff' : 'inherit',
                      }}
                    >
                      Sentido: {r.sentido} <Tag>{r.estado}</Tag>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}

          {modo === 'dibujar-ruta' && (
            <Card header="Nueva ruta">
              <p>Hacé click en el mapa para agregar puntos a la línea ({puntosPendientes.length} puntos).</p>
              <Input
                label="Sentido"
                value={sentido}
                onChange={(event) => setSentido(event.target.value)}
                placeholder="ida / vuelta"
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPuntosPendientes((prev) => prev.slice(0, -1))}
                  disabled={puntosPendientes.length === 0}
                >
                  Deshacer último
                </Button>
                <Button size="sm" onClick={guardarRuta} disabled={puntosPendientes.length < 2 || guardando}>
                  {guardando ? 'Guardando...' : 'Guardar ruta'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelarModo}>
                  Cancelar
                </Button>
              </div>
            </Card>
          )}

          {rutaSeleccionada && modo === 'ver' && (
            <>
              <Card
                header="Paradas"
                footer={
                  <Button size="sm" onClick={() => setModo('agregar-parada')}>
                    + Agregar parada
                  </Button>
                }
              >
                {loadingDetalle ? <Loader label="Cargando..." /> : <span>{paradas.length} paradas</span>}
              </Card>

              <Card
                header="Puntos de control"
                footer={
                  <Button size="sm" onClick={() => setModo('agregar-punto-control')}>
                    + Agregar punto de control
                  </Button>
                }
              >
                {loadingDetalle ? <Loader label="Cargando..." /> : <span>{puntosControl.length} puntos</span>}
              </Card>

              <Card header="Variantes">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {variantes.map((v) => (
                    <Tag key={v.id}>{v.nombre}</Tag>
                  ))}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <Input
                      placeholder="Nombre de variante"
                      value={nombreVariante}
                      onChange={(event) => setNombreVariante(event.target.value)}
                    />
                    <Button size="sm" onClick={guardarVariante} disabled={!nombreVariante.trim() || guardando}>
                      Agregar
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}

          {(modo === 'agregar-parada' || modo === 'agregar-punto-control') && (
            <Card header={modo === 'agregar-parada' ? 'Nueva parada' : 'Nuevo punto de control'}>
              <p>Hacé click en el mapa para marcar la ubicación.</p>
              {modo === 'agregar-parada' ? (
                <Select
                  label="Tipo"
                  id="tipoParada"
                  name="tipoParada"
                  options={TIPOS_PARADA}
                  value={tipoParada}
                  onChange={(event) => setTipoParada(event.target.value as TipoParada)}
                />
              ) : (
                <>
                  <Input
                    label="Radio de tolerancia (m)"
                    type="number"
                    value={radioTolerancia}
                    onChange={(event) => setRadioTolerancia(event.target.value)}
                  />
                  <Checkbox
                    label="Obligatorio"
                    checked={obligatorio}
                    onChange={(event) => setObligatorio(event.target.checked)}
                  />
                </>
              )}
              <Input
                label="Orden"
                type="number"
                value={ordenParada}
                onChange={(event) => setOrdenParada(event.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <Button
                  size="sm"
                  onClick={modo === 'agregar-parada' ? guardarParada : guardarPuntoControl}
                  disabled={!puntoPendiente || guardando}
                >
                  {guardando ? 'Guardando...' : 'Guardar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelarModo}>
                  Cancelar
                </Button>
              </div>
            </Card>
          )}
        </div>

        <RouteMap
          height="640px"
          interactive={modo !== 'ver'}
          onMapClick={onMapClick}
          routes={rutasParaMapa}
          stops={modo === 'ver' ? stopsParaMapa : []}
          zones={modo === 'ver' ? zonasParaMapa : []}
          markers={markersParaMapa}
        />
      </div>
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
