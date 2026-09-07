import { useState } from 'react';
import type { MapPoint } from '@quivo/design-system';
import type { Parada, PuntoControl, TipoParada } from '@quivo/shared';
import { invertirPuntosTrazado } from './route-utils';

export type Modo = 'ver' | 'dibujar-ruta' | 'agregar-parada' | 'agregar-punto-control';

export interface BorradorInverso {
  paradas: Parada[];
  puntosControl: PuntoControl[];
}

/**
 * Encapsula el modo de edición sobre el mapa (dibujar trazado, agregar parada/punto de
 * control) — todo lo que es interacción de usuario en el editor, sin tocar el API. Las
 * funciones `guardar*` que sí persisten viven en `use-rutas-data.ts`; este hook les pasa los
 * valores que necesita como argumentos en vez de compartir estado directamente.
 */
export function useRouteDrawing() {
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
  const [tipoParada, setTipoParada] = useState<TipoParada>('intermedia');
  const [ordenParada, setOrdenParada] = useState('0');
  const [radioTolerancia, setRadioTolerancia] = useState('30');
  const [obligatorio, setObligatorio] = useState(true);
  const [borradorInverso, setBorradorInverso] = useState<BorradorInverso | null>(null);
  const [copiarParadasInversas, setCopiarParadasInversas] = useState(true);
  const [copiarControlesInversos, setCopiarControlesInversos] = useState(true);

  function empezarDibujo() {
    setPuntosPendientes([]);
    setPuntosInicialesTrazado([]);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(false);
    setBorradorInverso(null);
    setModo('dibujar-ruta');
  }

  function empezarEdicionTrazado(coordinates: [number, number][]) {
    const puntosActuales = coordinates.map(([lng, lat]) => ({ lat, lng }));
    setPuntosPendientes(puntosActuales);
    setPuntosInicialesTrazado(puntosActuales);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(true);
    setBorradorInverso(null);
    setModo('dibujar-ruta');
  }

  /** Devuelve el sentido inverso calculado, para que quien llame arme el mensaje de aviso
   * (que vive en `use-rutas-data.ts`) sin duplicar la regla `vuelta ↔ ida` acá y allá. */
  function empezarRecorridoInverso(input: {
    sentidoActual: string;
    coordinates: [number, number][];
    paradas: Parada[];
    puntosControl: PuntoControl[];
  }): string {
    const sentidoInverso = input.sentidoActual === 'vuelta' ? 'ida' : 'vuelta';
    const puntosInvertidos = invertirPuntosTrazado(
      input.coordinates.map(([lng, lat]) => ({ lat, lng })),
    );
    setSentido(sentidoInverso);
    setPuntosPendientes(puntosInvertidos);
    setPuntosInicialesTrazado([]);
    setPuntosRehacer([]);
    setNodoSeleccionadoIndex(null);
    setEditandoTrazado(false);
    setBorradorInverso({
      paradas: input.paradas.map((parada) => ({ ...parada })),
      puntosControl: input.puntosControl.map((punto) => ({ ...punto })),
    });
    setCopiarParadasInversas(input.paradas.length > 0);
    setCopiarControlesInversos(input.puntosControl.length > 0);
    setModo('dibujar-ruta');
    return sentidoInverso;
  }

  function empezarAgregarParada(paradas: Parada[]) {
    setEditandoParadaId(null);
    setPuntoPendiente(null);
    setTipoParada('intermedia');
    setOrdenParada(String(Math.max(-1, ...paradas.map((parada) => parada.orden)) + 1));
    setModo('agregar-parada');
  }

  function empezarEdicionParada(p: Parada) {
    setEditandoParadaId(p.id);
    setTipoParada(p.tipo);
    setOrdenParada(String(p.orden));
    setPuntoPendiente({ lat: p.coord.coordinates[1], lng: p.coord.coordinates[0] });
    setModo('agregar-parada');
  }

  function empezarAgregarPuntoControl(puntosControl: PuntoControl[]) {
    setEditandoPuntoControlId(null);
    setPuntoPendiente(null);
    setOrdenParada(String(Math.max(-1, ...puntosControl.map((punto) => punto.orden)) + 1));
    setRadioTolerancia('30');
    setObligatorio(true);
    setModo('agregar-punto-control');
  }

  function empezarEdicionPuntoControl(pc: PuntoControl) {
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

  return {
    modo,
    puntosPendientes,
    puntosRehacer,
    nodoSeleccionadoIndex,
    setNodoSeleccionadoIndex,
    puntoPendiente,
    setPuntoPendiente,
    editandoTrazado,
    editandoParadaId,
    editandoPuntoControlId,
    sentido,
    setSentido,
    tipoParada,
    setTipoParada,
    ordenParada,
    setOrdenParada,
    radioTolerancia,
    setRadioTolerancia,
    obligatorio,
    setObligatorio,
    borradorInverso,
    copiarParadasInversas,
    setCopiarParadasInversas,
    copiarControlesInversos,
    setCopiarControlesInversos,
    empezarDibujo,
    empezarEdicionTrazado,
    empezarRecorridoInverso,
    empezarAgregarParada,
    empezarEdicionParada,
    empezarAgregarPuntoControl,
    empezarEdicionPuntoControl,
    cancelarModo,
    onMapClick,
    deshacerPunto,
    rehacerPunto,
    restaurarTrazado,
    actualizarPuntosPendientes,
  };
}
