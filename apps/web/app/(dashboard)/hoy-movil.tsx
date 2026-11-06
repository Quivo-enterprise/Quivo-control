'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Loader, PageHeader, PlateBadge, StatusBadge } from '@quivo/design-system';
import { formatearTelefonoBolivia } from '@quivo/shared';
import { ChevronRight, Clock, MessageCircle, Phone, Search } from 'lucide-react';
import { useAuth } from '../../src/lib/auth/auth-context';
import { conductoresApi } from '../../src/lib/api/conductores';
import { vehiculosApi } from '../../src/lib/api/vehiculos';
import { conteoPorEstado, resumenFlota } from '../../src/lib/en-vivo/atencion';
import { horaBo, telefonoParaWhatsapp, textoAlertasAbiertas, urlLlamada } from '../../src/lib/en-vivo/alertas';
import { useReloj } from '../../src/lib/en-vivo/use-reloj';
import { useInfraccionesHoy, useJornadasHoy, usePosicionesEnVivo } from '../../src/lib/en-vivo/use-en-vivo';
import { LIMITE_SANCIONES_API, useSancionesPendientes } from '../../src/lib/hoy/use-sanciones-pendientes';
import { useSaludRefresco } from '../../src/lib/en-vivo/use-salud-refresco';
import { BUSQUEDA_MIN, buscarHoy, estadoVehiculoHoy, fechaHoy, haceCorto, normalizarBusqueda, posicionDeVehiculo } from '../../src/lib/hoy/hoy.logic';
import { mensajeError } from './en-vivo/map-builders';

interface Kpi {
  id: string;
  /** Texto visible (comp B: corto). */
  etiqueta: string;
  /** Nombre completo para lectores de pantalla cuando la etiqueta visible es abreviada. */
  nombre?: string;
  /** Modificador de color: `servicio`, `alerta` o `sanciones`. */
  clase?: string;
  /** "N graves" junto a la etiqueta; solo con graves > 0. */
  chip?: string;
  /** `null` = cargando (nunca un 0 inventado); `'—'` = error al cargar. */
  valor: number | string | null;
  href?: string;
}

function TarjetaKpi({ kpi }: { kpi: Kpi }) {
  // Comp B: el número va primero y la etiqueta debajo.
  const cuerpo = (
    <>
      <span className="qv-hoy__kpi-valor">
        {kpi.valor === null ? <span className="qv-hoy__kpi-cargando" aria-hidden="true" /> : kpi.valor}
      </span>
      <span className="qv-hoy__kpi-etiqueta">
        {kpi.nombre ? (
          <>
            <span aria-hidden="true">{kpi.etiqueta}</span>
            <span className="qv-visually-hidden">{kpi.nombre}</span>
          </>
        ) : (
          kpi.etiqueta
        )}
        {kpi.chip && <b className="qv-hoy__chip">{kpi.chip}</b>}
        {kpi.href && <ChevronRight className="qv-hoy__kpi-flecha" size={18} aria-hidden="true" />}
      </span>
    </>
  );
  const clase = `qv-hoy__kpi${kpi.clase ? ` qv-hoy__kpi--${kpi.clase}` : ''}`;
  return kpi.href ? (
    <Link href={kpi.href} className={`${clase} qv-hoy__kpi--link`}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clase}>{cuerpo}</div>
  );
}

const INTERVALO_HOY_MS = 15_000;

const PILDORA: Record<'ok' | 'lento' | 'sin_conexion', { texto: string; clase: string }> = {
  ok: { texto: 'En vivo', clase: '' },
  lento: { texto: 'Lento', clase: ' qv-live-pill--lento' },
  sin_conexion: { texto: 'Sin conexión', clase: ' qv-live-pill--off' },
};

/** Hoja: el tick de 1 Hz de `useSaludRefresco` re-renderiza solo la píldora. Sin primer dato no muestra nada. */
function PildoraEnVivo({ consulta }: { consulta: { dataUpdatedAt: number; isError: boolean } }) {
  const salud = useSaludRefresco(consulta, INTERVALO_HOY_MS);
  if (!consulta.dataUpdatedAt && !consulta.isError) return null;
  const { texto, clase } = PILDORA[salud.estado];
  return (
    <span className={`qv-live-pill${clase}`} role="status">
      <span className="qv-live-pill__dot" aria-hidden="true" />
      {texto}
    </span>
  );
}

/** Hoja: el tick de 1 s re-renderiza solo este texto. La antigüedad del fix la mide el servidor al responder: se le suma lo que pasó desde el poll. */
function HaceFix({ antiguedadFixMs, actualizadoEn }: { antiguedadFixMs: number | null; actualizadoEn: number }) {
  const ahora = useReloj(1000);
  const hace = haceCorto(antiguedadFixMs === null ? null : antiguedadFixMs + (ahora - actualizadoEn));
  if (!hace) return null;
  return (
    <p className="qv-hoy__resultado-meta">
      <Clock size={18} aria-hidden="true" />
      {hace}
    </p>
  );
}

export function HoyMovil() {
  const { token } = useAuth();
  const [consulta, setConsulta] = useState('');
  const [reintentando, setReintentando] = useState(false);
  const n = normalizarBusqueda(consulta).length;
  const buscando = n >= BUSQUEDA_MIN;
  // Home: refresco lento (15 s); las jornadas solo hacen falta para cruzar el conductor al buscar.
  const posiciones = usePosicionesEnVivo(token, INTERVALO_HOY_MS);
  const jornadas = useJornadasHoy(token, buscando);
  const alertas = useInfraccionesHoy(token);
  const sanciones = useSancionesPendientes(token);

  const vehiculos = useQuery({
    queryKey: ['hoy', 'vehiculos'],
    enabled: Boolean(token) && buscando,
    staleTime: 60_000,
    queryFn: () => vehiculosApi.listar(token as string),
  });
  const conductores = useQuery({
    queryKey: ['hoy', 'conductores'],
    enabled: Boolean(token) && buscando,
    staleTime: 60_000,
    queryFn: () => conductoresApi.listar(token as string),
  });

  // Sin datos, `isError` se limpia en cada refetch (poll de 30 s): `errorUpdateCount` mantiene estable el fallo y el banner.
  const falla = (q: { isError: boolean; data: unknown; errorUpdateCount: number }) =>
    q.isError || (q.data === undefined && q.errorUpdateCount > 0);
  const valorDe = <T,>(q: { data: T | undefined; isError: boolean; errorUpdateCount: number }, f: (d: T) => number | string): number | string | null =>
    q.data !== undefined ? f(q.data) : falla(q) ? '—' : null;

  const conteo = posiciones.data ? conteoPorEstado(posiciones.data) : null;
  const enServicio = conteo ? resumenFlota(conteo).enServicio : 0;
  const abiertas = alertas.data?.filter((i) => i.estado === 'abierta');
  const graves = abiertas?.filter((i) => i.gravedad !== 'leve').length ?? 0;
  const kpis: Kpi[] = [
    {
      id: 'servicio',
      etiqueta: 'En servicio',
      clase: 'servicio',
      valor: valorDe(posiciones, () => enServicio),
    },
    {
      id: 'inactivos',
      etiqueta: 'Inactivos',
      valor: valorDe(posiciones, () => conteo?.inactivo ?? 0),
    },
    {
      id: 'alertas',
      etiqueta: 'Alertas abiertas',
      // Rojo solo si hay alertas abiertas; en 0 el tile queda neutro.
      clase: abiertas && abiertas.length > 0 ? 'alerta' : undefined,
      valor: valorDe(alertas, () => abiertas?.length ?? 0),
      chip: graves > 0 ? `${graves} grave${graves === 1 ? '' : 's'}` : undefined,
      href: '/alertas',
    },
    {
      id: 'sanciones',
      etiqueta: 'Sanciones pend.',
      nombre: 'Sanciones pendientes',
      clase: 'sanciones',
      valor: valorDe(sanciones, (d) => (d.length >= LIMITE_SANCIONES_API ? `${LIMITE_SANCIONES_API}+` : d.length)),
      href: '/reglas',
    },
  ];

  const fallidas = [posiciones, alertas, sanciones].filter(falla);
  const sinDatos = fallidas.some((q) => q.data === undefined);
  const conViejos = fallidas.filter((q) => q.data !== undefined);
  // Con datos viejos conservados (poll fallido) se muestran los KPIs con la hora del último dato bueno.
  const mensajeErrorKpis = [
    sinDatos && 'No se pudo cargar',
    conViejos.length > 0 && `No se pudo actualizar; mostrando datos de ${horaBo(Math.min(...conViejos.map((q) => q.dataUpdatedAt)))}`,
  ]
    .filter(Boolean)
    .join('. ');
  // `reintentando` solo deshabilita el botón: el banner ya no depende de `isError`.
  const reintentar = () => {
    setReintentando(true);
    void Promise.allSettled(fallidas.map((q) => q.refetch())).finally(() => setReintentando(false));
  };

  const { resultados, total } =
    buscando && vehiculos.data && conductores.data
      ? buscarHoy(consulta, vehiculos.data, conductores.data, jornadas.data?.vehiculos ?? [])
      : { resultados: [], total: 0 };
  const errorBusqueda = vehiculos.isError ? vehiculos.error : conductores.isError ? conductores.error : null;

  return (
    <div className="qv-hoy">
      {/* El nombre del sindicato no viaja en `useAuth().user` (solo `sindicatoId`): el subtítulo lleva solo la fecha. */}
      <PageHeader title="Hoy" subtitle={fechaHoy()} actions={<PildoraEnVivo consulta={posiciones} />} />

      <p className="qv-visually-hidden" aria-live="polite">
        {abiertas ? textoAlertasAbiertas(abiertas.length) : ''}
      </p>
      <section className="qv-hoy__kpis" aria-labelledby="hoy-resumen" aria-busy={kpis.some((k) => k.valor === null)}>
        <h2 id="hoy-resumen" className="qv-hoy__lbl">
          Resumen del día
        </h2>
        {kpis.map((k) => (
          <TarjetaKpi key={k.id} kpi={k} />
        ))}
      </section>
      {fallidas.length > 0 && (
        <div className="qv-hoy__error-kpis">
          <p role="alert">{mensajeErrorKpis}</p>
          <button type="button" className="qv-live-btn" disabled={reintentando} onClick={reintentar}>
            {reintentando ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      )}

      <section className="qv-hoy__buscar">
        <label htmlFor="hoy-buscar" className="qv-visually-hidden">
          Buscar placa o conductor
        </label>
        <div className="qv-hoy__buscar-campo">
          <Search size={24} aria-hidden="true" />
          <input
            id="hoy-buscar"
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Buscar placa o conductor"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          />
        </div>

        {n > 0 && n < BUSQUEDA_MIN && (
          <p className="qv-hoy__resumen">Escribe al menos {BUSQUEDA_MIN} caracteres.</p>
        )}
        {buscando && jornadas.data === undefined && falla(jornadas) && (
          <Alert variant="warning" title="No se pudo cargar la jornada de hoy: no se puede enlazar el conductor de cada vehículo." />
        )}
        {buscando && (vehiculos.isPending || conductores.isPending) && <Loader label="Buscando…" />}
        {buscando && errorBusqueda !== null && (
          <Alert variant="danger" title="No se pudo buscar">
            {mensajeError(errorBusqueda)}
          </Alert>
        )}
        {buscando && vehiculos.data && conductores.data && (
          <p className="qv-hoy__lbl qv-hoy__lbl--resultados" role="status">
            <span>
              {total === 0
                ? 'Sin resultados'
                : total > resultados.length
                  ? `${resultados.length} de ${total} resultados`
                  : `${total} resultado${total === 1 ? '' : 's'}`}
            </span>
            <span>“{consulta.trim()}”</span>
          </p>
        )}
        {resultados.length > 0 && (
          <ul className="qv-hoy__resultados">
            {resultados.map((r) => {
              const tel = urlLlamada(r.telefono);
              const numeroWa = telefonoParaWhatsapp(r.telefono);
              const wa = numeroWa ? `https://wa.me/${numeroWa}` : null;
              const pos = r.tipo === 'vehiculo' ? posicionDeVehiculo(posiciones.data ?? [], r.id) : undefined;
              const est = pos ? estadoVehiculoHoy(pos) : null;
              const linea = est?.linea ?? r.lineaNombre;
              const conductor = r.tipo === 'vehiculo' ? (r.conductorNombre ?? pos?.conductorNombre ?? null) : r.titulo;
              return (
                <li key={`${r.tipo}-${r.id}`} className="qv-hoy__resultado">
                  {(r.tipo === 'vehiculo' || linea) && (
                    <div className="qv-hoy__resultado-top">
                      {r.tipo === 'vehiculo' && <PlateBadge plate={r.titulo} size="lg" />}
                      {linea && <span className="qv-hoy__tag">{linea}</span>}
                    </div>
                  )}
                  {conductor && <p className="qv-hoy__resultado-nombre">{conductor}</p>}
                  {pos && est ? (
                    <>
                      <p className="qv-hoy__resultado-estado">
                        <StatusBadge status={est.insignia} label={est.etiqueta} />
                        {est.kmh !== null && <span>· {est.kmh} km/h</span>}
                        {est.vuelta !== null && <span>· vuelta {est.vuelta}</span>}
                      </p>
                      <HaceFix antiguedadFixMs={pos.antiguedadFixMs} actualizadoEn={posiciones.dataUpdatedAt} />
                    </>
                  ) : (
                    <p className="qv-hoy__resultado-detalle">{r.tipo === 'vehiculo' && r.lineaNombre && posiciones.data !== undefined ? 'Sin sesión hoy' : r.detalle}</p>
                  )}
                  {r.telefono && <p className="qv-hoy__resultado-tel">{formatearTelefonoBolivia(r.telefono)}</p>}
                  {(tel || wa) && (
                    <div className="qv-hoy__resultado-acciones">
                      {tel && (
                        <a className="qv-hoy__btn" href={tel} aria-label={`Llamar a ${conductor ?? r.titulo}`}>
                          <Phone size={24} aria-hidden="true" />
                          Llamar
                        </a>
                      )}
                      {wa && (
                        <a className="qv-hoy__btn qv-hoy__btn--wa" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp a ${conductor ?? r.titulo} (abre WhatsApp)`}>
                          <MessageCircle size={24} aria-hidden="true" />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
