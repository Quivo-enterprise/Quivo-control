'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, ConfirmDialog, DataTable, PlateBadge, StatusBadge, Tag } from '@quivo/design-system';
import type { FilaSalidaPanelItem, SalidaRecientePanel } from '@quivo/shared';
import { Clock3, History } from 'lucide-react';
import { formatearHoraBolivia } from '../../../src/lib/en-vivo/jornadas';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import {
  ETIQUETA_ESTADO_FILA,
  ETIQUETA_ORIGEN,
  estadoVisualFila,
  formatearCuenta,
  offsetServidorMs,
  restanteMs,
  type EstadoVisualFila,
} from '../../../src/lib/salidas/salidas.logic';
import { mensajeError, useAccionesFila, useFilaSalida } from './use-salidas';

const ESTADO_BADGE: Record<EstadoVisualFila, 'active' | 'warning' | 'idle'> = {
  en_turno: 'active',
  demorado: 'warning',
  esperando: 'idle',
};

const MUTED = { color: 'var(--qv-text-secondary)', fontSize: 'var(--qv-text-sm)' } as const;
const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

type TipoAccion = 'despachar' | 'moverAlFinal' | 'retirar';
type Accion = { tipo: TipoAccion; item: FilaSalidaPanelItem };

const TEXTO_PROGRESO: Record<TipoAccion, string> = {
  despachar: 'Despachando…',
  moverAlFinal: 'Moviendo…',
  retirar: 'Retirando…',
};

const DIALOGO: Record<TipoAccion, { titulo: string; confirmar: string; mensaje: (placa: string) => string }> = {
  despachar: {
    titulo: 'Despachar antes de su hora',
    confirmar: 'Despachar',
    mensaje: (placa) => `${placa} todavía no está habilitado. La salida queda marcada como anticipada.`,
  },
  moverAlFinal: {
    titulo: 'Mover al final de la fila',
    confirmar: 'Mover al final',
    mensaje: (placa) => `${placa} pasa al último lugar y se recalculan las horas de salida de toda la fila.`,
  },
  retirar: {
    titulo: 'Retirar de la fila',
    confirmar: 'Retirar',
    mensaje: (placa) => `${placa} sale de la fila sin registrarse como salida.`,
  },
};

const hhmm = (ms: number) => formatearHoraBolivia(new Date(ms).toISOString());

/**
 * Cuenta hasta la salida. El tick de 1 Hz vive en esta hoja (como `PanelFrescura`): repinta
 * solo el texto, no la tabla. La hora de referencia es la del servidor (`offsetMs`).
 */
function CuentaFila({ etaTs, offsetMs }: { etaTs: string; offsetMs: number }) {
  const ahora = useReloj(1_000);
  const restante = restanteMs(etaTs, offsetMs, ahora);
  return (
    <span style={{ ...NUM, fontWeight: 700, color: restante < 0 ? 'var(--qv-color-warning)' : undefined }}>
      {formatearCuenta(restante)}
    </span>
  );
}

export function FilaEnVivo({
  token,
  pcId,
  internoPorVehiculo,
}: {
  token: string;
  pcId: string;
  internoPorVehiculo: Record<string, string>;
}) {
  const fila = useFilaSalida(token, pcId);
  const acciones = useAccionesFila(token, pcId);
  const [pendiente, setPendiente] = useState<Accion | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState<{ tipo: TipoAccion; id: string } | null>(null);

  const data = fila.data;
  // `dataUpdatedAt` = cuándo llegó esta respuesta al navegador; con `servidorTs` da el desfase de reloj.
  const offsetMs = useMemo(
    () => (data ? offsetServidorMs(data.servidorTs, fila.dataUpdatedAt) : 0),
    [data, fila.dataUpdatedAt],
  );

  const ejecutar = async (accion: TipoAccion, item: FilaSalidaPanelItem) => {
    setErrorAccion(null);
    setEnCurso({ tipo: accion, id: item.id });
    try {
      await acciones[accion].mutateAsync(item.id);
    } catch (e) {
      setErrorAccion(mensajeError(e));
    } finally {
      setEnCurso(null);
    }
  };

  const confirmar = () => {
    if (!pendiente) return;
    const { tipo, item } = pendiente;
    setPendiente(null);
    void ejecutar(tipo, item);
  };

  const ocupado = enCurso !== null;
  // `isError` con datos en caché = el poll falla pero se sigue mostrando la última respuesta.
  const sinConexionConDatos = fila.isError && Boolean(data);
  const progreso = (tipo: TipoAccion, id: string) => enCurso?.tipo === tipo && enCurso.id === id;
  const items = data?.items ?? [];

  return (
    <Card
      header={
        <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Clock3 size={18} aria-hidden /> Fila en vivo
          {data && <Tag variant="neutral">{items.length} en fila</Tag>}
        </h2>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sinConexionConDatos && (
          <Alert variant="warning" title="Sin conexión">
            Datos de las {hhmm(fila.dataUpdatedAt)}, pueden estar desactualizados. Se reintenta solo.
          </Alert>
        )}
        {errorAccion && (
          <Alert variant="danger" title="No se pudo completar la acción">
            {errorAccion}
          </Alert>
        )}
        <DataTable<FilaSalidaPanelItem>
          loading={fila.isPending}
          error={fila.isError && !data ? mensajeError(fila.error) : undefined}
          empty="No hay trufis en la fila. Aparecen apenas llegan a la terminal."
          rows={items}
          columns={[
            { key: 'posicion', header: '#', render: (r) => <strong style={NUM}>{r.posicion}</strong> },
            {
              key: 'placa',
              header: 'Trufi',
              render: (r) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <PlateBadge plate={r.placa} />
                  {internoPorVehiculo[r.vehiculoId] && (
                    <span style={MUTED}>Int. {internoPorVehiculo[r.vehiculoId]}</span>
                  )}
                </span>
              ),
            },
            { key: 'llegada', header: 'Llegó', render: (r) => <span style={NUM}>{formatearHoraBolivia(r.llegadaTs)}</span> },
            { key: 'eta', header: 'Sale', render: (r) => <span style={NUM}>{formatearHoraBolivia(r.etaTs)}</span> },
            {
              key: 'cuenta',
              header: 'Faltan',
              render: (r) => <CuentaFila etaTs={r.etaTs} offsetMs={offsetMs} />,
            },
            {
              key: 'estado',
              header: 'Estado',
              render: (r) => {
                const estado = estadoVisualFila(r);
                return (
                  <span style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center' }}>
                    <StatusBadge status={ESTADO_BADGE[estado]} label={ETIQUETA_ESTADO_FILA[estado]} />
                    {r.anticipada && <Tag variant="accent">Anticipada</Tag>}
                  </span>
                );
              },
            },
          ]}
          actions={(r) => (
            <span style={{ display: 'inline-flex', gap: '0.375rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={r.habilitado ? 'primary' : 'secondary'}
                disabled={ocupado}
                aria-busy={progreso('despachar', r.id)}
                aria-label={`Despachar ${r.placa}`}
                onClick={() => (r.habilitado ? void ejecutar('despachar', r) : setPendiente({ tipo: 'despachar', item: r }))}
              >
                {progreso('despachar', r.id) ? TEXTO_PROGRESO.despachar : 'Despachar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={ocupado || items.length < 2}
                aria-busy={progreso('moverAlFinal', r.id)}
                aria-label={`Mover ${r.placa} al final`}
                onClick={() => setPendiente({ tipo: 'moverAlFinal', item: r })}
              >
                {progreso('moverAlFinal', r.id) ? TEXTO_PROGRESO.moverAlFinal : 'Al final'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={ocupado}
                aria-busy={progreso('retirar', r.id)}
                aria-label={`Retirar ${r.placa}`}
                onClick={() => setPendiente({ tipo: 'retirar', item: r })}
              >
                {progreso('retirar', r.id) ? TEXTO_PROGRESO.retirar : 'Retirar'}
              </Button>
            </span>
          )}
        />
        {data && (
          <p style={{ ...MUTED, margin: 0 }}>
            {data.baseMin === null
              ? 'La parada no tiene frecuencia base: configurala abajo para calcular las horas de salida.'
              : `Frecuencia base: ${data.baseMin} min.`}{' '}
            <span style={NUM}>Última actualización {hhmm(fila.dataUpdatedAt)}</span>
            {sinConexionConDatos ? '. Sin conexión: no se está actualizando.' : '. Se actualiza cada 5 segundos.'}
          </p>
        )}
        <Recientes salidas={data?.salidasRecientes ?? []} />
      </div>
      <ConfirmDialog
        open={pendiente !== null}
        variant={pendiente?.tipo === 'retirar' ? 'danger' : 'primary'}
        title={DIALOGO[pendiente?.tipo ?? 'despachar'].titulo}
        message={pendiente ? DIALOGO[pendiente.tipo].mensaje(pendiente.item.placa) : undefined}
        confirmLabel={DIALOGO[pendiente?.tipo ?? 'despachar'].confirmar}
        onConfirm={confirmar}
        onCancel={() => setPendiente(null)}
      />
    </Card>
  );
}

function Recientes({ salidas }: { salidas: SalidaRecientePanel[] }) {
  return (
    <section aria-label="Salidas recientes" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <History size={16} aria-hidden /> Salidas recientes
      </h3>
      <DataTable<SalidaRecientePanel>
        rows={salidas}
        empty="Todavía no salió ningún trufi hoy."
        columns={[
          { key: 'hora', header: 'Salió', render: (r) => <span style={NUM}>{formatearHoraBolivia(r.salidaTs)}</span> },
          { key: 'placa', header: 'Trufi', render: (r) => <PlateBadge plate={r.placa} /> },
          { key: 'origen', header: 'Origen', render: (r) => ETIQUETA_ORIGEN[r.salidaOrigen] ?? r.salidaOrigen },
          {
            key: 'anticipada',
            header: 'Anticipada',
            render: (r) => (r.anticipada ? <Tag variant="accent">Anticipada</Tag> : <span style={MUTED}>No</span>),
          },
        ]}
      />
    </section>
  );
}
