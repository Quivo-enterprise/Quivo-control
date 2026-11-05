'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Loader, PageHeader, PlateBadge } from '@quivo/design-system';
import { formatearTelefonoBolivia } from '@quivo/shared';
import { Ban, Bell, Bus, ChevronRight, MessageCircle, Moon, Phone, Search } from 'lucide-react';
import { useAuth } from '../../src/lib/auth/auth-context';
import { conductoresApi } from '../../src/lib/api/conductores';
import { sancionesApi } from '../../src/lib/api/sanciones';
import { vehiculosApi } from '../../src/lib/api/vehiculos';
import { conteoPorEstado, resumenFlota } from '../../src/lib/en-vivo/atencion';
import { horaBo, telefonoParaWhatsapp, urlLlamada } from '../../src/lib/en-vivo/alertas';
import { useInfraccionesHoy, useJornadasHoy, usePosicionesEnVivo } from '../../src/lib/en-vivo/use-en-vivo';
import { BUSQUEDA_MIN, buscarHoy, normalizarBusqueda } from '../../src/lib/hoy/hoy.logic';
import { mensajeError } from './en-vivo/map-builders';

interface Kpi {
  id: string;
  etiqueta: string;
  icono: ReactNode;
  /** `null` = cargando (nunca un 0 inventado); `'—'` = error al cargar. */
  valor: number | string | null;
  ayuda?: string;
  href?: string;
}

/** Tope de filas de `GET /sanciones` (LIMITE_FILAS en la API): con tantas, el conteo real es mayor. */
const LIMITE_SANCIONES_API = 200;

function TarjetaKpi({ kpi }: { kpi: Kpi }) {
  const cuerpo = (
    <>
      <span className="qv-hoy__kpi-etiqueta">
        {kpi.icono}
        {kpi.etiqueta}
      </span>
      <span className="qv-hoy__kpi-valor">
        {kpi.valor === null ? <span className="qv-hoy__kpi-cargando" aria-hidden="true" /> : kpi.valor}
      </span>
      {kpi.ayuda && <span className="qv-hoy__kpi-ayuda">{kpi.ayuda}</span>}
    </>
  );
  return kpi.href ? (
    <Link href={kpi.href} className="qv-hoy__kpi qv-hoy__kpi--link">
      {cuerpo}
      <ChevronRight className="qv-hoy__kpi-flecha" size={18} aria-hidden="true" />
    </Link>
  ) : (
    <div className="qv-hoy__kpi">{cuerpo}</div>
  );
}

export function HoyMovil() {
  const { token } = useAuth();
  const [consulta, setConsulta] = useState('');
  const n = normalizarBusqueda(consulta).length;
  const buscando = n >= BUSQUEDA_MIN;
  // Home: refresco lento (15 s); las jornadas solo hacen falta para cruzar el conductor al buscar.
  const posiciones = usePosicionesEnVivo(token, 15_000);
  const jornadas = useJornadasHoy(token, buscando);
  const alertas = useInfraccionesHoy(token);
  // Todas las pendientes (sin filtro de fecha). La API devuelve como máximo 200 filas y sin total.
  const sanciones = useQuery({
    queryKey: ['hoy', 'sanciones-pendientes'],
    enabled: Boolean(token),
    queryFn: () => sancionesApi.listar(token as string, { estado: 'pendiente' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

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

  const valorDe = <T,>(q: { data: T | undefined; isError: boolean }, f: (d: T) => number | string): number | string | null =>
    q.data !== undefined ? f(q.data) : q.isError ? '—' : null;

  const conteo = posiciones.data ? conteoPorEstado(posiciones.data) : null;
  const flota = conteo ? resumenFlota(conteo) : null;
  const abiertas = alertas.data?.filter((i) => i.estado === 'abierta');
  const graves = abiertas?.filter((i) => i.gravedad !== 'leve').length ?? 0;
  const kpis: Kpi[] = [
    {
      id: 'servicio',
      etiqueta: 'En servicio',
      icono: <Bus size={18} aria-hidden="true" />,
      valor: valorDe(posiciones, () => flota?.enServicio ?? 0),
      ayuda: flota ? `de ${flota.total} en flota` : undefined,
    },
    {
      id: 'inactivos',
      etiqueta: 'Inactivos',
      icono: <Moon size={18} aria-hidden="true" />,
      valor: valorDe(posiciones, () => conteo?.inactivo ?? 0),
    },
    {
      id: 'alertas',
      etiqueta: 'Alertas abiertas',
      icono: <Bell size={18} aria-hidden="true" />,
      valor: valorDe(alertas, () => abiertas?.length ?? 0),
      ayuda: abiertas ? `${graves} grave${graves === 1 ? '' : 's'}` : undefined,
      href: '/alertas',
    },
    {
      id: 'sanciones',
      etiqueta: 'Sanciones pendientes',
      icono: <Ban size={18} aria-hidden="true" />,
      valor: valorDe(sanciones, (d) => (d.length >= LIMITE_SANCIONES_API ? `${LIMITE_SANCIONES_API}+` : d.length)),
      href: '/reglas',
    },
  ];

  const fallidas = [posiciones, alertas, sanciones].filter((q) => q.isError);
  const sinDatos = fallidas.some((q) => q.data === undefined);
  const conViejos = fallidas.filter((q) => q.data !== undefined);
  const refrescando = fallidas.some((q) => q.isFetching);
  // Con datos viejos conservados (poll fallido) se muestran los KPIs con la hora del último dato bueno.
  const horaViejos = Math.min(...conViejos.map((q) => q.dataUpdatedAt));

  const { resultados, total } =
    buscando && vehiculos.data && conductores.data
      ? buscarHoy(consulta, vehiculos.data, conductores.data, jornadas.data?.vehiculos ?? [])
      : { resultados: [], total: 0 };
  const errorBusqueda = vehiculos.isError ? vehiculos.error : conductores.isError ? conductores.error : null;

  return (
    <div className="qv-hoy">
      <PageHeader title="Hoy" subtitle="Resumen del día y consultas rápidas" />

      <p className="qv-visually-hidden" aria-live="polite">
        {abiertas ? `${abiertas.length} alerta${abiertas.length === 1 ? '' : 's'} abierta${abiertas.length === 1 ? '' : 's'}` : ''}
      </p>
      <section className="qv-hoy__kpis" aria-label="Resumen del día" aria-busy={kpis.some((k) => k.valor === null)}>
        {kpis.map((k) => (
          <TarjetaKpi key={k.id} kpi={k} />
        ))}
      </section>
      {fallidas.length > 0 && (
        <p className="qv-hoy__error-kpis" role="alert">
          <span>
            {[sinDatos && 'No se pudo cargar', conViejos.length > 0 && `No se pudo actualizar; mostrando datos de ${horaBo(horaViejos)}`]
              .filter(Boolean)
              .join('. ')}
          </span>
          <button type="button" className="qv-live-btn" disabled={refrescando} onClick={() => fallidas.forEach((q) => void q.refetch())}>
            {refrescando ? 'Reintentando…' : 'Reintentar'}
          </button>
        </p>
      )}

      <section className="qv-hoy__buscar">
        <label htmlFor="hoy-buscar" className="qv-hoy__buscar-etiqueta">
          Buscar placa o conductor
        </label>
        <div className="qv-hoy__buscar-campo">
          <Search size={20} aria-hidden="true" />
          <input
            id="hoy-buscar"
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Placa o nombre…"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          />
        </div>

        {n > 0 && n < BUSQUEDA_MIN && (
          <p className="qv-hoy__resumen">Escribe al menos {BUSQUEDA_MIN} caracteres.</p>
        )}
        {buscando && jornadas.isError && (
          <Alert variant="warning" title="No se pudo cargar la jornada de hoy: no se puede enlazar el conductor de cada vehículo." />
        )}
        {buscando && (vehiculos.isPending || conductores.isPending) && <Loader label="Buscando…" />}
        {buscando && errorBusqueda !== null && (
          <Alert variant="danger" title="No se pudo buscar">
            {mensajeError(errorBusqueda)}
          </Alert>
        )}
        {buscando && vehiculos.data && conductores.data && (
          <p className="qv-hoy__resumen" role="status">
            {total === 0
              ? 'Sin resultados'
              : total > resultados.length
                ? `${resultados.length} de ${total} resultados`
                : `${total} resultado${total === 1 ? '' : 's'}`}
          </p>
        )}
        {resultados.length > 0 && (
          <ul className="qv-hoy__resultados">
            {resultados.map((r) => {
              const tel = urlLlamada(r.telefono);
              const numeroWa = telefonoParaWhatsapp(r.telefono);
              const wa = numeroWa ? `https://wa.me/${numeroWa}` : null;
              return (
                <li key={`${r.tipo}-${r.id}`} className="qv-hoy__resultado">
                  <div className="qv-hoy__resultado-info">
                    {r.tipo === 'vehiculo' ? <PlateBadge plate={r.titulo} /> : <strong className="qv-hoy__resultado-nombre">{r.titulo}</strong>}
                    <span className="qv-hoy__resultado-detalle">{r.detalle}</span>
                    {r.telefono && <span className="qv-hoy__resultado-tel">{formatearTelefonoBolivia(r.telefono)}</span>}
                  </div>
                  {(tel || wa) && (
                    <div className="qv-hoy__resultado-acciones">
                      {tel && (
                        <a className="qv-live-btn" href={tel} aria-label={`Llamar a ${r.titulo}`}>
                          <Phone size={18} aria-hidden="true" />
                          Llamar
                        </a>
                      )}
                      {wa && (
                        <a className="qv-live-btn" href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp a ${r.titulo} (abre WhatsApp)`}>
                          <MessageCircle size={18} aria-hidden="true" />
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
