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
import { telefonoParaWhatsapp, urlLlamada } from '../../src/lib/en-vivo/alertas';
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

function TarjetaKpi({ kpi }: { kpi: Kpi }) {
  const cuerpo = (
    <>
      <span className="qv-hoy__kpi-etiqueta">
        {kpi.icono}
        {kpi.etiqueta}
      </span>
      <span className="qv-hoy__kpi-valor" aria-busy={kpi.valor === null}>
        {kpi.valor === null ? <span className="qv-hoy__kpi-cargando" role="status" aria-label="Cargando" /> : kpi.valor}
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
  const posiciones = usePosicionesEnVivo(token);
  const jornadas = useJornadasHoy(token);
  const alertas = useInfraccionesHoy(token);
  // Mismo filtro que `/reglas` y el padrón: las sanciones pendientes de hoy no tienen otro endpoint.
  const sanciones = useQuery({
    queryKey: ['hoy', 'sanciones-pendientes'],
    enabled: Boolean(token),
    queryFn: () => sancionesApi.listar(token as string, { estado: 'pendiente' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const buscando = normalizarBusqueda(consulta).length >= BUSQUEDA_MIN;
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

  const valorDe = <T,>(q: { data: T | undefined; isError: boolean }, f: (d: T) => number): number | string | null =>
    q.data !== undefined ? f(q.data) : q.isError ? '—' : null;

  const flota = posiciones.data ? resumenFlota(conteoPorEstado(posiciones.data)) : null;
  const abiertas = alertas.data?.filter((i) => i.estado === 'abierta');
  const graves = abiertas?.filter((i) => i.gravedad !== 'leve').length ?? 0;
  const kpis: Kpi[] = [
    {
      id: 'servicio',
      etiqueta: 'En servicio',
      icono: <Bus size={18} aria-hidden="true" />,
      valor: flota ? flota.enServicio : posiciones.isError ? '—' : null,
      ayuda: flota ? `de ${flota.total} en flota` : undefined,
    },
    {
      id: 'inactivos',
      etiqueta: 'Inactivos',
      icono: <Moon size={18} aria-hidden="true" />,
      valor: posiciones.data ? conteoPorEstado(posiciones.data).inactivo : posiciones.isError ? '—' : null,
    },
    {
      id: 'alertas',
      etiqueta: 'Alertas abiertas',
      icono: <Bell size={18} aria-hidden="true" />,
      valor: abiertas ? abiertas.length : alertas.isError ? '—' : null,
      ayuda: abiertas ? `${graves} grave${graves === 1 ? '' : 's'}` : undefined,
      href: '/alertas',
    },
    {
      id: 'sanciones',
      etiqueta: 'Sanciones pendientes',
      icono: <Ban size={18} aria-hidden="true" />,
      valor: valorDe(sanciones, (d) => d.length),
      href: '/reglas',
    },
  ];

  const resultados =
    buscando && vehiculos.data && conductores.data ? buscarHoy(consulta, vehiculos.data, conductores.data, jornadas.data?.vehiculos ?? []) : [];
  const errorBusqueda = vehiculos.isError ? vehiculos.error : conductores.isError ? conductores.error : null;

  return (
    <div className="qv-hoy">
      <PageHeader title="Hoy" subtitle="Resumen del día y consultas rápidas" />

      <section className="qv-hoy__kpis" aria-label="Resumen del día">
        {kpis.map((k) => (
          <TarjetaKpi key={k.id} kpi={k} />
        ))}
      </section>

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
            placeholder="Placa o nombre"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
          />
        </div>

        {buscando && (vehiculos.isPending || conductores.isPending) && <Loader label="Buscando…" />}
        {errorBusqueda !== null && (
          <Alert variant="danger" title="No se pudo buscar">
            {mensajeError(errorBusqueda)}
          </Alert>
        )}
        {buscando && vehiculos.data && conductores.data && (
          <p className="qv-hoy__resumen" role="status">
            {resultados.length === 0 ? 'Sin resultados' : `${resultados.length} resultado${resultados.length === 1 ? '' : 's'}`}
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
                        <a className="qv-live-btn" href={tel}>
                          <Phone size={18} aria-hidden="true" />
                          Llamar
                        </a>
                      )}
                      {wa && (
                        <a className="qv-live-btn" href={wa} target="_blank" rel="noopener noreferrer">
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
