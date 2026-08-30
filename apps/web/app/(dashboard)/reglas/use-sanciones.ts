import { useEffect, useState } from 'react';
import type { Conductor, EstadoSancion, Regla, Sancion, Socio, Vehiculo } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { reglasApi } from '../../../src/lib/api/reglas';
import { sancionesApi } from '../../../src/lib/api/sanciones';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { sociosApi } from '../../../src/lib/api/socios';

// Mismo límite fijo que sanciones.service.ts.
const TAMANO_PAGINA = 200;

export type Transicion = 'aplicar' | 'anular' | 'apelar' | 'pagar';

export interface FiltrosSanciones {
  estado: EstadoSancion | '';
  reglaId: string;
}

export const FILTROS_SANCIONES_VACIOS: FiltrosSanciones = { estado: '', reglaId: '' };

function aFiltrosSanciones(sindicatoId: string, { estado, reglaId }: FiltrosSanciones) {
  return {
    sindicatoId,
    estado: estado || undefined,
    reglaId: reglaId || undefined,
  };
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

/**
 * Encapsula sanciones para un sindicato: catálogos (reglas/vehículos/conductores/socios,
 * para poblar el modal de nueva sanción), el listado filtrado y paginado server-side, y las
 * transiciones de estado — la página solo conoce este contrato.
 */
export function useSanciones(token: string | null, sindicatoId: string) {
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [sanciones, setSanciones] = useState<Sancion[]>([]);

  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filtrosAplicados, setFiltrosAplicados] =
    useState<FiltrosSanciones>(FILTROS_SANCIONES_VACIOS);

  // Reglas/vehículos/conductores/socios: catálogos chicos, se recargan solo al cambiar de
  // sindicato (los usa el modal de nueva sanción para poblar selects).
  useEffect(() => {
    if (!token || !sindicatoId) {
      setReglas([]);
      setVehiculos([]);
      setConductores([]);
      setSocios([]);
      return;
    }
    let cancelado = false;
    setError(null);
    Promise.all([
      reglasApi.listar(token),
      vehiculosApi.listar(token),
      conductoresApi.listar(token),
      sociosApi.listar(token),
    ])
      .then(([r, v, c, s]) => {
        if (cancelado) return;
        setReglas(r.filter((x) => x.sindicatoId === sindicatoId));
        setVehiculos(v.filter((x) => x.sindicatoId === sindicatoId));
        setConductores(c.filter((x) => x.sindicatoId === sindicatoId));
        setSocios(s.filter((x) => x.sindicatoId === sindicatoId));
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId]);

  // Sanciones: filtradas y paginadas server-side (puede crecer sin límite con el tiempo, a
  // diferencia de los catálogos). Los filtros se aplican explícitamente para no consultar
  // mientras se está eligiendo un estado o una regla.
  useEffect(() => {
    if (!token || !sindicatoId) {
      setSanciones([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setError(null);
    setHasMore(false);
    sancionesApi
      .listar(token, aFiltrosSanciones(sindicatoId, filtrosAplicados))
      .then((rows) => {
        if (cancelado) return;
        setSanciones(rows);
        setHasMore(rows.length === TAMANO_PAGINA);
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId, filtrosAplicados]);

  async function cargarMas() {
    if (!token || !sindicatoId) return;
    setCargandoMas(true);
    setError(null);
    try {
      const rows = await sancionesApi.listar(token, {
        ...aFiltrosSanciones(sindicatoId, filtrosAplicados),
        skip: sanciones.length,
      });
      setSanciones((actual) => [...actual, ...rows]);
      setHasMore(rows.length === TAMANO_PAGINA);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargandoMas(false);
    }
  }

  async function refrescar() {
    if (!token || !sindicatoId) return;
    const lista = await sancionesApi.listar(
      token,
      aFiltrosSanciones(sindicatoId, filtrosAplicados),
    );
    setSanciones(lista);
    setHasMore(lista.length === TAMANO_PAGINA);
  }

  async function aplicarTransicion(sancion: Sancion, transicion: Transicion) {
    if (!token) return;
    await sancionesApi[transicion](token, sancion.id);
    await refrescar();
  }

  return {
    reglas,
    vehiculos,
    conductores,
    socios,
    sanciones,
    loading,
    cargandoMas,
    hasMore,
    error,
    filtrosAplicados,
    setFiltrosAplicados,
    cargarMas,
    refrescar,
    aplicarTransicion,
  };
}
