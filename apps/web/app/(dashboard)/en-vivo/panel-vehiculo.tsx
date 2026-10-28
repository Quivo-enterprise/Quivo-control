'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { colorTextoContraste } from '@quivo/design-system';
import { formatearTelefonoBolivia } from '@quivo/shared';
import {
  Bus,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  CircleAlert,
  Copy,
  MapPin,
  MessageCircle,
  Navigation,
  OctagonAlert,
  Phone,
  Route,
  TriangleAlert,
  User,
  X,
} from 'lucide-react';
import type {
  Conductor,
  ContextoEnVivo,
  GravedadRegla,
  Infraccion,
  PosicionEnVivo,
  Regla,
  Vehiculo,
} from '@quivo/shared';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { infraccionesApi } from '../../../src/lib/api/infracciones';
import { reglasApi } from '../../../src/lib/api/reglas';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import {
  ETIQUETA_ESTADO_INFRACCION,
  ETIQUETA_NIVEL,
  detalleInfraccion,
  duracionInfraccion,
  etiquetaTipoInfraccion,
  motivoSancion,
  ordenarInfracciones,
  puedeAtender,
  puedeDescartar,
  puedeSancionar,
  reglaInicialSancion,
  reglasSancionables,
  urlLlamada,
  urlWhatsapp,
  velocidadKmh,
} from '../../../src/lib/en-vivo/alertas';
import { diaLocalIso } from '../../../src/lib/fecha-local';
import {
  useContextoEnVivo,
  useDesignarVuelta,
  useInfraccionesSesion,
  useMolinosResumen,
  useOpcionesDesignacion,
} from '../../../src/lib/en-vivo/use-en-vivo';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import {
  antiguedadViva,
  formatearAntiguedad,
  presentacionFrescura,
  sufijoPausa,
  type TrazaAcumulada,
} from '../../../src/lib/en-vivo/traza';
import { NuevaSancionModal } from '../reglas/nueva-sancion-modal';
import { estadoDe } from '../../../src/lib/en-vivo/atencion';
import { pcsEfectivos } from '../../../src/lib/en-vivo/pcs-efectivos';
import { formatearHoraBolivia } from '../../../src/lib/en-vivo/jornadas';
import { GlifoEstado } from './glifo-estado';
import { mensajeError, ultimaPasada } from './map-builders';
import { SeccionVuelta } from './panel-vuelta';

export interface AvisoPanel {
  tono: 'ok' | 'error';
  texto: string;
}

const ICONO_NIVEL = { leve: CircleAlert, grave: TriangleAlert, gravisima: OctagonAlert } as const;

export function IconoNivel({ nivel, size = 14 }: { nivel: GravedadRegla; size?: number }) {
  const Icono = ICONO_NIVEL[nivel];
  return <Icono size={size} aria-hidden="true" />;
}

/** Texto legible de un fallo al actuar sobre una infracción (409 = ya cambió, 400 = datos). */
function mensajeAccion(err: unknown): string {
  const base = mensajeError(err);
  const status = (err as { status?: number } | null)?.status;
  if (status === 409) return `${base} Revisá el estado actual de la infracción.`;
  if (status === 404) return 'La infracción ya no existe.';
  return base;
}

interface OpcionesSancion {
  reglas: Regla[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
}

/** Borrador del formulario de descarte de una infracción. */
export interface BorradorDescarte {
  id: string;
  motivo: string;
}

/** Borradores de descarte por sesión, en la PÁGINA: cambiar de vehículo remonta el panel (`key`) y
 * un borrador a medias no debe perderse en silencio; reaparece al volver a ese vehículo. */
export type BorradoresDescarte = Map<string, BorradorDescarte>;

interface PanelVehiculoProps {
  token: string | null;
  sesionId: string;
  posicion: PosicionEnVivo | undefined;
  contexto: ContextoEnVivo | undefined;
  datos: TrazaAcumulada | undefined;
  ultimoPuntoTs: string | undefined;
  seguir: boolean;
  puedeSeguir: boolean;
  onToggleSeguir: () => void;
  onCerrar: () => void;
  onVerEnMapa: (infraccion: Infraccion) => void;
  onAviso: (aviso: AvisoPanel) => void;
  /** Encabezado (placa) del panel: la página le da el foco al abrirlo (ver `EnVivoPage`). */
  tituloRef: RefObject<HTMLHeadingElement>;
  /** El vehículo ya no está en el mapa (p. ej. el filtro de línea lo sacó) pero el panel sigue
   * abierto porque hay trabajo a medias (formulario de sanción o borrador de descarte). */
  fueraDelMapa: boolean;
  /** Avisa si hay trabajo a medias que desmontar el panel perdería. */
  onTrabajoEnCurso: (enCurso: boolean) => void;
  /** Almacén de borradores de descarte (vive en la página, sobrevive al remonte del panel). */
  borradores: BorradoresDescarte;
  trazaRecibidoEn: number;
  posicionesRecibidoEn: number;
  /** El `operador` (control) ve las infracciones pero no atiende, descarta ni sanciona. */
  soloLectura: boolean;
}

/** Hoja inferior de la vista móvil (<= 720 px). */
const MQ_MOVIL = '(max-width: 720px)';
/** Desplazamiento vertical (px) del arrastre a partir del cual la hoja cambia de altura. */
const UMBRAL_ARRASTRE_PX = 32;

export function PanelVehiculo(props: PanelVehiculoProps) {
  const {
    token,
    sesionId,
    posicion,
    contexto,
    datos,
    ultimoPuntoTs,
    seguir,
    puedeSeguir,
    onToggleSeguir,
    onCerrar,
    onVerEnMapa,
    onAviso,
    tituloRef,
    fueraDelMapa,
    onTrabajoEnCurso,
    borradores,
    trazaRecibidoEn,
    posicionesRecibidoEn,
    soloLectura,
  } = props;
  const queryClient = useQueryClient();
  const infracciones = useInfraccionesSesion(token, sesionId);
  const ctxQuery = useContextoEnVivo(token, sesionId);
  // El contexto se pide una sola vez (staleTime Infinity): una incidencia nueva lo refresca.
  const incidenciaRecibida = posicion?.ultimaIncidencia?.recibidoTs;
  useEffect(() => {
    if (incidenciaRecibida) void queryClient.invalidateQueries({ queryKey: ['en-vivo', 'contexto', sesionId] });
  }, [incidenciaRecibida, queryClient, sesionId]);
  const molinos = useMolinosResumen(token);
  const { variantes, puntos } = useOpcionesDesignacion(token, contexto?.ruta.id ?? null);
  const designar = useDesignarVuelta(token);
  // Hoja inferior de dos alturas (solo se nota en móvil; en escritorio el panel no se pliega).
  const [hojaPlegada, setHojaPlegada] = useState(false);
  const arrastre = useRef<{ y: number } | null>(null);
  const suprimirClic = useRef(false);
  const asaRef = useRef<HTMLButtonElement>(null);
  const [pcsAbierto, setPcsAbierto] = useState(false);
  // Foto que ya falló al cargar: el avatar vuelve al ícono del bus (igual que el marcador).
  const [fotoRota, setFotoRota] = useState<string | null>(null);
  // Formulario de descarte abierto (uno a la vez) y acciones en vuelo POR infracción: una acción
  // de otra fila no pisa ni el formulario ni los botones de esta.
  const [descarte, setDescarte] = useState<BorradorDescarte | null>(() => borradores.get(sesionId) ?? null);
  useEffect(() => {
    if (descarte) borradores.set(sesionId, descarte);
    else borradores.delete(sesionId);
  }, [descarte, borradores, sesionId]);
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(new Set());
  const [errorFila, setErrorFila] = useState<Readonly<Record<string, string>>>({});
  // Sancionar: carga POR fila (como `enCurso`) y un contador de pedidos: solo el más reciente puede
  // abrir el modal; una respuesta vieja se ignora (si no, abriría el modal de otra infracción).
  const [cargandoSancion, setCargandoSancion] = useState<ReadonlySet<string>>(new Set());
  const ultimoPedidoSancion = useRef(0);
  const [sancion, setSancion] = useState<{ inf: Infraccion; opciones: OpcionesSancion } | null>(null);

  // El foco (al abrir -> encabezado; al cerrar -> marcador) lo gestiona la página: aquí cambiar de
  // vehículo remonta el panel (`key`) y no debe robar el foco a quien navega con "Siguiente alerta".

  const trabajoEnCurso =
    sancion !== null ||
    cargandoSancion.size > 0 ||
    enCurso.size > 0 ||
    (descarte !== null && descarte.motivo.trim() !== '');
  useEffect(() => {
    onTrabajoEnCurso(trabajoEnCurso);
  }, [trabajoEnCurso, onTrabajoEnCurso]);
  useEffect(() => () => onTrabajoEnCurso(false), [onTrabajoEnCurso]);
  // Al cambiar de vehículo el panel se desmonta: una sanción aún cargando se cancela (su resultado se ignora).
  useEffect(
    () => () => {
      ultimoPedidoSancion.current++;
    },
    [],
  );

  const ponerError = (id: string, texto: string | null) =>
    setErrorFila((prev) => {
      if (texto === null) {
        if (!(id in prev)) return prev;
        const resto = { ...prev };
        delete resto[id];
        return resto;
      }
      return { ...prev, [id]: texto };
    });
  const marcarEnCurso = (id: string, activo: boolean) =>
    setEnCurso((prev) => {
      const sig = new Set(prev);
      if (activo) sig.add(id);
      else sig.delete(id);
      return sig;
    });

  const placa = contexto?.vehiculo.placa ?? posicion?.vehiculoPlaca ?? '';
  const conductor = contexto?.conductor.nombre ?? posicion?.conductorNombre ?? '';
  const lineaNombre = contexto?.linea.nombre ?? posicion?.lineaNombre ?? '';
  const colorLinea = contexto?.linea.color || undefined;
  const fotoUrl = posicion?.fotoUrl?.trim() || null;
  const telefono = contexto?.conductor.telefono ?? null;
  // Sin posición (sin GPS aún) un 0 km/h engaña: no hay dato.
  const kmh = posicion?.lat == null || posicion.lng == null ? null : velocidadKmh(posicion.speed);
  const lista = ordenarInfracciones(infracciones.data ?? []);
  const abiertas = lista.filter((i) => i.estado === 'abierta');
  const pcs = contexto ? pcsEfectivos(contexto, posicion?.vuelta?.varianteId) : [];
  // shortcut: las infracciones de vueltas anteriores se numeran con el orden efectivo de la vuelta ACTUAL;
  // puede salir corrido en 1 si esa vuelta tuvo otra designación de Molinos. Numerar por la vuelta de cada
  // infracción si los despachadores lo reportan.
  const idsPc = pcs.map((pc) => pc.id);
  // Un borrador de una infracción que ya no se puede descartar (la atendió otro, se cerró) no se
  // muestra ni cuenta como trabajo a medias.
  useEffect(() => {
    if (!infracciones.data || !descarte) return;
    const inf = infracciones.data.find((i) => i.id === descarte.id);
    if (!inf || !puedeDescartar(inf)) setDescarte(null);
  }, [infracciones.data, descarte]);

  const urlWa = urlWhatsapp(telefono, {
    placa,
    lineaNombre,
    infraccion: abiertas[0] ? etiquetaTipoInfraccion(abiertas[0].tipo) : null,
  });
  const urlTel = urlLlamada(telefono);

  const invalidar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'infracciones', sesionId] }),
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'posiciones-todas'] }),
    ]);

  async function actuar(inf: Infraccion, accion: 'atender' | 'descartar', nota?: string) {
    ponerError(inf.id, null);
    marcarEnCurso(inf.id, true);
    try {
      await infraccionesApi.actualizar(token as string, inf.id, { accion, nota });
      // Solo se cierra el formulario de ESTA fila; el de otra infracción queda como estaba.
      setDescarte((cur) => (cur?.id === inf.id ? null : cur));
      onAviso({ tono: 'ok', texto: accion === 'atender' ? 'Infracción atendida' : 'Infracción descartada' });
      await invalidar();
    } catch (err) {
      const texto = mensajeAccion(err);
      ponerError(inf.id, texto);
      onAviso({ tono: 'error', texto });
      void invalidar();
    } finally {
      marcarEnCurso(inf.id, false);
    }
  }

  // Reglas/vehículos/conductores solo se piden al pulsar "Sancionar" (el modal los necesita); la
  // caché de 60 s evita pedirlos de nuevo. Si fallan, el error queda junto a ESA infracción.
  async function abrirSancion(inf: Infraccion) {
    ponerError(inf.id, null);
    const pedido = ++ultimoPedidoSancion.current;
    setCargandoSancion((prev) => new Set(prev).add(inf.id));
    try {
      const opciones = await queryClient.fetchQuery<OpcionesSancion>({
        queryKey: ['en-vivo', 'opciones-sancion'],
        staleTime: 60_000,
        queryFn: async () => {
          const [reglas, vehiculos, conductores] = await Promise.all([
            reglasApi.listar(token as string),
            vehiculosApi.listar(token as string),
            conductoresApi.listar(token as string),
          ]);
          return { reglas, vehiculos, conductores };
        },
      });
      if (pedido === ultimoPedidoSancion.current) setSancion({ inf, opciones });
    } catch (err) {
      ponerError(inf.id, `No se pudieron cargar las reglas para sancionar. ${mensajeError(err)}`);
    } finally {
      setCargandoSancion((prev) => {
        const sig = new Set(prev);
        sig.delete(inf.id);
        return sig;
      });
    }
  }

  // "Ver en mapa" pliega la hoja ANTES de que la página mida dónde cae el punto (flushSync: el
  // layout ya está aplicado cuando `onVerEnMapa` lee la altura de la hoja).
  function verEnMapa(inf: Infraccion) {
    if (window.matchMedia(MQ_MOVIL).matches) {
      flushSync(() => setHojaPlegada(true));
      // El botón "Ver en mapa" queda oculto al plegar: el foco pasa al asa en vez de perderse.
      asaRef.current?.focus({ preventScroll: true });
    }
    onVerEnMapa(inf);
  }

  async function copiarTelefono() {
    if (!telefono) return;
    try {
      await navigator.clipboard.writeText(telefono);
      onAviso({ tono: 'ok', texto: 'Número copiado' });
    } catch {
      onAviso({ tono: 'error', texto: 'No se pudo copiar el número' });
    }
  }

  return (
    <section
      className="qv-live-panel"
      data-hoja={hojaPlegada ? 'plegada' : 'expandida'}
      aria-label={`Detalle del vehículo ${placa}`}
      style={
        colorLinea
          ? ({ '--qv-panel-linea': colorLinea, '--qv-panel-linea-fg': colorTextoContraste(colorLinea) } as React.CSSProperties)
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || sancion) return;
        // Con trabajo a medias Escape NO cierra el panel. Primero cancela el formulario de descarte
        // (desde cualquier control del formulario) sin guardar nada; si hay algo en vuelo, no hace nada.
        if (descarte) {
          if (enCurso.has(descarte.id)) return;
          setDescarte(null);
          tituloRef.current?.focus({ preventScroll: true });
          return;
        }
        if (trabajoEnCurso) return;
        onCerrar();
      }}
    >
      <button
        ref={asaRef}
        type="button"
        className="qv-live-panel__asa"
        aria-expanded={!hojaPlegada}
        aria-controls="qv-live-panel-cuerpo"
        aria-label={hojaPlegada ? 'Expandir detalle del vehículo' : 'Plegar detalle para ver el mapa'}
        onPointerDown={(e) => {
          // Un drag táctil no genera `click`: el flag que dejó pegado no debe tragarse el próximo toque.
          suprimirClic.current = false;
          arrastre.current = { y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          const inicio = arrastre.current;
          arrastre.current = null;
          if (!inicio) return;
          const dy = e.clientY - inicio.y;
          if (Math.abs(dy) >= UMBRAL_ARRASTRE_PX) {
            setHojaPlegada(dy > 0);
            // El `click` que sigue al soltar (si llega) no debe volver a alternar.
            suprimirClic.current = true;
          }
        }}
        onPointerCancel={() => {
          arrastre.current = null;
        }}
        onClick={() => {
          if (suprimirClic.current) {
            suprimirClic.current = false;
            return;
          }
          setHojaPlegada((v) => !v);
        }}
      >
        <span className="qv-live-panel__asa-barra" aria-hidden="true" />
        <span className="qv-live-panel__asa-icono" aria-hidden="true">
          {hojaPlegada ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
        </span>
      </button>

      <div className="qv-live-panel__cabecera">
        <span className="qv-live-panel__avatar" aria-hidden="true">
          {fotoUrl && fotoRota !== fotoUrl ? (
            <img src={fotoUrl} alt="" width={48} height={48} loading="lazy" decoding="async" onError={() => setFotoRota(fotoUrl)} />
          ) : (
            <Bus size={20} />
          )}
        </span>
        <div className="qv-live-panel__titulos">
          <div className="qv-live-panel__fila">
            <h2 ref={tituloRef} tabIndex={-1} className="qv-live-panel__placa">
              {placa}
            </h2>
            {lineaNombre && <span className="qv-live-panel__linea">{lineaNombre}</span>}
          </div>
          <div className="qv-live-panel__fila">
            <FrescuraPanel
              datos={datos}
              posicion={posicion}
              recibidoEn={trazaRecibidoEn}
              posicionesRecibidoEn={posicionesRecibidoEn}
            />
            {kmh !== null && <span className="qv-live-panel__tabular">{kmh} km/h</span>}
          </div>
          <span className="qv-live-panel__meta">
            <User size={12} aria-hidden="true" /> {conductor}
          </span>
        </div>
        <button type="button" className="qv-live-panel__cerrar" onClick={onCerrar} aria-label="Cerrar detalle del vehículo" title="Cerrar">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Resumen de la hoja plegada (solo móvil): lo imprescindible sin abrir el detalle. */}
      <p className="qv-live-panel__resumen">
        {abiertas.length > 0 ? `${abiertas.length} abierta${abiertas.length === 1 ? '' : 's'}` : 'Sin infracciones abiertas'}
        {posicion?.vuelta
          ? ` · Vuelta ${posicion.vuelta.numero} · ${posicion.vuelta.varianteNombre ?? (posicion.vuelta.varianteId ? 'Molinos' : 'Directo')}`
          : ''}
      </p>

      <div id="qv-live-panel-cuerpo" className="qv-live-panel__cuerpo">
      {fueraDelMapa && (
        <p className="qv-live-panel__aviso" role="status">
          El vehículo ya no está en el mapa.
        </p>
      )}

      <div className="qv-live-panel__acciones" role="group" aria-label="Acciones rápidas">
        <button
          type="button"
          className="qv-live-btn"
          aria-pressed={seguir}
          disabled={!puedeSeguir}
          onClick={onToggleSeguir}
        >
          <Navigation size={14} aria-hidden="true" />
          Seguir
        </button>
        <Link className="qv-live-btn" href={`/reportes/recorridos/${sesionId}`}>
          <Route size={14} aria-hidden="true" />
          Ver recorrido
        </Link>
        {telefono && urlWa && (
          <a className="qv-live-btn" href={urlWa} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={14} aria-hidden="true" />
            WhatsApp
          </a>
        )}
        {telefono && urlTel && (
          <a className="qv-live-btn" href={urlTel}>
            <Phone size={14} aria-hidden="true" />
            Llamar
          </a>
        )}
        {telefono && (
          <button type="button" className="qv-live-btn" onClick={() => void copiarTelefono()}>
            <Copy size={14} aria-hidden="true" />
            Copiar
          </button>
        )}
      </div>
      {telefono ? (
        <span className="qv-live-panel__tel">
          <Phone size={12} aria-hidden="true" /> {formatearTelefonoBolivia(telefono)}
        </span>
      ) : (
        <span className="qv-live-panel__sin-tel">
          Sin teléfono · <Link href="/conductores">Agregar</Link>
        </span>
      )}

      <SeccionVuelta
        posicion={posicion}
        variantes={variantes.data}
        variantesError={variantes.isError && !variantes.data}
        puntos={puntos.data}
        linea={molinos.data?.lineas.find((l) => l.lineaId === (posicion?.lineaId ?? contexto?.linea.id))}
        molinosServidorTs={molinos.data?.servidorTs}
        molinosRecibidoEn={molinos.dataUpdatedAt}
        posicionesServidorTs={posicion?.servidorTs}
        posicionesRecibidoEn={posicionesRecibidoEn}
        onDesignar={async (varianteId, varianteNombre) => {
          // Un rechazo se propaga a la sección, que lo muestra y anuncia en línea (no va al aviso).
          const res = await designar.mutateAsync({ sesionId, varianteId, varianteNombre });
          const nombre = varianteNombre ?? 'Molinos';
          onAviso({
            tono: 'ok',
            texto: !varianteId
              ? 'Designación cancelada'
              : res.aplica === 'proxima_vuelta'
                ? `Va a ${nombre} en la próxima vuelta`
                : `Vuelta designada: ${nombre}`,
          });
        }}
      />

      <div className="qv-live-panel__seccion">
        <h3 className="qv-live-panel__h">
          <span>Infracciones</span>
          <span className="qv-live-panel__tabular">
            {abiertas.length > 0 ? `${abiertas.length} abierta${abiertas.length === 1 ? '' : 's'}` : 'ninguna abierta'}
          </span>
        </h3>
        {infracciones.isPending ? (
          <p className="qv-live-panel__vacio" role="status">
            Cargando infracciones…
          </p>
        ) : infracciones.isError && !infracciones.data ? (
          <p className="qv-live-panel__error" role="alert">
            No se pudieron cargar las infracciones. {mensajeError(infracciones.error)}
          </p>
        ) : lista.length === 0 ? (
          <p className="qv-live-panel__vacio">Sin infracciones en esta sesión.</p>
        ) : (
          <ul className="qv-live-infracciones">
            {lista.map((inf) => {
              const esAbierta = inf.estado === 'abierta';
              const duracion = duracionInfraccion(inf);
              const pendiente = enCurso.has(inf.id);
              const cargandoOpciones = cargandoSancion.has(inf.id);
              const error = errorFila[inf.id];
              return (
                <li
                  key={inf.id}
                  className={`qv-live-inf qv-live-inf--${inf.gravedad}${esAbierta ? '' : ' qv-live-inf--cerrada'}`}
                >
                  <div className="qv-live-inf__cab">
                    <span className="qv-live-inf__icono">
                      <IconoNivel nivel={inf.gravedad} />
                    </span>
                    <span className="qv-live-inf__titulo">{etiquetaTipoInfraccion(inf.tipo)}</span>
                    <span className="qv-live-inf__chip">{ETIQUETA_NIVEL[inf.gravedad].singular}</span>
                    <span className="qv-live-inf__estado">{ETIQUETA_ESTADO_INFRACCION[inf.estado]}</span>
                  </div>
                  <p className="qv-live-inf__detalle">
                    {inf.inicioTs.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                    {duracion ? ` · duró ${duracion}` : esAbierta && inf.tipo === 'desvio_ruta' ? ' · en curso' : ''}
                    {' · '}
                    {detalleInfraccion(inf, idsPc)}
                  </p>
                  {descarte?.id === inf.id ? (
                    <FormularioDescarte
                      motivo={descarte.motivo}
                      pendiente={pendiente}
                      onMotivo={(motivo) => setDescarte({ id: inf.id, motivo })}
                      onCancelar={() => setDescarte(null)}
                      onEnviar={() => void actuar(inf, 'descartar', descarte.motivo.trim() || undefined)}
                    />
                  ) : (
                    <div className="qv-live-inf__acciones">
                      <button type="button" className="qv-live-btn qv-live-btn--sm" onClick={() => verEnMapa(inf)}>
                        <MapPin size={13} aria-hidden="true" />
                        Ver en mapa
                      </button>
                      {!soloLectura && puedeAtender(inf) && (
                        <button
                          type="button"
                          className="qv-live-btn qv-live-btn--sm"
                          disabled={pendiente}
                          onClick={() => void actuar(inf, 'atender')}
                        >
                          Atender
                        </button>
                      )}
                      {!soloLectura && puedeDescartar(inf) && (
                        <button
                          type="button"
                          className="qv-live-btn qv-live-btn--sm"
                          disabled={pendiente}
                          onClick={() => setDescarte({ id: inf.id, motivo: '' })}
                        >
                          Descartar
                        </button>
                      )}
                      {!soloLectura && puedeSancionar(inf) && (
                        <button
                          type="button"
                          className="qv-live-btn qv-live-btn--sm qv-live-btn--peligro"
                          disabled={pendiente || cargandoOpciones}
                          onClick={() => void abrirSancion(inf)}
                        >
                          {cargandoOpciones ? 'Cargando…' : 'Sancionar'}
                        </button>
                      )}
                    </div>
                  )}
                  {error && (
                    <p className="qv-live-panel__error" role="alert">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="qv-live-panel__seccion">
        <h3 className="qv-live-panel__h">
          <span>Incidencias reportadas</span>
        </h3>
        {ctxQuery.isPending ? (
          <p className="qv-live-panel__vacio" role="status">
            Cargando…
          </p>
        ) : !contexto ? (
          <p className="qv-live-panel__error" role="alert">
            No se pudieron cargar las incidencias. {mensajeError(ctxQuery.error)}
          </p>
        ) : contexto.incidencias.length === 0 ? (
          <p className="qv-live-panel__vacio">Sin incidencias en esta sesión.</p>
        ) : (
          <ul className="qv-live-infracciones">
            {contexto.incidencias.map((i) => (
              <li key={i.id} className="qv-live-inf__detalle">
                {formatearHoraBolivia(i.ts)} · {i.texto}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="qv-live-panel__seccion">
        <button
          type="button"
          className="qv-live-panel__plegar-h"
          aria-expanded={pcsAbierto}
          aria-controls="qv-live-panel-pcs"
          onClick={() => setPcsAbierto((v) => !v)}
        >
          <span>Puntos de control y estadísticas</span>
          {pcsAbierto ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
        {pcsAbierto && (
          <div id="qv-live-panel-pcs" className="qv-live-pcs-cuerpo">
            <div className="qv-live-panel__stats">
              <div className="qv-live-panel__stat">
                <span>Última posición</span>
                <strong>{ultimoPuntoTs ? new Date(ultimoPuntoTs).toLocaleTimeString('es-BO') : 'Esperando fix'}</strong>
              </div>
              <div className="qv-live-panel__stat">
                <span>Puntos GPS traza</span>
                <strong>{datos?.puntos.length ?? 0} registrados</strong>
              </div>
            </div>
            {pcs.length > 0 && (
              <div className="qv-live-pcs-bloque">
                <span className="qv-live-panel__h">
                  <span>Puntos de control</span>
                  <span className="qv-live-pcs-resumen">
                    {pcs.filter((pc) => ultimaPasada(datos, pc.id)?.cumplido).length} /{' '}
                    {pcs.length} validados
                  </span>
                </span>
                <ul className="qv-live-panel__pcs" aria-label="Puntos de control">
                  {pcs.map((pc, idx) => {
                    const pasada = ultimaPasada(datos, pc.id);
                    const cumplido = Boolean(pasada?.cumplido);
                    return (
                      <li key={pc.id} className={`qv-live-pc${cumplido ? ' qv-live-pc--ok' : ''}`}>
                        {cumplido ? (
                          <Check size={12} className="qv-live-pc__check" aria-hidden="true" />
                        ) : (
                          <span className="qv-live-pc__punto" aria-hidden="true" />
                        )}
                        <span className="qv-live-pc__nombre">PC {idx + 1}</span>
                        {pasada && <span className="qv-live-pc__dist">({pasada.distanciaM.toFixed(0)}m)</span>}
                        {cumplido && <span className="qv-visually-hidden">validado</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      </div>

      {sancion && (
        <ModalSancion
          key={sancion.inf.id}
          token={token}
          sancion={sancion}
          placa={placa}
          conductor={conductor}
          onClose={() => setSancion(null)}
          onCreada={() => {
            setSancion(null);
            onAviso({ tono: 'ok', texto: 'Sanción creada · infracción sancionada' });
            void invalidar();
          }}
        />
      )}
    </section>
  );
}

function FrescuraPanel({
  datos,
  posicion,
  recibidoEn,
  posicionesRecibidoEn,
}: {
  datos: TrazaAcumulada | undefined;
  posicion: PosicionEnVivo | undefined;
  recibidoEn: number;
  posicionesRecibidoEn: number;
}) {
  const ahora = useReloj(1_000);
  const fuente = datos ?? posicion;
  if (!fuente) return null;
  const referencia = datos ? recibidoEn : posicionesRecibidoEn;
  const presentacion = presentacionFrescura(fuente.estadoFrescura);
  const antiguedadFix = antiguedadViva(fuente.ultimoFixTs, fuente.servidorTs, referencia, ahora);
  return (
    <span className="qv-live-panel__frescura">
      <GlifoEstado estado={estadoDe(fuente)} />
      <span>
        {presentacion.etiqueta}
        {sufijoPausa(fuente)}
      </span>
      <span className="qv-live-panel__tabular">· hace {formatearAntiguedad(antiguedadFix)}</span>
    </span>
  );
}

/** Formulario inline de descarte. El foco automático solo va con puntero fino: en táctil abriría
 * el teclado virtual y taparía la lista. */
function FormularioDescarte({
  motivo,
  pendiente,
  onMotivo,
  onCancelar,
  onEnviar,
}: {
  motivo: string;
  pendiente: boolean;
  onMotivo: (motivo: string) => void;
  onCancelar: () => void;
  onEnviar: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);
  return (
    <form
      className="qv-live-inf__descarte"
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar();
      }}
    >
      <input
        ref={inputRef}
        className="qv-live-inf__input"
        type="text"
        name="motivo"
        autoComplete="off"
        value={motivo}
        maxLength={500}
        placeholder="Motivo (opcional)…"
        aria-label="Motivo del descarte (opcional)"
        onChange={(e) => onMotivo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancelar();
          }
        }}
      />
      <button type="submit" className="qv-live-btn qv-live-btn--sm qv-live-btn--primario" disabled={pendiente}>
        Descartar
      </button>
      <button type="button" className="qv-live-btn qv-live-btn--sm" onClick={onCancelar} disabled={pendiente}>
        Cancelar
      </button>
    </form>
  );
}

function ModalSancion({
  token,
  sancion,
  placa,
  conductor,
  onClose,
  onCreada,
}: {
  token: string | null;
  sancion: { inf: Infraccion; opciones: OpcionesSancion };
  placa: string;
  conductor: string;
  onClose: () => void;
  onCreada: () => void;
}) {
  const { inf, opciones } = sancion;
  // `admin_quivo` recibe reglas/vehículos/conductores de TODOS los sindicatos: solo los del
  // sindicato de la infracción se ofrecen y se preseleccionan.
  const reglasActivas = reglasSancionables(opciones.reglas, inf.sindicatoId);
  const vehiculos = opciones.vehiculos.filter((v) => v.sindicatoId === inf.sindicatoId);
  const conductores = opciones.conductores.filter((c) => c.sindicatoId === inf.sindicatoId);
  const reglaId = reglaInicialSancion(inf, reglasActivas);
  return (
    <NuevaSancionModal
      key={inf.id}
      token={token}
      sindicatoId={inf.sindicatoId}
      reglas={reglasActivas}
      vehiculos={vehiculos}
      conductores={conductores}
      socios={[]}
      sujetoTipos={['conductor', 'vehiculo']}
      sujetosPermitidos={{ conductor: inf.conductorId, vehiculo: inf.vehiculoId }}
      sujetosEtiquetas={{ conductor: conductor || undefined, vehiculo: placa || undefined }}
      avisoRegla="No hay una regla de Alteración de ruta; elegí la regla."
      valoresIniciales={{
        reglaId,
        sujetoTipo: 'conductor',
        sujetoId: inf.conductorId,
        motivo: motivoSancion(inf, placa),
        fechaHecho: diaLocalIso(inf.inicioTs),
        evidenciaRef: `infraccion:${inf.id} sesion:${inf.sesionId}`,
      }}
      onSubmitOverride={(datos) => infraccionesApi.sancionar(token as string, inf.id, datos)}
      onClose={onClose}
      onCreada={onCreada}
    />
  );
}
