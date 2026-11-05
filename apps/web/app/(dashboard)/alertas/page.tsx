'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Loader, PageHeader, PlateBadge } from '@quivo/design-system';
import { Ban, ChevronRight, MapPin } from 'lucide-react';
import { LIMITE_INFRACCIONES_HOY, detalleInfraccion, etiquetaTipoInfraccion, type InfraccionHoy, type Regla } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { infraccionesApi } from '../../../src/lib/api/infracciones';
import { reglasApi } from '../../../src/lib/api/reglas';
import {
  ETIQUETA_ESTADO_INFRACCION,
  ETIQUETA_NIVEL,
  NIVELES_DESC,
  duracionInfraccion,
  etiquetaInicioAlerta,
  puedeAtender,
  puedeDescartar,
  puedeSancionar,
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

const hora = (d: Date) =>
  d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/La_Paz' });

export default function AlertasPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const alertas = useInfraccionesHoy(token);
  const [filtro, setFiltro] = useState<Filtro>('abierta');
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(new Set());
  const [errores, setErrores] = useState<Readonly<Record<string, string>>>({});
  const [descarte, setDescarte] = useState<{ id: string; motivo: string } | null>(null);
  const [sancion, setSancion] = useState<{ inf: InfraccionHoy; reglas: Regla[] } | null>(null);

  const todas = alertas.data ?? [];
  const cuenta = {
    abierta: todas.filter((i) => i.estado === 'abierta').length,
    atendida: todas.filter((i) => i.estado === 'atendida').length,
    todas: todas.length,
  };
  const visibles = filtro === 'todas' ? todas : todas.filter((i) => i.estado === filtro);

  // Alertas y En vivo cachean las mismas infracciones: se invalidan las dos keys exactas (sin tocar posiciones).
  const refrescar = (sesionId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'infracciones-hoy'] }),
      queryClient.invalidateQueries({ queryKey: ['en-vivo', 'infracciones', sesionId] }),
    ]);
  const ponerError = (id: string, texto: string | null) =>
    setErrores((prev) => {
      const resto = { ...prev };
      delete resto[id];
      return texto === null ? resto : { ...resto, [id]: texto };
    });
  async function correr(inf: InfraccionHoy, fn: () => Promise<void>, refrescarAlTerminar = true) {
    const id = inf.id;
    ponerError(id, null);
    setEnCurso((prev) => new Set(prev).add(id));
    try {
      await fn();
    } catch (err) {
      ponerError(id, mensajeAccion(err));
    } finally {
      setEnCurso((prev) => {
        const sig = new Set(prev);
        sig.delete(id);
        return sig;
      });
      if (refrescarAlTerminar) void refrescar(inf.sesionId);
    }
  }
  const actuar = (inf: InfraccionHoy, accion: 'atender' | 'descartar', nota?: string) =>
    correr(inf, async () => {
      await infraccionesApi.actualizar(token as string, inf.id, { accion, nota });
      setDescarte((cur) => (cur?.id === inf.id ? null : cur));
    });
  // Las reglas se piden frescas al pulsar "Sancionar" (igual que en En vivo): el servidor re-deriva la regla al enviar.
  const abrirSancion = (inf: InfraccionHoy) =>
    correr(inf, async () => {
      const reglas = await queryClient.fetchQuery<Regla[]>({
        queryKey: ['en-vivo', 'reglas-sancion'],
        staleTime: 0,
        queryFn: () => reglasApi.listar(token as string),
      });
      setSancion({ inf, reglas });
    }, false);

  return (
    <div className="qv-alertas">
      <PageHeader title="Alertas" subtitle={alertas.data ? `Hoy · ${cuenta.abierta} abierta${cuenta.abierta === 1 ? '' : 's'}` : 'Hoy'} />

      <div className="qv-alertas__chips" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="qv-alertas__chip"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
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
        <Alert variant="warning" title={`No se pudo actualizar; mostrando datos de ${hora(new Date(alertas.dataUpdatedAt))}`} />
      )}
      {alertas.data && alertas.data.length >= LIMITE_INFRACCIONES_HOY && (
        <Alert variant="info" title={`Se muestran las primeras ${LIMITE_INFRACCIONES_HOY} alertas; puede haber más.`} />
      )}

      {alertas.isPending ? (
        <Loader label="Cargando alertas…" />
      ) : alertas.isError && !alertas.data ? (
        <Alert variant="danger" title="No se pudieron cargar las alertas">
          {mensajeError(alertas.error)}
        </Alert>
      ) : visibles.length === 0 ? (
        <p className="qv-alertas__vacio">Sin alertas hoy</p>
      ) : (
        NIVELES_DESC.map((nivel) => {
          const grupo = visibles.filter((i) => i.gravedad === nivel);
          if (grupo.length === 0) return null;
          return (
            <section key={nivel} className="qv-alertas__grupo" aria-label={`Alertas ${ETIQUETA_NIVEL[nivel].plural}`}>
              <h2 className="qv-alertas__nivel">
                {ETIQUETA_NIVEL[nivel].plural} <span>{grupo.length}</span>
              </h2>
              <ul className="qv-live-infracciones">
                {grupo.map((inf) => {
                  const pendiente = enCurso.has(inf.id);
                  const duracion = duracionInfraccion(inf);
                  return (
                    <li
                      key={inf.id}
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
                          {/* En vivo aún no lee una sesión de la URL: lleva al mapa sin preselección. */}
                          <Link href="/en-vivo" className="qv-live-btn">
                            <MapPin size={16} aria-hidden="true" />
                            Ver en mapa
                          </Link>
                          {puedeAtender(inf) && (
                            <button type="button" className="qv-live-btn" disabled={pendiente} onClick={() => void actuar(inf, 'atender')}>
                              Atender
                            </button>
                          )}
                          {puedeDescartar(inf) && (
                            <button type="button" className="qv-live-btn" disabled={pendiente} onClick={() => setDescarte({ id: inf.id, motivo: '' })}>
                              Descartar
                            </button>
                          )}
                          {puedeSancionar(inf) && (
                            <button type="button" className="qv-live-btn qv-live-btn--primario" disabled={pendiente} onClick={() => void abrirSancion(inf)}>
                              Sancionar
                            </button>
                          )}
                        </div>
                      )}
                      {errores[inf.id] && (
                        <p className="qv-live-panel__error" role="alert">
                          {errores[inf.id]}
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
            setSancion(null);
            void refrescar(sancion.inf.sesionId);
          }}
        />
      )}
    </div>
  );
}
