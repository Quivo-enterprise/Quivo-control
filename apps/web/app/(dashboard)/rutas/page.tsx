'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Input,
  Loader,
  RouteMap,
  Select,
  Tag,
  Tooltip,
  type MapPoint,
} from '@quivo/design-system';
import type { Ruta, TipoParada } from '@quivo/shared';
import {
  Check,
  ChevronRight,
  Compass,
  Edit3,
  Layers,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  RefreshCcw,
  Repeat,
  RotateCcw,
  Route,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useAdminCity } from '../../../src/lib/geo/use-admin-city';
import {
  capitalizar,
  calcularDistanciaRutaKm,
  filtrarRutas,
  formatearDistancia,
  invertirPuntosTrazado,
  type FiltroEstadoRuta,
} from './route-utils';
import { RoutePointList } from './route-point-list';
import { useRutasData } from './use-rutas-data';
import { useRouteDrawing } from './use-route-drawing';
import { ParadasCard, PuntosControlCard, VariantesCard } from './route-detail-cards';

const TIPOS_PARADA: { label: string; value: TipoParada }[] = [
  { label: 'Origen', value: 'origen' },
  { label: 'Intermedia', value: 'intermedia' },
  { label: 'Destino', value: 'destino' },
];

const SENTIDOS: { label: string; value: string }[] = [
  { label: 'Ida', value: 'ida' },
  { label: 'Vuelta', value: 'vuelta' },
];

const ESTADOS_RUTA: { label: string; value: Ruta['estado'] }[] = [
  { label: 'Activo', value: 'activo' },
  { label: 'Inactivo', value: 'inactivo' },
];

const COLORES_RUTA = ['#007f86', '#ff6b35', '#6750a4', '#1976d2', '#2e7d32', '#c62828'];

export default function RutasPage() {
  const { token } = useAuth();
  const data = useRutasData(token ?? '');
  const drawing = useRouteDrawing();

  const [sentidoRutaEdit, setSentidoRutaEdit] = useState('ida');
  const [estadoRutaEdit, setEstadoRutaEdit] = useState<Ruta['estado']>('activo');
  const [nombreVariante, setNombreVariante] = useState('');
  const [filtroSentido, setFiltroSentido] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoRuta>('todos');
  const [mostrarTodas, setMostrarTodas] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'catalogo' | 'detalle'>('catalogo');

  const {
    lineas,
    lineaId,
    setLineaId,
    rutas,
    rutaId,
    setRutaId,
    paradas,
    puntosControl,
    variantes,
    rutaSeleccionada,
    lineaSeleccionada,
    confirmarBaja,
    setConfirmarBaja,
    cambiandoEstado,
    loadingLineas,
    loadingRutas,
    loadingDetalle,
    error,
    setError,
    aviso,
    setAviso,
    guardando,
    limpiarDetalleRuta,
    refrescarDatos,
  } = data;

  const rutasFiltradas = filtrarRutas(rutas, filtroSentido, filtroEstado);
  const adminCity = useAdminCity(lineaSeleccionada?.cityId);

  useEffect(() => {
    if (rutaSeleccionada) {
      setSentidoRutaEdit(rutaSeleccionada.sentido);
      setEstadoRutaEdit(rutaSeleccionada.estado);
      setInspectorTab('detalle');
    }
  }, [rutaSeleccionada]);

  function iniciarDibujo() {
    setError(null);
    setAviso(null);
    setRutaId('');
    setDrawerOpen(true);
    drawing.empezarDibujo();
  }

  function iniciarEdicionTrazado() {
    if (!rutaSeleccionada) return;
    setError(null);
    setAviso(null);
    setDrawerOpen(true);
    drawing.empezarEdicionTrazado(rutaSeleccionada.geometria.coordinates);
  }

  function iniciarRecorridoInverso() {
    if (!rutaSeleccionada) return;
    setError(null);
    setDrawerOpen(true);
    const sentidoInverso = drawing.empezarRecorridoInverso({
      sentidoActual: rutaSeleccionada.sentido,
      coordinates: rutaSeleccionada.geometria.coordinates,
      paradas,
      puntosControl,
    });
    setAviso(
      `Se preparó un borrador de ${sentidoInverso} invirtiendo el trazado. Revísalo antes de guardar.`,
    );
  }

  function iniciarAgregarParada() {
    setError(null);
    setAviso(null);
    setDrawerOpen(true);
    drawing.empezarAgregarParada(paradas);
  }

  function iniciarEdicionParada(p: (typeof paradas)[number]) {
    setError(null);
    setAviso(null);
    setDrawerOpen(true);
    drawing.empezarEdicionParada(p);
  }

  function iniciarAgregarPuntoControl() {
    setError(null);
    setAviso(null);
    setDrawerOpen(true);
    drawing.empezarAgregarPuntoControl(puntosControl);
  }

  function iniciarEdicionPuntoControl(pc: (typeof puntosControl)[number]) {
    setError(null);
    setAviso(null);
    setDrawerOpen(true);
    drawing.empezarEdicionPuntoControl(pc);
  }

  function cancelarModo() {
    drawing.cancelarModo();
    setError(null);
  }

  async function onGuardarRuta() {
    const ok = await data.guardarRuta({
      puntosPendientes: drawing.puntosPendientes,
      editandoTrazado: drawing.editandoTrazado,
      sentido: drawing.sentido,
      borradorInverso: drawing.borradorInverso,
      copiarParadasInversas: drawing.copiarParadasInversas,
      copiarControlesInversos: drawing.copiarControlesInversos,
    });
    if (ok) cancelarModo();
  }

  async function onGuardarParada() {
    const ok = await data.guardarParada({
      puntoPendiente: drawing.puntoPendiente,
      ordenParada: drawing.ordenParada,
      tipoParada: drawing.tipoParada,
      editandoParadaId: drawing.editandoParadaId,
    });
    if (ok) cancelarModo();
  }

  async function onGuardarPuntoControl() {
    const ok = await data.guardarPuntoControl({
      puntoPendiente: drawing.puntoPendiente,
      ordenParada: drawing.ordenParada,
      radioTolerancia: drawing.radioTolerancia,
      obligatorio: drawing.obligatorio,
      editandoPuntoControlId: drawing.editandoPuntoControlId,
    });
    if (ok) cancelarModo();
  }

  async function onGuardarVariante() {
    const ok = await data.guardarVariante(nombreVariante);
    if (ok) setNombreVariante('');
  }

  const colorLinea = lineaSeleccionada?.color || 'var(--qv-color-primary)';
  const colorLineaSecundario = lineaSeleccionada?.colorSecundario || 'var(--qv-color-accent)';
  const colorLineaTerciario = lineaSeleccionada?.colorTerciario || 'var(--qv-color-primary)';
  const seleccionadaCoincideConFiltros = rutasFiltradas.some(
    (ruta) => ruta.id === rutaSeleccionada?.id,
  );
  const rutasVisibles =
    mostrarTodas || !rutaSeleccionada || !seleccionadaCoincideConFiltros
      ? rutasFiltradas
      : [rutaSeleccionada];
  const { puntosPendientes, nodoSeleccionadoIndex } = drawing;
  const nodoSeleccionado =
    nodoSeleccionadoIndex === null ? null : (puntosPendientes[nodoSeleccionadoIndex] ?? null);
  const puntosPendientesParaMapa =
    nodoSeleccionadoIndex === null
      ? puntosPendientes
      : puntosPendientes.slice(
          Math.max(0, nodoSeleccionadoIndex - 1),
          Math.min(puntosPendientes.length, nodoSeleccionadoIndex + 2),
        );
  const rutasParaMapa =
    drawing.modo === 'dibujar-ruta'
      ? [
          {
            id: 'pendiente',
            points: puntosPendientesParaMapa,
            dashed: true,
            color: colorLinea,
          },
        ]
      : rutasVisibles.map((ruta, index) => ({
          id: ruta.id,
          label: `${capitalizar(ruta.sentido)} · ${ruta.estado}`,
          color: ruta.id === rutaId ? colorLinea : COLORES_RUTA[index % COLORES_RUTA.length],
          points: ruta.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
          onClick: () => {
            setRutaId(ruta.id);
            setDrawerOpen(true);
            setInspectorTab('detalle');
          },
        }));

  const stopsParaMapa: MapPoint[] = paradas
    .filter((p) => p.estado === 'activo')
    .map((p) => ({
      id: p.id,
      lat: p.coord.coordinates[1],
      lng: p.coord.coordinates[0],
      label: `Parada #${p.orden} (${capitalizar(p.tipo)})`,
      description: 'Clic para editar en panel derecho',
      pinType: 'stop',
      color: p.tipo === 'origen' ? '#10b981' : p.tipo === 'destino' ? '#ef4444' : colorLinea,
      onClick: () => {
        setDrawerOpen(true);
        setInspectorTab('detalle');
        iniciarEdicionParada(p);
      },
    }));

  const zonasParaMapa = puntosControl
    .filter((pc) => pc.estado === 'activo')
    .map((pc) => ({
      id: pc.id,
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      radiusMeters: pc.radioToleranciaM,
      label: `Punto de control #${pc.orden} (Radio ${pc.radioToleranciaM}m${pc.obligatorio ? ' · Obligatorio' : ''})`,
      color: colorLineaSecundario,
      onClick: () => {
        setDrawerOpen(true);
        setInspectorTab('detalle');
        iniciarEdicionPuntoControl(pc);
      },
    }));

  const primerPuntoPendiente = puntosPendientes[0];
  const { puntoPendiente } = drawing;
  const markersParaMapa: MapPoint[] = puntoPendiente
    ? [
        {
          ...puntoPendiente,
          label: 'Punto marcado',
          description: 'Arrastra para reubicar',
          pinType: 'pulse',
          draggable: true,
          onDragEnd: (pos) => drawing.setPuntoPendiente(pos),
        },
      ]
    : drawing.modo === 'dibujar-ruta'
      ? puntosPendientes.map((punto, index) => {
          const esInicio = index === 0;
          const esFinal = index === puntosPendientes.length - 1 && puntosPendientes.length > 1;
          const esSeleccionado = nodoSeleccionadoIndex === index;
          return {
            id: `nodo-${index}`,
            lat: punto.lat,
            lng: punto.lng,
            label: esInicio
              ? `Nodo 1 (Inicio)`
              : esFinal
                ? `Nodo ${index + 1} (Final)`
                : `Nodo ${index + 1}`,
            description: 'Arrastra para desplazar este punto en el mapa',
            pinType: esSeleccionado ? ('pulse' as const) : ('node' as const),
            color: esInicio
              ? '#10b981'
              : esFinal
                ? '#ef4444'
                : esSeleccionado
                  ? '#ff6b35'
                  : colorLinea,
            draggable: true,
            onDragEnd: (nuevaPos: { lat: number; lng: number }) => {
              const nuevosPuntos = [...puntosPendientes];
              nuevosPuntos[index] = nuevaPos;
              drawing.actualizarPuntosPendientes(nuevosPuntos);
              drawing.setNodoSeleccionadoIndex(index);
            },
            onClick: () => {
              drawing.setNodoSeleccionadoIndex(index);
              setDrawerOpen(true);
            },
          };
        })
      : [];

  const distanciaSeleccionada = rutaSeleccionada
    ? calcularDistanciaRutaKm(rutaSeleccionada.geometria.coordinates)
    : null;
  const distanciaPendiente = calcularDistanciaRutaKm(
    puntosPendientes.map((punto): [number, number] => [punto.lng, punto.lat]),
  );
  const rutasActivas = rutas.filter((ruta) => ruta.estado === 'activo').length;
  const ordenNumero = Number(drawing.ordenParada);
  const ordenValido =
    drawing.ordenParada.trim() !== '' && Number.isInteger(ordenNumero) && ordenNumero >= 0;
  const radioNumero = Number(drawing.radioTolerancia);
  const radioValido =
    drawing.radioTolerancia.trim() !== '' && Number.isInteger(radioNumero) && radioNumero > 0;
  const formularioUbicacionValido =
    Boolean(puntoPendiente) && ordenValido && (drawing.modo !== 'agregar-punto-control' || radioValido);

  return (
    <div className="qv-route-builder-wrapper">
      {/* HUD Superior Superpuesto */}
      <div className="qv-route-hud-top">
        {/* Selector de Línea */}
        <div className="qv-route-hud-card">
          <Route size={18} style={{ color: 'var(--qv-color-primary)', flexShrink: 0 }} />
          {loadingLineas ? (
            <span style={{ fontSize: '0.8125rem' }}>Cargando líneas...</span>
          ) : (
            <div style={{ minWidth: '13rem' }}>
              <Select
                id="linea"
                name="linea"
                aria-label="Seleccionar Línea"
                options={[
                  { label: 'Seleccionar línea...', value: '' },
                  ...lineas.map((l) => ({ label: `${l.codigo} — ${l.nombre}`, value: l.id })),
                ]}
                value={lineaId}
                onChange={(event) => {
                  setLineaId(event.target.value);
                  setRutaId('');
                  limpiarDetalleRuta();
                  setFiltroSentido('todos');
                  setFiltroEstado('todos');
                  setMostrarTodas(true);
                  cancelarModo();
                }}
              />
            </div>
          )}

          {lineaSeleccionada && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.25rem' }}>
              <span
                style={{
                  width: '0.75rem',
                  height: '0.75rem',
                  borderRadius: '50%',
                  backgroundColor: colorLinea,
                  display: 'inline-block',
                }}
              />
              {lineaSeleccionada.distintivoValor && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.1rem 0.4rem',
                    borderRadius: 'var(--qv-radius-sm)',
                    backgroundColor: colorLineaTerciario,
                    color: '#ffffff',
                  }}
                >
                  {lineaSeleccionada.distintivoValor}
                </span>
              )}
            </div>
          )}
        </div>

        {/* KPIs de la Línea y Ruta */}
        {lineaId ? (
          <div className="qv-route-hud-card" style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                Rutas Activas
              </span>
              <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                {rutasActivas} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--qv-text-secondary)' }}>/ {rutas.length}</span>
              </strong>
            </div>

            <div style={{ width: '1px', height: '1.75rem', backgroundColor: 'var(--qv-border-glass)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                Distancia
              </span>
              <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                {distanciaSeleccionada === null ? '—' : formatearDistancia(distanciaSeleccionada)}
              </strong>
            </div>

            <div style={{ width: '1px', height: '1.75rem', backgroundColor: 'var(--qv-border-glass)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                Paradas
              </span>
              <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                {rutaSeleccionada ? paradas.length : '—'}
              </strong>
            </div>

            <div style={{ width: '1px', height: '1.75rem', backgroundColor: 'var(--qv-border-glass)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
                Controles
              </span>
              <strong style={{ fontSize: '0.9375rem', color: '#ffffff' }}>
                {rutaSeleccionada ? puntosControl.length : '—'}
              </strong>
            </div>
          </div>
        ) : null}

        {/* Acciones principales y Toggle de Drawer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', pointerEvents: 'auto' }}>
          {lineaId && (
            <button
              type="button"
              className="qv-floating-cta"
              onClick={iniciarDibujo}
              disabled={drawing.modo === 'dibujar-ruta'}
            >
              <Plus size={16} />
              <span>Nueva ruta</span>
            </button>
          )}

          {lineaId && (
            <button
              type="button"
              className="qv-route-hud-card"
              onClick={refrescarDatos}
              disabled={loadingRutas || loadingDetalle}
              style={{ cursor: 'pointer', padding: '0.55rem' }}
              title="Actualizar datos"
            >
              <RefreshCcw size={16} />
            </button>
          )}

          <button
            type="button"
            className="qv-route-hud-card"
            onClick={() => setDrawerOpen((prev) => !prev)}
            style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.8125rem' }}
            title={drawerOpen ? 'Ocultar explorador de herramientas' : 'Mostrar explorador de herramientas'}
          >
            {drawerOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
            <span>{drawerOpen ? 'Ocultar herramientas' : 'Herramientas'}</span>
          </button>
        </div>
      </div>

      {/* Toasts flotantes para avisos o errores */}
      {error && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-danger)', color: 'var(--qv-color-danger)' }}>
          {error}
        </div>
      )}
      {aviso && (
        <div className="qv-live-toast" style={{ borderColor: 'var(--qv-color-success)', color: 'var(--qv-color-success)' }}>
          {aviso}
        </div>
      )}

      {/* Explorador de Herramientas Superpuesto en el Lado Derecho */}
      <aside
        className={`qv-route-inspector-drawer${!drawerOpen ? ' qv-route-inspector-drawer--collapsed' : ''}`}
        aria-label="Explorador de herramientas de trazado"
      >
        <div className="qv-route-inspector-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={17} style={{ color: 'var(--qv-color-primary)' }} />
            <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>
              {drawing.modo === 'dibujar-ruta'
                ? 'Editor de Trazado'
                : drawing.modo === 'agregar-parada'
                  ? 'Marcador de Parada'
                  : drawing.modo === 'agregar-punto-control'
                    ? 'Punto de Control'
                    : 'Explorador de Rutas'}
            </strong>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--qv-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              padding: '0.25rem',
            }}
            title="Minimizar panel"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {drawing.modo === 'ver' && lineaId && (
          <div
            style={{
              display: 'flex',
              padding: '0.35rem 0.5rem',
              gap: '0.35rem',
              backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
              borderBottom: '1px solid var(--qv-border-glass)',
            }}
          >
            <button
              type="button"
              onClick={() => setInspectorTab('catalogo')}
              style={{
                flex: 1,
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--qv-radius-md)',
                fontSize: '0.75rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: inspectorTab === 'catalogo' ? 'var(--qv-color-primary)' : 'transparent',
                color: inspectorTab === 'catalogo' ? '#ffffff' : 'var(--qv-text-secondary)',
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              Catálogo ({rutasFiltradas.length})
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('detalle')}
              disabled={!rutaSeleccionada}
              style={{
                flex: 1,
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--qv-radius-md)',
                fontSize: '0.75rem',
                fontWeight: 700,
                border: 'none',
                cursor: rutaSeleccionada ? 'pointer' : 'not-allowed',
                backgroundColor: inspectorTab === 'detalle' ? 'var(--qv-color-primary)' : 'transparent',
                color: inspectorTab === 'detalle' ? '#ffffff' : 'var(--qv-text-secondary)',
                opacity: rutaSeleccionada ? 1 : 0.4,
                transition: 'all var(--qv-transition-fast)',
              }}
            >
              Detalle {rutaSeleccionada ? `· ${capitalizar(rutaSeleccionada.sentido)}` : ''}
            </button>
          </div>
        )}

        <div className="qv-route-inspector-body">
          {!lineaId ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--qv-text-muted)' }}>
              <Compass size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
              <p style={{ fontSize: '0.875rem' }}>Selecciona una línea en la barra superior para explorar y editar sus recorridos.</p>
            </div>
          ) : drawing.modo === 'dibujar-ruta' ? (
            <Card header={drawing.editandoTrazado ? 'Editar trazado' : 'Nueva ruta'}>
              <p style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
                {drawing.editandoTrazado
                  ? 'El trazado actual está cargado. Puedes agregar, quitar o reordenar sus nodos sobre el mapa.'
                  : 'Haz clic sobre el mapa para agregar secuencialmente los nodos del recorrido.'}
              </p>
              <div className="routes-drawing-summary" style={{ margin: '0.5rem 0' }}>
                <span>
                  <strong>{puntosPendientes.length}</strong> nodos
                </span>
                <span>
                  <strong>{formatearDistancia(distanciaPendiente)}</strong> aproximados
                </span>
              </div>
              {!drawing.editandoTrazado && (
                <Select
                  label="Sentido"
                  id="sentido"
                  name="sentido"
                  options={SENTIDOS}
                  value={drawing.sentido}
                  onChange={(event) => drawing.setSentido(event.target.value)}
                />
              )}
              {drawing.borradorInverso && (
                <div className="routes-inverse-options" style={{ marginTop: '0.5rem' }}>
                  <strong>Copiar configuración del recorrido original</strong>
                  <Checkbox
                    label={`Copiar ${drawing.borradorInverso.paradas.length} paradas en orden inverso`}
                    checked={drawing.copiarParadasInversas}
                    disabled={drawing.borradorInverso.paradas.length === 0}
                    onChange={(event) => drawing.setCopiarParadasInversas(event.target.checked)}
                  />
                  <Checkbox
                    label={`Copiar ${drawing.borradorInverso.puntosControl.length} puntos de control en orden inverso`}
                    checked={drawing.copiarControlesInversos}
                    disabled={drawing.borradorInverso.puntosControl.length === 0}
                    onChange={(event) => drawing.setCopiarControlesInversos(event.target.checked)}
                  />
                  <small>
                    Origen y destino intercambiarán su tipo conservando ubicaciones y radios.
                  </small>
                </div>
              )}
              <RoutePointList
                points={puntosPendientes}
                selectedIndex={nodoSeleccionadoIndex}
                onChange={drawing.actualizarPuntosPendientes}
                onSelect={drawing.setNodoSeleccionadoIndex}
              />
              {nodoSeleccionado && nodoSeleccionadoIndex !== null && (
                <div className="routes-node-move-notice" role="status" style={{ margin: '0.5rem 0' }}>
                  <span>
                    <strong>Moviendo nodo {nodoSeleccionadoIndex + 1}</strong>
                    <small>Haz clic en el mapa para mover este nodo a una nueva posición.</small>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => drawing.setNodoSeleccionadoIndex(null)}>
                    Ver todo
                  </Button>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--qv-border-glass)',
                }}
              >
                {/* Barra de herramientas encapsulada */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-secondary)' }}>
                    Herramientas de trazo
                  </span>
                  <div className="qv-table-actions-capsule qv-trace-tools-toolbar">
                    <Tooltip content="Deshacer último nodo">
                      <button
                        type="button"
                        className="qv-action-pill-btn"
                        onClick={drawing.deshacerPunto}
                        disabled={puntosPendientes.length === 0}
                        aria-label="Deshacer"
                      >
                        <Undo2 size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip content="Rehacer nodo">
                      <button
                        type="button"
                        className="qv-action-pill-btn"
                        onClick={drawing.rehacerPunto}
                        disabled={drawing.puntosRehacer.length === 0}
                        aria-label="Rehacer"
                      >
                        <Redo2 size={13} />
                      </button>
                    </Tooltip>
                    <span className="qv-action-pill-divider" />
                    <Tooltip content="Invertir dirección del trazado">
                      <button
                        type="button"
                        className="qv-action-pill-btn"
                        onClick={() => drawing.actualizarPuntosPendientes(invertirPuntosTrazado(puntosPendientes))}
                        disabled={puntosPendientes.length < 2}
                        aria-label="Invertir dirección"
                      >
                        <Repeat size={13} />
                      </button>
                    </Tooltip>
                    {drawing.editandoTrazado && (
                      <Tooltip content="Restaurar trazado original">
                        <button
                          type="button"
                          className="qv-action-pill-btn"
                          onClick={drawing.restaurarTrazado}
                          aria-label="Restaurar trazado"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </Tooltip>
                    )}
                    <span className="qv-action-pill-divider" />
                    <Tooltip content="Limpiar todos los nodos">
                      <button
                        type="button"
                        className="qv-action-pill-btn qv-action-pill-btn--danger"
                        onClick={() => drawing.actualizarPuntosPendientes([])}
                        disabled={puntosPendientes.length === 0}
                        aria-label="Limpiar nodos"
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* Botones de acción principales */}
                <div style={{ display: 'flex', gap: '0.45rem' }}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={onGuardarRuta}
                    disabled={puntosPendientes.length < 2 || guardando}
                    style={{ flex: 1 }}
                  >
                    <Check size={13} style={{ marginRight: '0.3rem' }} />
                    {guardando
                      ? 'Guardando...'
                      : drawing.editandoTrazado
                        ? 'Guardar trazado'
                        : 'Guardar ruta'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelarModo}>
                    <X size={13} style={{ marginRight: '0.25rem' }} /> Cancelar
                  </Button>
                </div>
              </div>
            </Card>
          ) : (drawing.modo === 'agregar-parada' || drawing.modo === 'agregar-punto-control') ? (
            <Card
              header={
                drawing.modo === 'agregar-parada'
                  ? drawing.editandoParadaId
                    ? 'Editar parada'
                    : 'Nueva parada'
                  : drawing.editandoPuntoControlId
                    ? 'Editar punto de control'
                    : 'Nuevo punto de control'
              }
            >
              <p style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
                {puntoPendiente
                  ? 'Haz clic en el mapa para ajustar la posición o pulsa guardar.'
                  : 'Haz clic en el mapa para marcar la ubicación deseada.'}
              </p>
              {puntoPendiente && (
                <div className="routes-coordinate-box" style={{ margin: '0.5rem 0' }}>
                  <small>Coordenadas marcadas</small>
                  <strong>
                    {puntoPendiente.lat.toFixed(6)}, {puntoPendiente.lng.toFixed(6)}
                  </strong>
                </div>
              )}
              {drawing.modo === 'agregar-parada' ? (
                <Select
                  label="Tipo"
                  id="tipoParada"
                  name="tipoParada"
                  options={TIPOS_PARADA}
                  value={drawing.tipoParada}
                  onChange={(event) => drawing.setTipoParada(event.target.value as TipoParada)}
                />
              ) : (
                <>
                  <Input
                    label="Radio de tolerancia (m)"
                    type="number"
                    min="1"
                    step="1"
                    value={drawing.radioTolerancia}
                    onChange={(event) => drawing.setRadioTolerancia(event.target.value)}
                  />
                  <Checkbox
                    label="Obligatorio"
                    checked={drawing.obligatorio}
                    onChange={(event) => drawing.setObligatorio(event.target.checked)}
                  />
                </>
              )}
              <Input
                label="Orden"
                type="number"
                min="0"
                step="1"
                value={drawing.ordenParada}
                onChange={(event) => drawing.setOrdenParada(event.target.value)}
              />
              {!ordenValido && (
                <small className="routes-field-error">
                  El orden debe ser un entero igual o mayor a cero.
                </small>
              )}
              {drawing.modo === 'agregar-punto-control' && !radioValido && (
                <small className="routes-field-error">
                  El radio debe ser un entero mayor a cero.
                </small>
              )}
              <div className="routes-actions" style={{ marginTop: '0.75rem' }}>
                <Button
                  size="sm"
                  onClick={drawing.modo === 'agregar-parada' ? onGuardarParada : onGuardarPuntoControl}
                  disabled={!formularioUbicacionValido || guardando}
                >
                  {guardando
                    ? 'Guardando...'
                    : drawing.editandoParadaId || drawing.editandoPuntoControlId
                      ? 'Guardar cambios'
                      : 'Guardar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelarModo}>
                  Cancelar
                </Button>
              </div>
            </Card>
          ) : inspectorTab === 'catalogo' ? (
            <Card
              header="Catálogo de Rutas"
              footer={
                <div className="routes-actions" style={{ justifyContent: 'space-between' }}>
                  {rutaSeleccionada ? (
                    <PublicacionAction
                      ruta={rutaSeleccionada}
                      guardando={guardando}
                      loadingDetalle={loadingDetalle}
                      onAvanzar={data.avanzarPublicacionDelRecorrido}
                    />
                  ) : <span />}
                  <Button size="sm" onClick={iniciarDibujo}>
                    + Nueva ruta
                  </Button>
                </div>
              }
            >
              {loadingRutas ? (
                <Loader label="Cargando rutas..." />
              ) : rutas.length === 0 ? (
                <span>Sin rutas registradas en esta línea.</span>
              ) : (
                <div className="routes-catalog">
                  <div className="routes-filters">
                    <Select
                      label="Sentido"
                      id="filtroSentido"
                      name="filtroSentido"
                      options={[{ label: 'Todos', value: 'todos' }, ...SENTIDOS]}
                      value={filtroSentido}
                      onChange={(event) => setFiltroSentido(event.target.value)}
                    />
                    <Select
                      label="Estado"
                      id="filtroEstado"
                      name="filtroEstado"
                      options={[{ label: 'Todos', value: 'todos' }, ...ESTADOS_RUTA]}
                      value={filtroEstado}
                      onChange={(event) => setFiltroEstado(event.target.value as FiltroEstadoRuta)}
                    />
                  </div>
                  <Checkbox
                    label="Mostrar rutas filtradas en el mapa"
                    checked={mostrarTodas}
                    onChange={(event) => setMostrarTodas(event.target.checked)}
                  />
                  <div className="routes-list">
                    {rutasFiltradas.map((r, index) => (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={r.id === rutaId}
                        onClick={() => {
                          setRutaId(r.id);
                          limpiarDetalleRuta();
                          setMostrarTodas(false);
                          cancelarModo();
                          setInspectorTab('detalle');
                        }}
                        className={`routes-list-item${r.id === rutaId ? ' routes-list-item--active' : ''}`}
                      >
                        <span
                          className="routes-color-dot"
                          style={{
                            background:
                              r.id === rutaId
                                ? colorLinea
                                : COLORES_RUTA[index % COLORES_RUTA.length],
                          }}
                          aria-hidden="true"
                        />
                        <span className="routes-list-item__copy">
                          <strong>{capitalizar(r.sentido)}</strong>
                          <small>
                            {formatearDistancia(calcularDistanciaRutaKm(r.geometria.coordinates))} ·{' '}
                            {r.geometria.coordinates.length} nodos
                          </small>
                        </span>
                        <Tag variant={r.estado === 'activo' ? 'success' : 'neutral'}>
                          {r.estado}
                        </Tag>
                        <Tag variant={r.publicStatus === 'publicado' ? 'success' : 'neutral'}>
                          {r.publicStatus === 'publicado' ? 'app' : 'privada'}
                        </Tag>
                      </button>
                    ))}
                    {rutasFiltradas.length === 0 && (
                      <small>No hay rutas que coincidan con los filtros.</small>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ) : rutaSeleccionada ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  padding: '0.85rem',
                  borderRadius: 'var(--qv-radius-lg)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 75%, transparent)',
                  border: '1px solid var(--qv-border-glass)',
                }}
              >
                {/* Encabezado de la ruta seleccionada */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Route size={17} style={{ color: 'var(--qv-color-primary)' }} />
                    <strong style={{ fontSize: '0.9rem', color: 'var(--qv-text-primary)' }}>
                      Ruta · {capitalizar(rutaSeleccionada.sentido)}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Tag variant={rutaSeleccionada.estado === 'activo' ? 'success' : 'neutral'}>
                      {rutaSeleccionada.estado}
                    </Tag>
                    <Tag variant={rutaSeleccionada.publicStatus === 'publicado' ? 'success' : 'neutral'}>
                      {rutaSeleccionada.publicStatus === 'publicado' ? 'En App' : 'Privada'}
                    </Tag>
                  </div>
                </div>

                {/* Métricas clave en tarjetas de alto contraste */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  <div
                    style={{
                      padding: '0.5rem 0.65rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 90%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                    }}
                  >
                    <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, display: 'block' }}>
                      Longitud
                    </span>
                    <strong style={{ fontSize: '0.9375rem', color: 'var(--qv-text-primary)' }}>
                      {formatearDistancia(distanciaSeleccionada ?? 0)}
                    </strong>
                  </div>

                  <div
                    style={{
                      padding: '0.5rem 0.65rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 90%, transparent)',
                      border: '1px solid var(--qv-border-glass)',
                    }}
                  >
                    <span style={{ fontSize: '0.6875rem', color: 'var(--qv-text-secondary)', fontWeight: 600, display: 'block' }}>
                      Nodos GPS
                    </span>
                    <strong style={{ fontSize: '0.9375rem', color: 'var(--qv-text-primary)' }}>
                      {rutaSeleccionada.geometria.coordinates.length} vértices
                    </strong>
                  </div>
                </div>

                {/* Acciones de trazado */}
                <div style={{ display: 'flex', gap: '0.45rem' }}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={iniciarEdicionTrazado}
                    style={{ flex: 1 }}
                  >
                    <Edit3 size={13} style={{ marginRight: '0.3rem' }} />
                    Editar trazado
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={iniciarRecorridoInverso}
                    disabled={loadingDetalle}
                    title="Crear borrador en sentido inverso"
                  >
                    <Repeat size={13} style={{ marginRight: '0.3rem' }} />
                    Invertir
                  </Button>
                </div>

                {/* Formulario rápido de Sentido y Estado */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', marginTop: '0.2rem' }}>
                  <Select
                    label="Sentido"
                    id="sentidoEdit"
                    name="sentidoEdit"
                    options={SENTIDOS}
                    value={sentidoRutaEdit}
                    onChange={(event) => setSentidoRutaEdit(event.target.value)}
                  />
                  <Select
                    label="Estado"
                    id="estadoEdit"
                    name="estadoEdit"
                    options={ESTADOS_RUTA}
                    value={estadoRutaEdit}
                    onChange={(event) => setEstadoRutaEdit(event.target.value as Ruta['estado'])}
                  />
                </div>

                {(sentidoRutaEdit !== rutaSeleccionada.sentido || estadoRutaEdit !== rutaSeleccionada.estado) && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => data.guardarCambiosRuta(sentidoRutaEdit, estadoRutaEdit)}
                    disabled={guardando}
                    style={{ width: '100%' }}
                  >
                    {guardando ? 'Guardando...' : 'Guardar cambios de sentido/estado'}
                  </Button>
                )}
              </div>

              <ParadasCard
                paradas={paradas}
                loadingDetalle={loadingDetalle}
                cambiandoEstado={cambiandoEstado}
                onAgregar={iniciarAgregarParada}
                onEditar={iniciarEdicionParada}
                onReactivar={(id) => data.reactivar('parada', id)}
                onEliminar={(id) => setConfirmarBaja({ tipo: 'parada', id })}
              />

              <PuntosControlCard
                puntosControl={puntosControl}
                loadingDetalle={loadingDetalle}
                cambiandoEstado={cambiandoEstado}
                onAgregar={iniciarAgregarPuntoControl}
                onEditar={iniciarEdicionPuntoControl}
                onReactivar={(id) => data.reactivar('puntoControl', id)}
                onEliminar={(id) => setConfirmarBaja({ tipo: 'puntoControl', id })}
              />

              <VariantesCard
                variantes={variantes}
                cambiandoEstado={cambiandoEstado}
                nombreVariante={nombreVariante}
                onNombreChange={setNombreVariante}
                onAgregar={onGuardarVariante}
                guardando={guardando}
                onReactivar={(id) => data.reactivar('variante', id)}
                onEliminar={(id) => setConfirmarBaja({ tipo: 'variante', id })}
              />
            </>
          ) : null}
        </div>
      </aside>

      {/* Lienzo del Mapa */}
      <RouteMap
        className="routes-map-canvas"
        height="100%"
        interactive={drawing.modo !== 'ver'}
        onMapClick={drawing.onMapClick}
        routes={rutasParaMapa}
        stops={drawing.modo === 'ver' ? stopsParaMapa : []}
        zones={drawing.modo === 'ver' ? zonasParaMapa : []}
        markers={markersParaMapa}
        loading={loadingRutas && Boolean(lineaId)}
        defaultCenter={adminCity.centro}
        defaultZoom={adminCity.zoom}
      />

      {/* HUD Inferior - Ciudad Operativa y Leyenda de Colores */}
      <div className="qv-route-hud-bottom" style={{ pointerEvents: 'auto' }}>
        {/* Foco de Ciudad Operativa */}
        <div
          className="qv-route-hud-card"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            fontSize: '0.8125rem',
            padding: '0.45rem 0.75rem',
          }}
          title={`Ubicación operativa: ${adminCity.ciudad.nombre} (${adminCity.ciudad.departamento})`}
        >
          <MapPin size={15} style={{ color: 'var(--qv-color-primary)' }} />
          <strong style={{ color: '#ffffff', fontSize: '0.875rem' }}>{adminCity.ciudad.nombre}</strong>
          <span
            style={{
              fontSize: '0.6875rem',
              color: 'var(--qv-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              paddingLeft: '0.25rem',
              borderLeft: '1px solid var(--qv-border-glass)',
            }}
          >
            {adminCity.ciudad.departamento}
          </span>
        </div>

        {/* Leyenda de Puntos y Colores */}
        <div
          className="qv-route-hud-card"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: '0.78rem',
            fontWeight: 600,
            gap: '0.9rem',
            padding: '0.45rem 0.75rem',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
            <i style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
            Origen
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
            <i style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: colorLinea, display: 'inline-block', boxShadow: `0 0 6px ${colorLinea}` }} />
            Intermedia
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
            <i style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: '#ef4444', display: 'inline-block', boxShadow: '0 0 6px #ef4444' }} />
            Destino
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
            <i style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: colorLineaSecundario, display: 'inline-block', boxShadow: `0 0 6px ${colorLineaSecundario}` }} />
            Control
          </span>
        </div>
      </div>


      <ConfirmDialog
        open={confirmarBaja !== null}
        title={
          confirmarBaja?.tipo === 'parada'
            ? 'Eliminar parada'
            : confirmarBaja?.tipo === 'puntoControl'
              ? 'Eliminar punto de control'
              : 'Eliminar variante'
        }
        message="Deja de aparecer en el mapa y en la ruta operativa. Se puede reactivar más adelante — no se borra el historial asociado."
        variant="danger"
        confirmLabel={cambiandoEstado ? 'Eliminando...' : 'Eliminar'}
        onConfirm={data.confirmarBajaHandler}
        onCancel={() => setConfirmarBaja(null)}
      />
    </div>
  );
}

function PublicacionAction({
  ruta,
  guardando,
  loadingDetalle,
  onAvanzar,
}: {
  ruta: Ruta;
  guardando: boolean;
  loadingDetalle: boolean;
  onAvanzar: () => void;
}) {
  const siguiente: Record<Ruta['publicStatus'], string | null> = {
    borrador: 'Validar para pasajeros',
    validado: 'Publicar en la app',
    publicado: 'Quitar de la app',
    archivado: null,
  };
  const label = siguiente[ruta.publicStatus];
  if (!label) return null;
  return (
    <Button size="sm" variant="ghost" onClick={onAvanzar} disabled={guardando || loadingDetalle}>
      {guardando ? 'Actualizando app…' : label}
    </Button>
  );
}

