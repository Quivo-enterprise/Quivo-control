import { useEffect, useMemo, useState } from 'react';
import type {
  EstadoPublicacion,
  Linea,
  Parada,
  PuntoControl,
  Ruta,
  TipoParada,
  Variante,
} from '@quivo/shared';
import type { MapPoint } from '@quivo/design-system';
import { lineasApi } from '../../../src/lib/api/lineas';
import { rutasApi } from '../../../src/lib/api/rutas';
import { paradasApi } from '../../../src/lib/api/paradas';
import { puntosControlApi } from '../../../src/lib/api/puntos-control';
import { variantesApi } from '../../../src/lib/api/variantes';
import { ApiError } from '../../../src/lib/api/client';
import { mobilityPublicationsApi } from '../../../src/lib/api/mobility-publications';
import { invertirElementosOrdenados, invertirTipoParada } from './route-utils';
import type { BorradorInverso } from './use-route-drawing';

interface ResultadoCopiaInversa {
  paradas: Parada[];
  puntosControl: PuntoControl[];
  fallos: number;
}

const SIGUIENTE_PUBLICACION: Record<EstadoPublicacion, EstadoPublicacion | null> = {
  borrador: 'validado',
  validado: 'publicado',
  publicado: 'validado',
  archivado: 'borrador',
};

function valoresCumplidos<T>(results: PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

/**
 * Encapsula todo lo que persiste contra el API: líneas/rutas/paradas/puntos de control/
 * variantes, sus mutaciones, y el flujo de publicación para pasajeros. El modo de dibujo del
 * mapa (`use-route-drawing.ts`) es un consumidor de este hook, no vive acá — así que las
 * mutaciones que dependen de estado de dibujo (guardarRuta/guardarParada/guardarPuntoControl)
 * reciben esos valores como parámetros en vez de leerlos de un estado compartido.
 */
export function useRutasData(token: string) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [lineaId, setLineaId] = useState<string>('');
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [rutaId, setRutaId] = useState<string>('');
  const [paradas, setParadas] = useState<Parada[]>([]);
  const [puntosControl, setPuntosControl] = useState<PuntoControl[]>([]);
  const [variantes, setVariantes] = useState<Variante[]>([]);

  const [confirmarBaja, setConfirmarBaja] = useState<{
    tipo: 'parada' | 'puntoControl' | 'variante';
    id: string;
  } | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);

  const [loadingLineas, setLoadingLineas] = useState(true);
  const [loadingRutas, setLoadingRutas] = useState(false);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!token) {
      setLineas([]);
      setLoadingLineas(false);
      return;
    }
    let cancelado = false;
    setLoadingLineas(true);
    setError(null);
    lineasApi
      .listar(token)
      .then((lista) => {
        if (!cancelado) setLineas(lista);
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingLineas(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !lineaId) {
      setRutas([]);
      setRutaId('');
      setLoadingRutas(false);
      return;
    }
    let cancelado = false;
    setLoadingRutas(true);
    setError(null);
    rutasApi
      .listarPorLinea(token, lineaId)
      .then((lista) => {
        if (cancelado) return;
        setRutas(lista);
        setRutaId((actual) => (lista.some((ruta) => ruta.id === actual) ? actual : ''));
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingRutas(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, lineaId, revision]);

  useEffect(() => {
    if (!token || !rutaId) {
      setParadas([]);
      setPuntosControl([]);
      setVariantes([]);
      setLoadingDetalle(false);
      return;
    }
    let cancelado = false;
    setLoadingDetalle(true);
    setError(null);
    Promise.all([
      paradasApi.listarPorRuta(token, rutaId),
      puntosControlApi.listarPorRuta(token, rutaId),
      variantesApi.listarPorRuta(token, rutaId),
    ])
      .then(([p, pc, v]) => {
        if (cancelado) return;
        setParadas(p);
        setPuntosControl(pc);
        setVariantes(v);
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingDetalle(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, rutaId, revision]);

  const rutaSeleccionada = useMemo(
    () => rutas.find((r) => r.id === rutaId) ?? null,
    [rutas, rutaId],
  );
  const lineaSeleccionada = useMemo(
    () => lineas.find((linea) => linea.id === lineaId) ?? null,
    [lineas, lineaId],
  );

  // No limpia `borradorInverso`: ese estado vive en `use-route-drawing.ts`, no acá. Los dos
  // call sites de `limpiarDetalleRuta` (cambiar de línea, seleccionar otra ruta) siempre
  // llaman también a `drawing.cancelarModo()`, que sí lo resetea — el efecto neto es idéntico
  // al original.
  function limpiarDetalleRuta() {
    setParadas([]);
    setPuntosControl([]);
    setVariantes([]);
    setConfirmarBaja(null);
  }

  function refrescarDatos() {
    setError(null);
    setAviso(null);
    setRevision((actual) => actual + 1);
  }

  async function copiarDatosInversos(
    rutaDestinoId: string,
    borrador: BorradorInverso,
    copiarParadasInversas: boolean,
    copiarControlesInversos: boolean,
  ): Promise<ResultadoCopiaInversa> {
    if (!token) return { paradas: [], puntosControl: [], fallos: 0 };
    const paradasInvertidas = invertirElementosOrdenados(borrador.paradas);
    const controlesInvertidos = invertirElementosOrdenados(borrador.puntosControl);
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

  async function guardarRuta(input: {
    puntosPendientes: MapPoint[];
    editandoTrazado: boolean;
    sentido: string;
    borradorInverso: BorradorInverso | null;
    copiarParadasInversas: boolean;
    copiarControlesInversos: boolean;
  }): Promise<boolean> {
    const { puntosPendientes, editandoTrazado, sentido, borradorInverso } = input;
    if (!token || puntosPendientes.length < 2) return false;
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
        setAviso('Trazado actualizado correctamente.');
      } else {
        const nueva = await rutasApi.crear(token, lineaId, {
          sentido,
          estado: 'activo',
          geometria,
        });
        setRutas((prev) => [nueva, ...prev]);
        const resultadoCopia = borradorInverso
          ? await copiarDatosInversos(
              nueva.id,
              borradorInverso,
              input.copiarParadasInversas,
              input.copiarControlesInversos,
            )
          : { paradas: [], puntosControl: [], fallos: 0 };
        setRutaId(nueva.id);
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
          setAviso('Ruta creada correctamente. Ahora puedes agregar paradas y puntos de control.');
        }
      }
      return true;
    } catch (err) {
      setError(mensajeError(err));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCambiosRuta(sentido: string, estado: Ruta['estado']) {
    if (!token || !rutaId) return;
    setGuardando(true);
    setError(null);
    try {
      const actualizada = await rutasApi.actualizar(token, rutaId, { sentido, estado });
      setRutas((prev) => prev.map((r) => (r.id === actualizada.id ? actualizada : r)));
      setAviso('Datos de la ruta actualizados.');
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function guardarParada(input: {
    puntoPendiente: MapPoint | null;
    ordenParada: string;
    tipoParada: TipoParada;
    editandoParadaId: string | null;
  }): Promise<boolean> {
    const { puntoPendiente, ordenParada, tipoParada, editandoParadaId } = input;
    if (!token || !puntoPendiente || !rutaId) return false;
    const orden = Number(ordenParada);
    if (!Number.isInteger(orden) || orden < 0) {
      setError('El orden de la parada debe ser un número entero igual o mayor a cero.');
      return false;
    }
    if (paradas.some((parada) => parada.orden === orden && parada.id !== editandoParadaId)) {
      setError(`Ya existe una parada con el orden ${orden}.`);
      return false;
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
      return true;
    } catch (err) {
      setError(mensajeError(err));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPuntoControl(input: {
    puntoPendiente: MapPoint | null;
    ordenParada: string;
    radioTolerancia: string;
    obligatorio: boolean;
    editandoPuntoControlId: string | null;
  }): Promise<boolean> {
    const { puntoPendiente, ordenParada, radioTolerancia, obligatorio, editandoPuntoControlId } =
      input;
    if (!token || !puntoPendiente || !rutaId) return false;
    const orden = Number(ordenParada);
    const radio = Number(radioTolerancia);
    if (!Number.isInteger(orden) || orden < 0) {
      setError('El orden del punto de control debe ser un número entero igual o mayor a cero.');
      return false;
    }
    if (!Number.isInteger(radio) || radio <= 0) {
      setError('El radio de tolerancia debe ser un número entero mayor a cero.');
      return false;
    }
    if (
      puntosControl.some((punto) => punto.orden === orden && punto.id !== editandoPuntoControlId)
    ) {
      setError(`Ya existe un punto de control con el orden ${orden}.`);
      return false;
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
        const creado = await puntosControlApi.crear(token, rutaId, {
          ...payload,
          estado: 'activo',
        });
        setPuntosControl((prev) => [...prev, creado]);
      }
      setAviso(
        editandoPuntoControlId ? 'Punto de control actualizado.' : 'Punto de control agregado.',
      );
      return true;
    } catch (err) {
      setError(mensajeError(err));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function guardarVariante(nombre: string): Promise<boolean> {
    if (!token || !rutaId || !nombre.trim()) return false;
    setGuardando(true);
    setError(null);
    try {
      const creada = await variantesApi.crear(token, rutaId, {
        nombre: nombre.trim(),
        estado: 'activo',
      });
      setVariantes((prev) => [...prev, creada]);
      setAviso('Variante agregada.');
      return true;
    } catch (err) {
      setError(mensajeError(err));
      return false;
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

  async function avanzarPublicacionDelRecorrido() {
    if (!token || !rutaSeleccionada || !lineaSeleccionada) return;
    const nextStatus = SIGUIENTE_PUBLICACION[rutaSeleccionada.publicStatus];
    const paradasActivas = paradas.filter((parada) => parada.estado === 'activo');

    if (!nextStatus) return;
    if (paradasActivas.length === 0) {
      setError('Agrega al menos una parada activa antes de preparar este recorrido para pasajeros.');
      return;
    }
    if (
      lineaSeleccionada.publicStatus !== rutaSeleccionada.publicStatus &&
      lineaSeleccionada.publicStatus !== nextStatus
    ) {
      setError('La línea debe estar en el mismo estado de publicación que el recorrido.');
      return;
    }
    if (
      paradasActivas.some(
        (parada) =>
          parada.publicStatus !== rutaSeleccionada.publicStatus &&
          parada.publicStatus !== nextStatus,
      )
    ) {
      setError('Todas las paradas activas deben estar en el mismo estado de publicación que el recorrido.');
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const tasks = [
        mobilityPublicationsApi.actualizar(token, 'rutas', rutaSeleccionada.id, nextStatus),
        ...paradasActivas
          .filter((parada) => parada.publicStatus === rutaSeleccionada.publicStatus)
          .map((parada) => mobilityPublicationsApi.actualizar(token, 'paradas', parada.id, nextStatus)),
      ];
      if (lineaSeleccionada.publicStatus === rutaSeleccionada.publicStatus) {
        tasks.push(mobilityPublicationsApi.actualizar(token, 'lineas', lineaSeleccionada.id, nextStatus));
      }
      await Promise.all(tasks);

      setLineas((prev) =>
        prev.map((linea) =>
          linea.id === lineaSeleccionada.id && linea.publicStatus === rutaSeleccionada.publicStatus
            ? { ...linea, publicStatus: nextStatus }
            : linea,
        ),
      );
      setRutas((prev) =>
        prev.map((ruta) =>
          ruta.id === rutaSeleccionada.id ? { ...ruta, publicStatus: nextStatus } : ruta,
        ),
      );
      setParadas((prev) =>
        prev.map((parada) =>
          parada.estado === 'activo' && parada.publicStatus === rutaSeleccionada.publicStatus
            ? { ...parada, publicStatus: nextStatus }
            : parada,
        ),
      );
      setAviso(
        nextStatus === 'publicado'
          ? 'Recorrido, línea y paradas activas ya están visibles en la app de pasajeros.'
          : 'Recorrido, línea y paradas activas validados. Revísalos y vuelve a presionar para publicarlos.',
      );
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return {
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
    guardarRuta,
    guardarCambiosRuta,
    guardarParada,
    guardarPuntoControl,
    guardarVariante,
    reactivar,
    confirmarBajaHandler,
    avanzarPublicacionDelRecorrido,
  };
}
