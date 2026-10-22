import { useEffect, useMemo, useState } from 'react';
import { Button, Loader, Tag } from '@quivo/design-system';
import type { EstadoJornada, JornadaVehiculo } from '@quivo/shared';
import { ChevronDown, ChevronUp, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useJornadasHoy } from '../../../src/lib/en-vivo/use-en-vivo';
import {
  agruparJornadas,
  contarAtrasados,
  debiaSalir,
  fechaSiDifiereDeHoy,
  lineaTiempo,
  textoResumen,
} from '../../../src/lib/en-vivo/jornadas';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import { mensajeError } from './map-builders';

const CLAVE_EXPANDIDA = 'qv:en-vivo:jornada-expandida';
const ID_LISTA = 'modulo-jornada-lista';

/** Color del punto de cada grupo. Es refuerzo: el estado SIEMPRE va también como texto. */
const CLASE_ESTADO: Record<EstadoJornada, string> = {
  sin_iniciar: 'qv-live-jornada__punto--sin-iniciar',
  dia_iniciado: 'qv-live-jornada__punto--dia-iniciado',
  en_recorrido: 'qv-live-jornada__punto--en-recorrido',
  finalizado: 'qv-live-jornada__punto--finalizado',
};

function capitalizar(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

function FilaVehiculo({ v, ahora }: { v: JornadaVehiculo; ahora: number }) {
  // "Debía salir" gana sobre "Sale HH:MM": a quien ya pasó su hora hay que llamarlo.
  const atraso = debiaSalir(v, ahora);
  const tiempo = atraso ? { texto: atraso, atenuado: false } : lineaTiempo(v, ahora);
  return (
    <li className="qv-live-jornada__fila">
      <span className="qv-live-jornada__linea1">
        <strong translate="no" className="qv-live-jornada__placa">
          {v.placa}
        </strong>
        {v.numeroInterno && <span className="qv-live-jornada__sec">#{v.numeroInterno}</span>}
        <span className="qv-live-jornada__sec">
          {v.lineaNombre} · {capitalizar(v.rutaSentido)}
        </span>
      </span>
      <span className="qv-live-jornada__sec">{v.conductorNombre ?? 'Sin conductor'}</span>
      {tiempo && (
        <span
          className={`qv-live-jornada__tiempo${tiempo.atenuado ? ' qv-live-jornada__tiempo--atenuado' : ''}${atraso ? ' qv-live-jornada__tiempo--atraso' : ''}`}
        >
          {tiempo.texto}
        </span>
      )}
    </li>
  );
}

/**
 * "Jornada de hoy" compacta, dentro del panel de flota: qué vehículos asignados declararon
 * "Empezar día" desde la app móvil, cuáles están en recorrido, cuáles todavía no iniciaron y
 * cuáles ya debían haber salido. Solo lectura; obedece al filtro de línea.
 *
 * Nace PLEGADO: el resumen ya responde la pregunta frecuente y el detalle por vehículo se abre a
 * pedido (se recuerda por navegador, solo conveniencia). Es dueño de su query y de su reloj
 * (30 s) para que el poll no re-renderice la página del mapa — mismo criterio que la barra de mando.
 * Es la ÚNICA instancia: la página vacía la reutiliza en lugar de duplicarla.
 */
export function ModuloJornada({ lineaFilter }: { lineaFilter: string }) {
  const { token } = useAuth();
  const jornadas = useJornadasHoy(token);
  // 30 s: la fuente se refresca con el mismo ritmo; un tick de 1 Hz no aportaría información.
  const ahora = useReloj(30_000);
  const [expandido, setExpandido] = useState(false);

  // Se lee en un efecto (no en el inicializador) para no divergir del HTML del servidor.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_EXPANDIDA) === '1') setExpandido(true);
    } catch {
      /* almacenamiento bloqueado: se queda plegado */
    }
  }, []);

  const alternar = () => {
    const siguiente = !expandido;
    setExpandido(siguiente);
    try {
      window.localStorage.setItem(CLAVE_EXPANDIDA, siguiente ? '1' : '0');
    } catch {
      /* sin persistencia: no es crítico */
    }
  };

  const { grupos, resumen } = useMemo(
    () => agruparJornadas(jornadas.data?.vehiculos ?? [], lineaFilter),
    [jornadas.data, lineaFilter],
  );
  const atrasados = useMemo(
    () => contarAtrasados(jornadas.data?.vehiculos ?? [], lineaFilter, ahora),
    [jornadas.data, lineaFilter, ahora],
  );

  const sinDatos = !jornadas.data;
  // Hay datos pero el último refetch falló: lo que se ve es viejo y hay que decirlo.
  const desactualizado = jornadas.isError && !sinDatos;
  const fechaAjena = jornadas.data ? fechaSiDifiereDeHoy(jornadas.data.fecha, ahora) : null;
  const resumenTexto = jornadas.isLoading
    ? 'Cargando…'
    : sinDatos && jornadas.isError
      ? 'No disponible'
      : textoResumen(resumen) + (desactualizado ? ' · sin actualizar' : '');

  return (
    <section className="qv-live-modulo" aria-label="Jornada de hoy">
      <button
        type="button"
        className="qv-live-jornada__toggle"
        onClick={alternar}
        aria-expanded={expandido}
        aria-controls={ID_LISTA}
      >
        <ClipboardCheck size={15} aria-hidden="true" className="qv-live-jornada__icono" />
        <span className="qv-live-jornada__cabecera">
          <strong>Jornada de hoy</strong>
          <span className="qv-live-jornada__sec">{resumenTexto}</span>
          {atrasados > 0 && (
            <span className="qv-live-jornada__atraso">
              {atrasados} {atrasados === 1 ? 'debía salir ya' : 'debían salir ya'}
            </span>
          )}
        </span>
        {expandido ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>

      <div id={ID_LISTA} hidden={!expandido} className="qv-live-jornada__lista">
        {jornadas.isLoading && <Loader label="Cargando jornada…" />}

        {desactualizado && (
          <div role="status" className="qv-live-jornada__aviso">
            <span>No se pudo actualizar; se muestran los últimos datos.</span>
            <Button size="sm" variant="secondary" onClick={() => void jornadas.refetch()}>
              Reintentar
            </Button>
          </div>
        )}

        {fechaAjena && <p className="qv-live-jornada__sec">Datos del {fechaAjena}</p>}

        {sinDatos && jornadas.isError && (
          <div role="alert" className="qv-live-jornada__aviso qv-live-jornada__aviso--columna">
            <span>No se pudo cargar la jornada: {mensajeError(jornadas.error)}</span>
            <span>
              <Button size="sm" variant="secondary" onClick={() => void jornadas.refetch()}>
                Reintentar
              </Button>
            </span>
          </div>
        )}

        {jornadas.data && resumen.total === 0 && (
          <p className="qv-live-jornada__sec">
            {lineaFilter ? 'Sin vehículos asignados hoy en esta línea' : 'Sin vehículos asignados hoy'}
          </p>
        )}

        {grupos.map((g) => (
          <section key={g.estado} aria-label={g.etiqueta} className="qv-live-jornada__grupo">
            <h2 className="qv-live-jornada__h">
              <span aria-hidden="true" className={`qv-live-jornada__punto ${CLASE_ESTADO[g.estado]}`} />
              {g.etiqueta}
              <Tag variant="neutral">{g.vehiculos.length}</Tag>
            </h2>
            <ul>
              {g.vehiculos.map((v) => (
                <FilaVehiculo key={v.vehiculoId} v={v} ahora={ahora} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
