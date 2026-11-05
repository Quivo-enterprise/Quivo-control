'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Loader, PageHeader, PlateBadge } from '@quivo/design-system';
import { Ban, ChevronRight, MapPin } from 'lucide-react';
import { LIMITE_INFRACCIONES_HOY, detalleInfraccion, etiquetaTipoInfraccion, type Infraccion, type InfraccionHoy, type Regla } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { infraccionesApi } from '../../../src/lib/api/infracciones';
import { reglasApi } from '../../../src/lib/api/reglas';
import {
  ETIQUETA_ESTADO_INFRACCION,
  ETIQUETA_NIVEL,
  NIVELES_DESC,
  aplicarResueltas,
  type ResueltasInfraccion,
  duracionInfraccion,
  etiquetaInicioAlerta,
  horaBo,
  puedeAtender,
  puedeSancionar,
  textoAlertasAbiertas,
} from '../../../src/lib/en-vivo/alertas';
import { useInfraccionesHoy } from '../../../src/lib/en-vivo/use-en-vivo';
import { mensajeError } from '../en-vivo/map-builders';
import { FormularioDescarte, IconoNivel, mensajeAccion } from '../en-vivo/panel-vehiculo';
import { ModalSancionar } from '../en-vivo/modal-sancionar';

type Filtro = 'abierta' | 'atendida' | 'todas';
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'abierta', label: 'Abiertas' },
  { id: 'atendida', label: 'Atendidas' },
  { id: 'todas', label: 'Todas' },
];

const VACIO: Record<Filtro, string> = {
  abierta: 'Sin alertas abiertas',
  atendida: 'Sin alertas atendidas',
  todas: 'Sin alertas hoy',
};

type Accion = 'atender' | 'descartar' | 'sancionar';

export default function AlertasPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const alertas = useInfraccionesHoy(token);
  const [filtro, setFiltro] = useState<Filtro>('abierta');
  const [enCurso, setEnCurso] = useState<ReadonlyMap<string, Accion>>(new Map());
  const [resueltas, setResueltas] = useState<ResueltasInfraccion>(new Map());
  const [errores, setErrores] = useState<Readonly<Record<string, { placa: string; texto: string }>>>({});
  const [descarte, setDescarte] = useState<{ id: string; motivo: string } | null>(null);
  const [sancion, setSancion] = useState<{ inf: InfraccionHoy; reglas: Regla[] } | null>(null);

  // Lo logrado se superpone al instante: el refresco en segundo plano puede tardar o fallar y no debe dejar un 2.º PATCH posible.
  // El servidor solo lista abiertas y atendidas: descartada/sancionada salen en el mismo render (sin foco a <body> tras el refresco).
  const todas = aplicarResueltas(alertas.data ?? [], resueltas).filter((i) => i.estado === 'abierta' || i.estado === 'atendida');
  const cuenta = {
    abierta: todas.filter((i) => i.estado === 'abierta').length,
    atendida: todas.filter((i) => i.estado === 'atendida').length,
    todas: todas.length,
  };
  const visibles = filtro === 'todas' ? todas : todas.filter((i) => i.estado === filtro);
  const grupos = NIVELES_DESC.map((nivel) => ({ nivel, items: visibles.filter((i) => i.gravedad === nivel) })).filter((g) => g.items.length > 0);
  const orden = grupos.flatMap((g) => g.items);

  // Foco: tras una acción lograda (ya aplicada en la lista local), si el foco cayó a <body> pasa a la primera acción
  // de la misma tarjeta (sigue listada, p. ej. filtro Todas) o de la que ocupa su lugar; sin tarjetas, al mensaje vacío.
  const [focoTras, setFocoTras] = useState<{ id: string; idx: number } | null>(null);
  useEffect(() => {
    if (!focoTras) return;
    setFocoTras(null);
    const activo = document.activeElement;
    if (activo && activo !== document.body) return;
    const quedaEnLista = orden.some((i) => i.id === focoTras.id);
    const objetivo = quedaEnLista ? focoTras.id : orden[Math.min(focoTras.idx, orden.length - 1)]?.id;
    const el = objetivo
      ? (document.querySelector<HTMLElement>(`[data-alerta="${objetivo}"] .qv-alertas__acciones :is(a, button:not(:disabled))`) ??
        document.querySelector<HTMLElement>(`[data-alerta="${objetivo}"] :is(a[href], button:not(:disabled), input, textarea)`))
      : document.querySelector<HTMLElement>('.qv-alertas__vacio');
    el?.focus();
  }, [focoTras]);
  const armarFoco = (id: string) => setFocoTras({ id, idx: Math.max(orden.findIndex((i) => i.id === id), 0) });

  // Alertas y En vivo cachean las mismas infracciones: se invalidan las dos keys exactas (sin tocar posiciones).
  const refrescar = (sesionId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'infracciones-hoy'] }),
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'infracciones', sesionId] }),
    ]);
  // Guarda la placa: la tarjeta puede haber salido de la lista cuando el error se pinta a nivel de página.
  const ponerError = (inf: InfraccionHoy, texto: string | null) =>
    setErrores((prev) => {
      const resto = { ...prev };
      delete resto[inf.id];
      return texto === null ? resto : { ...resto, [inf.id]: { placa: inf.vehiculoPlaca, texto } };
    });
  const resolver = (inf: InfraccionHoy, a: Infraccion['estado']) => {
    // `desde` es el estado del servidor: encadenar acciones antes del refresco no debe romper la superposición.
    setResueltas((prev) => new Map(prev).set(inf.id, { desde: prev.get(inf.id)?.desde ?? inf.estado, a }));
    armarFoco(inf.id);
    void refrescar(inf.sesionId);
  };
  async function correr(inf: InfraccionHoy, accion: Accion, fn: () => Promise<Infraccion | void>, refrescarAlFallar = true) {
    const id = inf.id;
    ponerError(inf, null);
    setEnCurso((prev) => new Map(prev).set(id, accion));
    let fallo = false;
    try {
      const nueva = await fn();
      if (nueva) resolver(inf, nueva.estado);
    } catch (err) {
      fallo = true;
      ponerError(inf, mensajeAccion(err));
    }
    setEnCurso((prev) => {
      const sig = new Map(prev);
      sig.delete(id);
      return sig;
    });
    // Un 409 suele ser que otro operador la cerró: al refrescar la tarjeta sale de la lista y el foco no debe caer a <body>.
    if (fallo && refrescarAlFallar) {
      await refrescar(inf.sesionId);
      armarFoco(id);
    }
  }
  const actuar = (inf: InfraccionHoy, accion: 'atender' | 'descartar', nota?: string) =>
    correr(inf, accion, async () => {
      const nueva = await infraccionesApi.actualizar(token as string, inf.id, { accion, nota });
      setDescarte((cur) => (cur?.id === inf.id ? null : cur));
      return nueva;
    });
  // Las reglas se piden frescas al pulsar "Sancionar" (igual que en En vivo): el servidor re-deriva la regla al enviar.
  const abrirSancion = (inf: InfraccionHoy) =>
    correr(inf, 'sancionar', async () => {
      const reglas = await queryClient.fetchQuery<Regla[]>({
        queryKey: ['en-vivo', 'reglas-sancion'],
        staleTime: 0,
        queryFn: () => reglasApi.listar(token as string),
      });
      setSancion({ inf, reglas });
    }, false);

  return (
    <div className="qv-alertas">
      <p className="qv-visually-hidden" aria-live="polite">
        {alertas.data ? textoAlertasAbiertas(cuenta.abierta) : ''}
      </p>
      <PageHeader title="Alertas" subtitle={alertas.data ? `Hoy · ${textoAlertasAbiertas(cuenta.abierta)}` : 'Hoy'} />

      <div className="qv-alertas__chips" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="qv-alertas__chip"
            aria-pressed={filtro === f.id}
            onClick={() => {
              setFiltro(f.id);
              setErrores({});
            }}
          >
            {f.label} <b>{cuenta[f.id]}</b>
          </button>
        ))}
      </div>

      <Link href="/reglas" className="qv-alertas__link">
        <span>
          <Ban size={20} aria-hidden="true" />
          Sanciones pendientes
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </Link>

      {alertas.isError && alertas.data && (
        <Alert variant="warning" title={`No se pudo actualizar; mostrando datos de ${horaBo(alertas.dataUpdatedAt)}`} />
      )}
      {alertas.data && alertas.data.length >= LIMITE_INFRACCIONES_HOY && (
        <Alert variant="info" title={`Se muestran las primeras ${LIMITE_INFRACCIONES_HOY} alertas; puede haber más.`} />
      )}

      {Object.entries(errores)
        .filter(([id]) => !orden.some((i) => i.id === id))
        .map(([id, { placa, texto }]) => (
          <Alert key={id} variant="danger" title={`${placa}: ${texto}`}>
            <button type="button" className="qv-live-btn" style={{ minHeight: '2.75rem' }} onClick={() => setErrores(({ [id]: _, ...resto }) => resto)}>
              Cerrar
            </button>
          </Alert>
        ))}

      {alertas.isPending ? (
        <Loader label="Cargando alertas…" />
      ) : alertas.isError && !alertas.data ? (
        <Alert variant="danger" title="No se pudieron cargar las alertas">
          {mensajeError(alertas.error)}
        </Alert>
      ) : visibles.length === 0 ? (
        <p className="qv-alertas__vacio" tabIndex={-1}>
          {VACIO[filtro]}
        </p>
      ) : (
        grupos.map(({ nivel, items: grupo }) => {
          return (
            <section key={nivel} className="qv-alertas__grupo" aria-label={`Alertas ${ETIQUETA_NIVEL[nivel].plural}`}>
              <h2 className="qv-alertas__nivel">
                {ETIQUETA_NIVEL[nivel].plural} <span>{grupo.length}</span>
              </h2>
              <ul className="qv-live-infracciones">
                {grupo.map((inf) => {
                  const corriendo = enCurso.get(inf.id);
                  const pendiente = corriendo !== undefined;
                  const duracion = duracionInfraccion(inf);
                  return (
                    <li
                      key={inf.id}
                      data-alerta={inf.id}
                      className={`qv-live-inf qv-alertas__card qv-live-inf--${inf.gravedad}${inf.estado === 'abierta' ? '' : ' qv-live-inf--cerrada'}`}
                    >
                      <div className="qv-live-inf__cab">
                        <span className="qv-live-inf__icono">
                          <IconoNivel nivel={inf.gravedad} size={18} />
                        </span>
                        <span className="qv-live-inf__chip">{ETIQUETA_NIVEL[inf.gravedad].singular}</span>
                        <span className="qv-live-inf__estado">
                          {ETIQUETA_ESTADO_INFRACCION[inf.estado]} · {etiquetaInicioAlerta(inf.inicioTs)}
                        </span>
                      </div>
                      <PlateBadge plate={inf.vehiculoPlaca} />
                      <h3 className="qv-alertas__titulo">{etiquetaTipoInfraccion(inf.tipo)}</h3>
                      <p className="qv-live-inf__detalle">
                        {detalleInfraccion(inf)}
                        {duracion ? ` · duró ${duracion}` : ''}
                        {' · '}
                        {inf.conductorNombre} · {inf.lineaNombre}
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
                        <div className="qv-alertas__acciones">
                          <Link href={`/en-vivo?vehiculo=${inf.vehiculoId}&sesion=${inf.sesionId}`} prefetch={false} className="qv-live-btn" aria-label={`Ver en mapa ${inf.vehiculoPlaca}`}>
                            <MapPin size={16} aria-hidden="true" />
                            Ver en mapa
                          </Link>
                          {puedeAtender(inf) && (
                            <button
                              type="button"
                              className="qv-live-btn"
                              disabled={pendiente}
                              aria-busy={corriendo === 'atender'}
                              aria-label={corriendo === 'atender' ? undefined : `Atender alerta ${inf.vehiculoPlaca}`}
                              onClick={() => void actuar(inf, 'atender')}
                            >
                              {corriendo === 'atender' ? 'Atendiendo…' : 'Atender'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="qv-live-btn"
                            disabled={pendiente}
                            aria-label={`Descartar alerta ${inf.vehiculoPlaca}`}
                            onClick={() => setDescarte({ id: inf.id, motivo: '' })}
                          >
                            Descartar
                          </button>
                          {puedeSancionar(inf) && (
                            <button
                              type="button"
                              className="qv-live-btn qv-live-btn--primario"
                              disabled={pendiente}
                              aria-busy={corriendo === 'sancionar'}
                              aria-label={corriendo === 'sancionar' ? undefined : `Sancionar alerta ${inf.vehiculoPlaca}`}
                              onClick={() => void abrirSancion(inf)}
                            >
                              {corriendo === 'sancionar' ? 'Cargando…' : 'Sancionar'}
                            </button>
                          )}
                        </div>
                      )}
                      {errores[inf.id] && (
                        <p className="qv-live-panel__error" role="alert">
                          {errores[inf.id]?.texto}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {sancion && (
        <ModalSancionar
          key={sancion.inf.id}
          token={token}
          inf={sancion.inf}
          reglas={sancion.reglas}
          placa={sancion.inf.vehiculoPlaca}
          conductor={sancion.inf.conductorNombre}
          onClose={() => setSancion(null)}
          onCreada={() => {
            const { inf } = sancion;
            setSancion(null);
            resolver(inf, 'sancionada');
          }}
        />
      )}
    </div>
  );
}
