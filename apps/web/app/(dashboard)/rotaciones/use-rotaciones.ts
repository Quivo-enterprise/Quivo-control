import { useEffect, useState } from 'react';
import type { Asignacion, Conductor, Linea, Ruta, Turno, Vehiculo } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { lineasApi } from '../../../src/lib/api/lineas';
import { rutasApi } from '../../../src/lib/api/rutas';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { rotacionesApi, type RotacionConAsignaciones } from '../../../src/lib/api/rotaciones';

export interface RutaConLinea extends Ruta {
  linea: Linea;
}

/**
 * Encapsula el catálogo de un sindicato (líneas/rutas/vehículos/conductores), sus rotaciones
 * y las mutaciones (generar/publicar/anular/refrescar) — la página solo conoce este contrato,
 * no cómo se obtienen ni se persisten los datos.
 */
export function useRotaciones(token: string | null, sindicatoId: string) {
  const [rutas, setRutas] = useState<RutaConLinea[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [rotaciones, setRotaciones] = useState<RotacionConAsignaciones[]>([]);
  const [rotacionActual, setRotacionActual] = useState<RotacionConAsignaciones | null>(null);

  const [loadingCatalogo, setLoadingCatalogo] = useState(false);
  const [loadingRotaciones, setLoadingRotaciones] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoGeneracion, setAvisoGeneracion] = useState<string | null>(null);

  // Catálogo del sindicato (líneas/rutas/vehículos/conductores) — todos filtrados en el
  // cliente por `sindicatoId`, porque para `admin_quivo` esos endpoints devuelven todos los
  // tenants mezclados (no tienen un query param de filtro, ver QUI-220..224).
  useEffect(() => {
    if (!token || !sindicatoId) {
      setRutas([]);
      setVehiculos([]);
      setConductores([]);
      setLoadingCatalogo(false);
      return;
    }
    let cancelado = false;
    setLoadingCatalogo(true);
    setError(null);
    Promise.all([lineasApi.listar(token), vehiculosApi.listar(token), conductoresApi.listar(token)])
      .then(async ([todasLineas, todosVehiculos, todosConductores]) => {
        const lineasDelSindicato = todasLineas.filter((l) => l.sindicatoId === sindicatoId);

        const rutasPorLinea = await Promise.all(
          lineasDelSindicato.map((linea) =>
            rutasApi.listarPorLinea(token, linea.id).then((rs) => rs.map((r) => ({ ...r, linea }))),
          ),
        );
        if (cancelado) return;
        setVehiculos(todosVehiculos.filter((v) => v.sindicatoId === sindicatoId));
        setConductores(todosConductores.filter((c) => c.sindicatoId === sindicatoId));
        setRutas(rutasPorLinea.flat());
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingCatalogo(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId]);

  useEffect(() => {
    if (!token || !sindicatoId) {
      setRotaciones([]);
      setRotacionActual(null);
      setLoadingRotaciones(false);
      return;
    }
    let cancelado = false;
    setLoadingRotaciones(true);
    rotacionesApi
      .listar(token)
      .then(async (lista) => {
        const propias = lista.filter((r) => r.sindicatoId === sindicatoId);
        const conDetalle = await Promise.all(
          propias.map((r) => rotacionesApi.obtener(token, r.id)),
        );
        if (cancelado) return;
        setRotaciones(conDetalle);
        setRotacionActual((actual) =>
          actual ? (conDetalle.find((rotacion) => rotacion.id === actual.id) ?? null) : null,
        );
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingRotaciones(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId]);

  /** Limpia todo lo que este hook posee — usado al cambiar de sindicato (`admin_quivo`). */
  function reset() {
    setRutas([]);
    setVehiculos([]);
    setConductores([]);
    setRotaciones([]);
    setRotacionActual(null);
    setAvisoGeneracion(null);
    setError(null);
  }

  async function refrescarRotacion(id: string) {
    if (!token) return;
    const actualizada = await rotacionesApi.obtener(token, id);
    setRotaciones((prev) => prev.map((r) => (r.id === id ? actualizada : r)));
    setRotacionActual((prev) => (prev?.id === id ? actualizada : prev));
  }

  async function generarRotacion(
    params: {
      esAdminQuivo: boolean;
      periodo: string;
      fechas: Date[];
      rutaIds: string[];
      horarios: Turno[];
    },
    onSuccess: () => void,
  ) {
    if (!token || !sindicatoId) return;
    setGenerando(true);
    setError(null);
    setAvisoGeneracion(null);
    try {
      const nueva = await rotacionesApi.generar(token, {
        sindicatoId: params.esAdminQuivo ? sindicatoId : undefined,
        periodo: params.periodo,
        rutaIds: params.rutaIds,
        fechas: params.fechas,
        horarios: params.horarios,
      });
      setRotaciones((prev) => [nueva, ...prev]);
      setRotacionActual(nueva);
      const avisos: string[] = [];
      const totalPedido = params.fechas.length * params.horarios.length * params.rutaIds.length;
      if (nueva.asignaciones.length < totalPedido) {
        avisos.push(
          `Se generaron ${nueva.asignaciones.length} de ${totalPedido} asignaciones — el resto quedó sin vehículo disponible en esa fecha y horario.`,
        );
      }
      if (nueva.sinCobertura.length > 0) {
        const detalle = nueva.sinCobertura
          .map(({ vehiculoId, rutaId }) => {
            const placa = vehiculos.find((v) => v.id === vehiculoId)?.placa ?? vehiculoId;
            const ruta = rutas.find((r) => r.id === rutaId);
            const etiquetaRuta = ruta ? `${ruta.linea.nombre} (${ruta.sentido})` : rutaId;
            return `${placa} → ${etiquetaRuta}`;
          })
          .join(', ');
        avisos.push(
          `${nueva.sinCobertura.length} vehículo(s) no llegaron a cubrir alguna ruta pedida en este período (agenda sin slots libres): ${detalle}.`,
        );
      }
      if (avisos.length > 0) setAvisoGeneracion(avisos.join(' '));
      onSuccess();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGenerando(false);
    }
  }

  async function publicar(rotacionId: string) {
    if (!token) return;
    setProcesando(true);
    setError(null);
    try {
      await rotacionesApi.publicar(token, rotacionId);
      await refrescarRotacion(rotacionId);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setProcesando(false);
    }
  }

  async function anular(rotacionId: string) {
    if (!token) return;
    setProcesando(true);
    setError(null);
    try {
      await rotacionesApi.anular(token, rotacionId);
      await refrescarRotacion(rotacionId);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setProcesando(false);
    }
  }

  return {
    rutas,
    vehiculos,
    conductores,
    rotaciones,
    rotacionActual,
    setRotacionActual,
    loadingCatalogo,
    loadingRotaciones,
    generando,
    procesando,
    error,
    avisoGeneracion,
    reset,
    refrescarRotacion,
    generarRotacion,
    publicar,
    anular,
  };
}

export function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

export type { Asignacion, RotacionConAsignaciones };
