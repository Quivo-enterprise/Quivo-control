'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Input,
  Loader,
  PageHeader,
  RouteMap,
  Select,
  StatusBadge,
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
import {
  calcularDistanciaRutaKm,
  capitalizar,
  filtrarRutas,
  formatearDistancia,
  invertirElementosOrdenados,
  invertirPuntosTrazado,
  invertirTipoParada,
  type FiltroEstadoRuta,
} from './route-utils';
import { RoutePointList } from './route-point-list';

type Modo = 'ver' | 'dibujar-ruta' | 'agregar-parada' | 'agregar-punto-control';

interface BorradorInverso {
  paradas: Parada[];
  puntosControl: PuntoControl[];
}

interface ResultadoCopiaInversa {
  paradas: Parada[];
  puntosControl: PuntoControl[];
  fallos: number;
}

function valoresCumplidos<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

const TIPOS_PARADA: { label: string; value: TipoParada }[] = [
  { label: 'Origen', value: 'origen' },
  { label: 'Intermedia', value: 'intermedia' },
  { label: 'Destino', value: 'destino' },
];

// `sentido` viaja como texto libre en el contrato (RutaSchema, packages/shared) porque
// Producto no confirmó si alguna línea puede tener más de dos sentidos (ej. circular).
// Acá se restringe a los dos valores reales que usa hoy toda línea de colectivo urbano —
// evita typos ("Ida"/"IDA"/"ida ") que romperían el agrupamiento visual en el mapa.
const SENTIDOS: { label: string; value: string }[] = [
  { label: 'Ida', value: 'ida' },
  { label: 'Vuelta', value: 'vuelta' },
];

const ESTADOS_RUTA: { label: string; value: Ruta['estado'] }[] = [
  { label: 'Activo', value: 'activo' },
  { label: 'Inactivo', value: 'inactivo' },
];

const COLORES_RUTA = ['#007f86', '#ff6b35', '#6750a4', '#1976d2', '#2e7d32', '#c62828'];

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
  const [puntosInicialesTrazado, setPuntosInicialesTrazado] = useState<MapPoint[]>([]);
  const [puntosRehacer, setPuntosRehacer] = useState<MapPoint[]>([]);
  const [nodoSeleccionadoIndex, setNodoSeleccionadoIndex] = useState<number | null>(null);
  const [puntoPendiente, setPuntoPendiente] = useState<MapPoint | null>(null);
  const [editandoTrazado, setEditandoTrazado] = useState(false);
  const [editandoParadaId, setEditandoParadaId] = useState<string | null>(null);
  const [editandoPuntoControlId, setEditandoPuntoControlId] = useState<string | null>(null);

  const [sentido, setSentido] = useState('ida');
  const [sentidoRutaEdit, setSentidoRutaEdit] = useState('ida');
  const [estadoRutaEdit, setEstadoRutaEdit] = useState<Ruta['estado']>('activo');
  const [tipoParada, setTipoParada] = useState<TipoParada>('intermedia');
  const [ordenParada, setOrdenParada] = useState('0');
  const [radioTolerancia, setRadioTolerancia] = useState('30');
  const [obligatorio, setObligatorio] = useState(true);
  const [nombreVariante, setNombreVariante] = useState('');
  const [filtroSentido, setFiltroSentido] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoRuta>('todos');
  const [mostrarTodas, setMostrarTodas] = useState(true);
  const [borradorInverso, setBorradorInverso] = useState<BorradorInverso | null>(null);
  const [copiarParadasInversas, setCopiarParadasInversas] = useState(true);
  const [copiarControlesInversos, setCopiarControlesInversos] = useState(true);
  const [confirmarBaja, setConfirmarBaja] = useState<
    { tipo: 'parada' | 'puntoControl' | 'variante'; id: string } | null
  >(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  const [loadingLineas, setLoadingLineas] = useState(true);
  const [loadingRutas, setLoadingRutas] = useState(false);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [revision, setRevision] = useState(0);

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
    rutasApi
      .listarPorLinea(token, lineaId)
      .then((lista) => {
        setRutas(lista);
        setRutaId((actual) => (lista.some((ruta) => ruta.id === actual) ? actual : ''));
      })
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoadingRutas(false));
  }, [token, lineaId, revision]);

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
  }, [token, rutaId, revision]);

  const rutaSeleccionada = useMemo(
    () => rutas.find((r) => r.id === rutaId) ?? null,
    [rutas, rutaId],
  );
  const lineaSeleccionada = useMemo(
    () => lineas.find((linea) => linea.id === lineaId) ?? null,
    [lineas, lineaId],
  );
  const rutasFiltradas = useMemo(
    () => filtrarRutas(rutas, filtroSentido, filtroEstado),
    [rutas, filtroSentido, filtroEstado],
  );

  useEffect(() => {
    if (rutaSeleccionada) {
      setSentidoRutaEdit(rutaSeleccionada.sentido);
      setEstadoRutaEdit(rutaSeleccionada.estado);
    }
  }, [rutaSeleccionada]);

  function empezarDibujo() {
    setError(null);
    setAviso(null);
    setRutaId('');
    setPuntosPendientes([]);
    setPuntosInicialesTrazado([]);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(false);
    setBorradorInverso(null);
    setModo('dibujar-ruta');
  }

  function empezarEdicionTrazado() {
    if (!rutaSeleccionada) return;
    setError(null);
    setAviso(null);
    const puntosActuales = rutaSeleccionada.geometria.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
    setPuntosPendientes(puntosActuales);
    setPuntosInicialesTrazado(puntosActuales);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(true);
    setBorradorInverso(null);
    setModo('dibujar-ruta');
  }

  function empezarRecorridoInverso() {
    if (!rutaSeleccionada) return;
    const sentidoInverso = rutaSeleccionada.sentido === 'vuelta' ? 'ida' : 'vuelta';
    const puntosInvertidos = invertirPuntosTrazado(
      rutaSeleccionada.geometria.coordinates.map(([lng, lat]) => ({ lat, lng })),
    );
    setError(null);
    setAviso(
      `Se preparó un borrador de ${sentidoInverso} invirtiendo el trazado. Revísalo antes de guardar.`,
    );
    setSentido(sentidoInverso);
    setPuntosPendientes(puntosInvertidos);
    setPuntosInicialesTrazado([]);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(false);
    setBorradorInverso({
      paradas: paradas.map((parada) => ({ ...parada })),
      puntosControl: puntosControl.map((punto) => ({ ...punto })),
    });
    setCopiarParadasInversas(paradas.length > 0);
    setCopiarControlesInversos(puntosControl.length > 0);
    setModo('dibujar-ruta');
  }

  function empezarAgregarParada() {
    setError(null);
    setAviso(null);
    setEditandoParadaId(null);
    setPuntoPendiente(null);
    setTipoParada('intermedia');
    setOrdenParada(String(Math.max(-1, ...paradas.map((parada) => parada.orden)) + 1));
    setModo('agregar-parada');
  }

  function empezarEdicionParada(p: Parada) {
    setError(null);
    setAviso(null);
    setEditandoParadaId(p.id);
    setTipoParada(p.tipo);
    setOrdenParada(String(p.orden));
    setPuntoPendiente({ lat: p.coord.coordinates[1], lng: p.coord.coordinates[0] });
    setModo('agregar-parada');
  }

  function empezarAgregarPuntoControl() {
    setError(null);
    setAviso(null);
    setEditandoPuntoControlId(null);
    setPuntoPendiente(null);
    setOrdenParada(String(Math.max(-1, ...puntosControl.map((punto) => punto.orden)) + 1));
    setRadioTolerancia('30');
    setObligatorio(true);
    setModo('agregar-punto-control');
  }

  function empezarEdicionPuntoControl(pc: PuntoControl) {
    setError(null);
    setAviso(null);
    setEditandoPuntoControlId(pc.id);
    setOrdenParada(String(pc.orden));
    setRadioTolerancia(String(pc.radioToleranciaM));
    setObligatorio(pc.obligatorio);
    setPuntoPendiente({ lat: pc.coord.coordinates[1], lng: pc.coord.coordinates[0] });
    setModo('agregar-punto-control');
  }

  function cancelarModo() {
    setModo('ver');
    setPuntosPendientes([]);
    setPuntosInicialesTrazado([]);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setPuntoPendiente(null);
    setEditandoTrazado(false);
    setEditandoParadaId(null);
    setEditandoPuntoControlId(null);
    setBorradorInverso(null);
    setError(null);
  }

  function onMapClick(point: MapPoint) {
    if (modo === 'dibujar-ruta') {
      setPuntosPendientes((prev) =>
        nodoSeleccionadoIndex === null
          ? [...prev, point]
          : prev.map((currentPoint, index) =>
              index === nodoSeleccionadoIndex ? point : currentPoint,
            ),
      );
      setPuntosRehacer([]);
    } else if (modo === 'agregar-parada' || modo === 'agregar-punto-control') {
      setPuntoPendiente(point);
    }
  }

  function deshacerPunto() {
    const ultimo = puntosPendientes.at(-1);
    if (!ultimo) return;
    setPuntosPendientes((prev) => prev.slice(0, -1));
    setPuntosRehacer((prev) => [...prev, ultimo]);
    setNodoSeleccionadoIndex(null);
  }

  function rehacerPunto() {
    const ultimo = puntosRehacer.at(-1);
    if (!ultimo) return;
    setPuntosPendientes((prev) => [...prev, ultimo]);
    setPuntosRehacer((prev) => prev.slice(0, -1));
    setNodoSeleccionadoIndex(null);
  }

  function restaurarTrazado() {
    setPuntosPendientes(puntosInicialesTrazado);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
  }

  function actualizarPuntosPendientes(points: MapPoint[]) {
    setPuntosPendientes(points);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
  }

  function refrescarDatos() {
    setError(null);
    setAviso(null);
    setRevision((actual) => actual + 1);
  }

  async function copiarDatosInversos(rutaDestinoId: string): Promise<ResultadoCopiaInversa> {
    if (!token || !borradorInverso) {
      return { paradas: [], puntosControl: [], fallos: 0 };
    }
    const paradasInvertidas = invertirElementosOrdenados(borradorInverso.paradas);
    const controlesInvertidos = invertirElementosOrdenados(borradorInverso.puntosControl);
    const [resultadosParadas, resultadosControles] = await Promise.all([
      copiarParadasInversas
        ? Promise.allSettled(
            paradasInvertidas.map((parada) =>
              paradasApi.crear(token, rutaDestinoId, {
                tipo: invertirTipoParada(parada.tipo),
                orden: parada.orden,
                coord: {
                  type: 'Point',
                  coordinates: [...parada.coord.coordinates] as [number, number],
                },
                estado: 'activo',
              }),
            ),
          )
        : Promise.resolve([]),
      copiarControlesInversos
        ? Promise.allSettled(
            controlesInvertidos.map((punto) =>
              puntosControlApi.crear(token, rutaDestinoId, {
                orden: punto.orden,
                radioToleranciaM: punto.radioToleranciaM,
                obligatorio: punto.obligatorio,
                coord: {
                  type: 'Point',
                  coordinates: [...punto.coord.coordinates] as [number, number],
                },
                estado: 'activo',
              }),
            ),
          )
        : Promise.resolve([]),
    ]);
    return {
      paradas: valoresCumplidos(resultadosParadas),
      puntosControl: valoresCumplidos(resultadosControles),
      fallos: [...resultadosParadas, ...resultadosControles].filter(
        (result) => result.status === 'rejected',
      ).length,
    };
  }

  async function guardarRuta() {
    if (!token || puntosPendientes.length < 2) return;
    setGuardando(true);
    setError(null);
    try {
      const geometria = {
        type: 'LineString' as const,
        coordinates: puntosPendientes.map((p): [number, number] => [p.lng, p.lat]),
      };
      if (editandoTrazado && rutaId) {
        const actualizada = await rutasApi.actualizar(token, rutaId, { geometria });
        setRutas((prev) => prev.map((r) => (r.id === actualizada.id ? actualizada : r)));
        cancelarModo();
        setAviso('Trazado actualizado correctamente.');
      } else {
        const nueva = await rutasApi.crear(token, lineaId, {
          sentido,
          estado: 'activo',
          geometria,
        });
        setRutas((prev) => [nueva, ...prev]);
        const resultadoCopia = await copiarDatosInversos(nueva.id);
        setRutaId(nueva.id);
        cancelarModo();
        if (borradorInverso) {
          setParadas(resultadoCopia.paradas);
          setPuntosControl(resultadoCopia.puntosControl);
          setAviso(
            `Ruta inversa creada con ${resultadoCopia.paradas.length} paradas y ${resultadoCopia.puntosControl.length} puntos de control copiados.`,
          );
          if (resultadoCopia.fallos > 0) {
            setError(
              `La ruta fue creada, pero ${resultadoCopia.fallos} elemento(s) no pudieron copiarse. Revisa la ruta nueva.`,
            );
          }
        } else {
          setAviso(
            'Ruta creada correctamente. Ahora puedes agregar paradas y puntos de control.',
          );
        }
      }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCambiosRuta() {
    if (!token || !rutaId) return;
    setGuardando(true);
    setError(null);
    try {
      const actualizada = await rutasApi.actualizar(token, rutaId, {
        sentido: sentidoRutaEdit,
        estado: estadoRutaEdit,
      });
      setRutas((prev) => prev.map((r) => (r.id === actualizada.id ? actualizada : r)));
      setAviso('Datos de la ruta actualizados.');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarParada() {
    if (!token || !puntoPendiente || !rutaId) return;
    const orden = Number(ordenParada);
    if (!Number.isInteger(orden) || orden < 0) {
      setError('El orden de la parada debe ser un número entero igual o mayor a cero.');
      return;
    }
    if (paradas.some((parada) => parada.orden === orden && parada.id !== editandoParadaId)) {
      setError(`Ya existe una parada con el orden ${orden}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = {
        tipo: tipoParada,
        orden,
        coord: {
          type: 'Point' as const,
          coordinates: [puntoPendiente.lng, puntoPendiente.lat] as [number, number],
        },
      };
      if (editandoParadaId) {
        const actualizada = await paradasApi.actualizar(token, editandoParadaId, payload);
        setParadas((prev) => prev.map((p) => (p.id === actualizada.id ? actualizada : p)));
      } else {
        const creada = await paradasApi.crear(token, rutaId, { ...payload, estado: 'activo' });
        setParadas((prev) => [...prev, creada]);
      }
      setAviso(editandoParadaId ? 'Parada actualizada.' : 'Parada agregada a la ruta.');
      cancelarModo();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPuntoControl() {
    if (!token || !puntoPendiente || !rutaId) return;
    const orden = Number(ordenParada);
    const radio = Number(radioTolerancia);
    if (!Number.isInteger(orden) || orden < 0) {
      setError('El orden del punto de control debe ser un número entero igual o mayor a cero.');
      return;
    }
    if (!Number.isInteger(radio) || radio <= 0) {
      setError('El radio de tolerancia debe ser un número entero mayor a cero.');
      return;
    }
    if (
      puntosControl.some((punto) => punto.orden === orden && punto.id !== editandoPuntoControlId)
    ) {
      setError(`Ya existe un punto de control con el orden ${orden}.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = {
        orden,
        radioToleranciaM: radio,
        obligatorio,
        coord: {
          type: 'Point' as const,
          coordinates: [puntoPendiente.lng, puntoPendiente.lat] as [number, number],
        },
      };
      if (editandoPuntoControlId) {
        const actualizado = await puntosControlApi.actualizar(
          token,
          editandoPuntoControlId,
          payload,
        );
        setPuntosControl((prev) => prev.map((pc) => (pc.id === actualizado.id ? actualizado : pc)));
      } else {
        const creado = await puntosControlApi.crear(token, rutaId, { ...payload, estado: 'activo' });
        setPuntosControl((prev) => [...prev, creado]);
      }
      setAviso(
        editandoPuntoControlId ? 'Punto de control actualizado.' : 'Punto de control agregado.',
      );
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
      const creada = await variantesApi.crear(token, rutaId, {
        nombre: nombreVariante.trim(),
        estado: 'activo',
      });
      setVariantes((prev) => [...prev, creada]);
      setNombreVariante('');
      setAviso('Variante agregada.');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Sin DELETE real: paradas/puntos de control/variantes se desactivan vía `estado`, mismo
  // criterio de soft-delete que el resto del dominio (module-table-page.tsx) — necesario acá
  // porque `cumplimientos_pc.puntoControlId` referencia sin FK, un DELETE real dejaría
  // historial huérfano. Reactivar no pide confirmación (no es destructivo); desactivar sí.
  async function reactivar(tipo: 'parada' | 'puntoControl' | 'variante', id: string) {
    if (!token) return;
    setCambiandoEstado(true);
    setError(null);
    try {
      if (tipo === 'parada') {
        const actualizada = await paradasApi.actualizar(token, id, { estado: 'activo' });
        setParadas((prev) => prev.map((p) => (p.id === id ? actualizada : p)));
      } else if (tipo === 'puntoControl') {
        const actualizado = await puntosControlApi.actualizar(token, id, { estado: 'activo' });
        setPuntosControl((prev) => prev.map((pc) => (pc.id === id ? actualizado : pc)));
      } else {
        const actualizada = await variantesApi.actualizar(token, id, { estado: 'activo' });
        setVariantes((prev) => prev.map((v) => (v.id === id ? actualizada : v)));
      }
      setAviso('Reactivado.');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function confirmarBajaHandler() {
    if (!token || !confirmarBaja) return;
    setCambiandoEstado(true);
    setError(null);
    try {
      const { tipo, id } = confirmarBaja;
      if (tipo === 'parada') {
        const actualizada = await paradasApi.actualizar(token, id, { estado: 'inactivo' });
        setParadas((prev) => prev.map((p) => (p.id === id ? actualizada : p)));
      } else if (tipo === 'puntoControl') {
        const actualizado = await puntosControlApi.actualizar(token, id, { estado: 'inactivo' });
        setPuntosControl((prev) => prev.map((pc) => (pc.id === id ? actualizado : pc)));
      } else {
        const actualizada = await variantesApi.actualizar(token, id, { estado: 'inactivo' });
        setVariantes((prev) => prev.map((v) => (v.id === id ? actualizada : v)));
      }
      setAviso('Dado de baja. Ya no aparece en el mapa de la ruta.');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCambiandoEstado(false);
      setConfirmarBaja(null);
    }
  }

  const colorLinea = lineaSeleccionada?.color || 'var(--qv-color-primary)';
  const seleccionadaCoincideConFiltros = rutasFiltradas.some(
    (ruta) => ruta.id === rutaSeleccionada?.id,
  );
  const rutasVisibles =
    mostrarTodas || !rutaSeleccionada || !seleccionadaCoincideConFiltros
      ? rutasFiltradas
      : [rutaSeleccionada];
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
    modo === 'dibujar-ruta'
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
        }));

  const stopsParaMapa: MapPoint[] = paradas
    .filter((p) => p.estado === 'activo')
    .map((p) => ({
      lat: p.coord.coordinates[1],
      lng: p.coord.coordinates[0],
      label: `Parada (${p.tipo})`,
      description: `Orden ${p.orden}`,
      pinType: 'stop',
      color: p.tipo === 'origen' ? '#2e7d32' : p.tipo === 'destino' ? '#c62828' : colorLinea,
    }));

  const zonasParaMapa = puntosControl
    .filter((pc) => pc.estado === 'activo')
    .map((pc) => ({
      lat: pc.coord.coordinates[1],
      lng: pc.coord.coordinates[0],
      radiusMeters: pc.radioToleranciaM,
      label: `Punto de control (orden ${pc.orden}${pc.obligatorio ? ', obligatorio' : ''})`,
      color: colorLinea,
    }));

  const primerPuntoPendiente = puntosPendientes[0];
  const ultimoPuntoPendiente = puntosPendientes.at(-1);
  const markersParaMapa: MapPoint[] = puntoPendiente
    ? [{ ...puntoPendiente, label: 'Punto marcado', pinType: 'pulse' }]
    : modo === 'dibujar-ruta' && nodoSeleccionado && nodoSeleccionadoIndex !== null
      ? [
          {
            ...nodoSeleccionado,
            label: `Nodo ${nodoSeleccionadoIndex + 1} seleccionado`,
            description: 'Haz clic en el mapa para moverlo',
            pinType: 'pulse',
            color: '#ff6b35',
          },
        ]
      : modo === 'dibujar-ruta' && primerPuntoPendiente
      ? [
          {
            ...primerPuntoPendiente,
            label: 'Inicio del recorrido',
            description: 'Nodo 1',
            pinType: 'pin',
            color: '#2e7d32',
          },
          ...(ultimoPuntoPendiente && puntosPendientes.length > 1
            ? [
                {
                  ...ultimoPuntoPendiente,
                  label: 'Final del recorrido',
                  description: `Nodo ${puntosPendientes.length}`,
                  pinType: 'pin' as const,
                  color: '#c62828',
                },
              ]
            : []),
        ]
      : [];

  const distanciaSeleccionada = rutaSeleccionada
    ? calcularDistanciaRutaKm(rutaSeleccionada.geometria.coordinates)
    : null;
  const distanciaPendiente = calcularDistanciaRutaKm(
    puntosPendientes.map((punto): [number, number] => [punto.lng, punto.lat]),
  );
  const rutasActivas = rutas.filter((ruta) => ruta.estado === 'activo').length;
  const ordenNumero = Number(ordenParada);
  const ordenValido =
    ordenParada.trim() !== '' && Number.isInteger(ordenNumero) && ordenNumero >= 0;
  const radioNumero = Number(radioTolerancia);
  const radioValido =
    radioTolerancia.trim() !== '' && Number.isInteger(radioNumero) && radioNumero > 0;
  const formularioUbicacionValido =
    Boolean(puntoPendiente) && ordenValido && (modo !== 'agregar-punto-control' || radioValido);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Rutas"
        subtitle="Diseña trazados, organiza paradas y configura puntos de control para cada línea."
      />
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}
      {aviso && (
        <Alert variant="success" title="Listo">
          {aviso}
        </Alert>
      )}

      {lineaId && (
        <section className="routes-metrics" aria-label="Resumen operativo de rutas">
          <div className="routes-metric">
            <span>Rutas activas</span>
            <strong>{rutasActivas}</strong>
            <small>de {rutas.length} registradas</small>
          </div>
          <div className="routes-metric">
            <span>Distancia</span>
            <strong>
              {distanciaSeleccionada === null ? '—' : formatearDistancia(distanciaSeleccionada)}
            </strong>
            <small>{rutaSeleccionada ? 'ruta seleccionada' : 'selecciona una ruta'}</small>
          </div>
          <div className="routes-metric">
            <span>Paradas</span>
            <strong>{rutaSeleccionada ? paradas.length : '—'}</strong>
            <small>{rutaSeleccionada ? 'en esta ruta' : 'selecciona una ruta'}</small>
          </div>
          <div className="routes-metric">
            <span>Controles</span>
            <strong>{rutaSeleccionada ? puntosControl.length : '—'}</strong>
            <small>
              {rutaSeleccionada
                ? `${puntosControl.filter((p) => p.obligatorio).length} obligatorios`
                : 'selecciona una ruta'}
            </small>
          </div>
        </section>
      )}

      <div className="routes-workspace">
        <div className="routes-sidebar">
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
                  setRutaId('');
                  setFiltroSentido('todos');
                  setFiltroEstado('todos');
                  setMostrarTodas(true);
                  cancelarModo();
                }}
              />
            )}
            {lineaSeleccionada && (
              <div className="routes-line-summary">
                <span
                  className="routes-color-dot"
                  style={{ background: colorLinea }}
                  aria-hidden="true"
                />
                <span>
                  <strong>{lineaSeleccionada.codigo}</strong>
                  {lineaSeleccionada.descripcion && <small>{lineaSeleccionada.descripcion}</small>}
                </span>
              </div>
            )}
          </Card>

          {lineaId && (
            <Card
              header="Rutas"
              footer={
                <div className="routes-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={refrescarDatos}
                    disabled={loadingRutas || loadingDetalle}
                  >
                    Actualizar
                  </Button>
                  <Button size="sm" onClick={empezarDibujo} disabled={modo === 'dibujar-ruta'}>
                    + Nueva ruta
                  </Button>
                </div>
              }
            >
              {loadingRutas ? (
                <Loader label="Cargando rutas..." />
              ) : rutas.length === 0 ? (
                <span>Sin rutas todavía.</span>
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
                          setMostrarTodas(false);
                          cancelarModo();
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
                      </button>
                    ))}
                    {rutasFiltradas.length === 0 && (
                      <small>No hay rutas que coincidan con los filtros.</small>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {modo === 'dibujar-ruta' && (
            <Card header={editandoTrazado ? 'Editar trazado' : 'Nueva ruta'}>
              <p>
                {editandoTrazado
                  ? 'El trazado actual está cargado. Puedes agregar, quitar o reordenar sus nodos.'
                  : 'Haz clic sobre el mapa para agregar, en orden, los nodos del recorrido. Puedes corregirlos antes de guardar.'}
              </p>
              <div className="routes-drawing-summary">
                <span>
                  <strong>{puntosPendientes.length}</strong> nodos
                </span>
                <span>
                  <strong>{formatearDistancia(distanciaPendiente)}</strong> aproximados
                </span>
              </div>
              {!editandoTrazado && (
                <Select
                  label="Sentido"
                  id="sentido"
                  name="sentido"
                  options={SENTIDOS}
                  value={sentido}
                  onChange={(event) => setSentido(event.target.value)}
                />
              )}
              {borradorInverso && (
                <div className="routes-inverse-options">
                  <strong>Copiar configuración del recorrido original</strong>
                  <Checkbox
                    label={`Copiar ${borradorInverso.paradas.length} paradas en orden inverso`}
                    checked={copiarParadasInversas}
                    disabled={borradorInverso.paradas.length === 0}
                    onChange={(event) => setCopiarParadasInversas(event.target.checked)}
                  />
                  <Checkbox
                    label={`Copiar ${borradorInverso.puntosControl.length} puntos de control en orden inverso`}
                    checked={copiarControlesInversos}
                    disabled={borradorInverso.puntosControl.length === 0}
                    onChange={(event) => setCopiarControlesInversos(event.target.checked)}
                  />
                  <small>
                    Origen y destino intercambiarán su tipo. Las ubicaciones, radios y
                    obligatoriedad se conservarán.
                  </small>
                </div>
              )}
              <RoutePointList
                points={puntosPendientes}
                selectedIndex={nodoSeleccionadoIndex}
                onChange={actualizarPuntosPendientes}
                onSelect={setNodoSeleccionadoIndex}
              />
              {nodoSeleccionado && nodoSeleccionadoIndex !== null && (
                <div className="routes-node-move-notice" role="status">
                  <span>
                    <strong>Moviendo nodo {nodoSeleccionadoIndex + 1}</strong>
                    <small>
                      El mapa está enfocado en este tramo. Haz clic en la nueva ubicación
                      para mover el nodo.
                    </small>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setNodoSeleccionadoIndex(null)}
                  >
                    Ver recorrido completo
                  </Button>
                </div>
              )}
              <div className="routes-actions routes-actions--drawing">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={deshacerPunto}
                  disabled={puntosPendientes.length === 0}
                >
                  Deshacer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={rehacerPunto}
                  disabled={puntosRehacer.length === 0}
                >
                  Rehacer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    actualizarPuntosPendientes(invertirPuntosTrazado(puntosPendientes))
                  }
                  disabled={puntosPendientes.length < 2}
                >
                  Invertir orden
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPuntosPendientes([]);
                    setPuntosRehacer([]);
                    setNodoSeleccionadoIndex(null);
                  }}
                  disabled={puntosPendientes.length === 0}
                >
                  Limpiar
                </Button>
                {editandoTrazado && (
                  <Button size="sm" variant="ghost" onClick={restaurarTrazado}>
                    Restaurar original
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={guardarRuta}
                  disabled={puntosPendientes.length < 2 || guardando}
                >
                  {guardando
                    ? 'Guardando...'
                    : editandoTrazado
                      ? 'Guardar trazado'
                      : 'Guardar ruta'}
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
                header="Ruta seleccionada"
                footer={
                  <div className="routes-card-actions">
                    <Button size="sm" variant="ghost" onClick={empezarEdicionTrazado}>
                      Editar trazado
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={empezarRecorridoInverso}
                      disabled={loadingDetalle}
                    >
                      Crear recorrido inverso
                    </Button>
                  </div>
                }
              >
                <div className="routes-selected-summary">
                  <span>
                    <small>Longitud aproximada</small>
                    <strong>{formatearDistancia(distanciaSeleccionada ?? 0)}</strong>
                  </span>
                  <span>
                    <small>Nodos del trazado</small>
                    <strong>{rutaSeleccionada.geometria.coordinates.length}</strong>
                  </span>
                </div>
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
                <Button
                  size="sm"
                  onClick={guardarCambiosRuta}
                  disabled={
                    guardando ||
                    (sentidoRutaEdit === rutaSeleccionada.sentido &&
                      estadoRutaEdit === rutaSeleccionada.estado)
                  }
                  style={{ marginTop: '0.75rem' }}
                >
                  {guardando ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </Card>

              <Card
                header="Paradas"
                footer={
                  <Button size="sm" onClick={empezarAgregarParada}>
                    + Agregar parada
                  </Button>
                }
              >
                {loadingDetalle ? (
                  <Loader label="Cargando..." />
                ) : paradas.length === 0 ? (
                  <span>Sin paradas todavía.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {paradas
                      .slice()
                      .sort((a, b) => a.orden - b.orden)
                      .map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span style={{ opacity: p.estado === 'inactivo' ? 0.5 : 1 }}>
                            <strong>
                              #{p.orden} — {capitalizar(p.tipo)}
                            </strong>{' '}
                            {p.estado === 'inactivo' && <StatusBadge status="inactive" label="Inactiva" />}
                            <br />
                            <small className="routes-coordinate">
                              {p.coord.coordinates[1].toFixed(5)},{' '}
                              {p.coord.coordinates[0].toFixed(5)}
                            </small>
                          </span>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <Button size="sm" variant="ghost" onClick={() => empezarEdicionParada(p)}>
                              Editar
                            </Button>
                            {p.estado === 'inactivo' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={cambiandoEstado}
                                onClick={() => reactivar('parada', p.id)}
                              >
                                Reactivar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={cambiandoEstado}
                                onClick={() => setConfirmarBaja({ tipo: 'parada', id: p.id })}
                              >
                                Eliminar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </Card>

              <Card
                header="Puntos de control"
                footer={
                  <Button size="sm" onClick={empezarAgregarPuntoControl}>
                    + Agregar punto de control
                  </Button>
                }
              >
                {loadingDetalle ? (
                  <Loader label="Cargando..." />
                ) : puntosControl.length === 0 ? (
                  <span>Sin puntos todavía.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {puntosControl
                      .slice()
                      .sort((a, b) => a.orden - b.orden)
                      .map((pc) => (
                        <div
                          key={pc.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span style={{ opacity: pc.estado === 'inactivo' ? 0.5 : 1 }}>
                            <strong>
                              #{pc.orden} — radio {pc.radioToleranciaM} m
                            </strong>{' '}
                            {pc.estado === 'inactivo' && <StatusBadge status="inactive" label="Inactivo" />}
                            <br />
                            <small className="routes-coordinate">
                              {pc.obligatorio ? 'Obligatorio' : 'Opcional'} ·{' '}
                              {pc.coord.coordinates[1].toFixed(5)},{' '}
                              {pc.coord.coordinates[0].toFixed(5)}
                            </small>
                          </span>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => empezarEdicionPuntoControl(pc)}
                            >
                              Editar
                            </Button>
                            {pc.estado === 'inactivo' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={cambiandoEstado}
                                onClick={() => reactivar('puntoControl', pc.id)}
                              >
                                Reactivar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={cambiandoEstado}
                                onClick={() => setConfirmarBaja({ tipo: 'puntoControl', id: pc.id })}
                              >
                                Eliminar
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </Card>

              <Card header="Variantes">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {variantes.length === 0 && <small>Sin variantes registradas.</small>}
                  {variantes.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <span style={{ opacity: v.estado === 'inactivo' ? 0.5 : 1 }}>
                        <Tag>{v.nombre}</Tag>{' '}
                        {v.estado === 'inactivo' && <StatusBadge status="inactive" label="Inactiva" />}
                      </span>
                      {v.estado === 'inactivo' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cambiandoEstado}
                          onClick={() => reactivar('variante', v.id)}
                        >
                          Reactivar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={cambiandoEstado}
                          onClick={() => setConfirmarBaja({ tipo: 'variante', id: v.id })}
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="routes-inline-form">
                    <Input
                      placeholder="Nombre de variante"
                      value={nombreVariante}
                      onChange={(event) => setNombreVariante(event.target.value)}
                    />
                    <Button
                      size="sm"
                      onClick={guardarVariante}
                      disabled={!nombreVariante.trim() || guardando}
                    >
                      Agregar
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}

          {(modo === 'agregar-parada' || modo === 'agregar-punto-control') && (
            <Card
              header={
                modo === 'agregar-parada'
                  ? editandoParadaId
                    ? 'Editar parada'
                    : 'Nueva parada'
                  : editandoPuntoControlId
                    ? 'Editar punto de control'
                    : 'Nuevo punto de control'
              }
            >
              <p>
                {puntoPendiente
                  ? 'Haz clic en el mapa para mover la ubicación o guarda la posición actual.'
                  : 'Haz clic en el mapa para marcar la ubicación.'}
              </p>
              {puntoPendiente && (
                <div className="routes-coordinate-box">
                  <small>Ubicación seleccionada</small>
                  <strong>
                    {puntoPendiente.lat.toFixed(6)}, {puntoPendiente.lng.toFixed(6)}
                  </strong>
                </div>
              )}
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
                    min="1"
                    step="1"
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
                min="0"
                step="1"
                value={ordenParada}
                onChange={(event) => setOrdenParada(event.target.value)}
              />
              {!ordenValido && (
                <small className="routes-field-error">
                  El orden debe ser un entero igual o mayor a cero.
                </small>
              )}
              {modo === 'agregar-punto-control' && !radioValido && (
                <small className="routes-field-error">
                  El radio debe ser un entero mayor a cero.
                </small>
              )}
              <div className="routes-actions">
                <Button
                  size="sm"
                  onClick={modo === 'agregar-parada' ? guardarParada : guardarPuntoControl}
                  disabled={!formularioUbicacionValido || guardando}
                >
                  {guardando
                    ? 'Guardando...'
                    : editandoParadaId || editandoPuntoControlId
                      ? 'Guardar cambios'
                      : 'Guardar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelarModo}>
                  Cancelar
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="routes-map-shell">
          <div className="routes-map-legend" aria-label="Leyenda del mapa">
            <span>
              <i style={{ background: '#2e7d32' }} />
              Origen
            </span>
            <span>
              <i style={{ background: colorLinea }} />
              Intermedia
            </span>
            <span>
              <i style={{ background: '#c62828' }} />
              Destino
            </span>
            <span>
              <i className="routes-map-legend__zone" />
              Control
            </span>
          </div>
          <RouteMap
            className="routes-map-canvas"
            height="640px"
            interactive={modo !== 'ver'}
            onMapClick={onMapClick}
            routes={rutasParaMapa}
            stops={modo === 'ver' ? stopsParaMapa : []}
            zones={modo === 'ver' ? zonasParaMapa : []}
            markers={markersParaMapa}
            loading={loadingRutas && Boolean(lineaId)}
          />
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
        onConfirm={confirmarBajaHandler}
        onCancel={() => setConfirmarBaja(null)}
      />
    </div>
  );
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
