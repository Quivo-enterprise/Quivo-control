'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, ConfirmDialog, DataTable, PlateBadge, StatusBadge, Tag } from '@quivo/design-system';
import type { FilaSalidaPanelItem, SalidaRecientePanel } from '@quivo/shared';
import { Clock3, History } from 'lucide-react';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import {
  ETIQUETA_ESTADO_FILA,
  ETIQUETA_ORIGEN,
  estadoVisualFila,
  formatearCuenta,
  horaLocalBolivia,
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

type Accion = { tipo: 'despachar' | 'retirar'; item: FilaSalidaPanelItem };

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

  const data = fila.data;
  // `dataUpdatedAt` = cuándo llegó esta respuesta al navegador; con `servidorTs` da el desfase de reloj.
  const offsetMs = useMemo(
    () => (data ? offsetServidorMs(data.servidorTs, fila.dataUpdatedAt) : 0),
    [data, fila.dataUpdatedAt],
  );

  const ejecutar = async (accion: 'despachar' | 'moverAlFinal' | 'retirar', item: FilaSalidaPanelItem) => {
    setErrorAccion(null);
    try {
      await acciones[accion].mutateAsync(item.id);
    } catch (e) {
      setErrorAccion(mensajeError(e));
    }
  };

  const confirmar = () => {
    if (!pendiente) return;
    const { tipo, item } = pendiente;
    setPendiente(null);
    void ejecutar(tipo, item);
  };

  const ocupado = acciones.despachar.isPending || acciones.moverAlFinal.isPending || acciones.retirar.isPending;
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
            { key: 'llegada', header: 'Llegó', render: (r) => <span style={NUM}>{horaLocalBolivia(r.llegadaTs)}</span> },
            { key: 'eta', header: 'Sale', render: (r) => <span style={NUM}>{horaLocalBolivia(r.etaTs)}</span> },
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
                aria-label={`Despachar ${r.placa}`}
                onClick={() => (r.habilitado ? void ejecutar('despachar', r) : setPendiente({ tipo: 'despachar', item: r }))}
              >
                Despachar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={ocupado || items.length < 2}
                aria-label={`Mover ${r.placa} al final`}
                onClick={() => void ejecutar('moverAlFinal', r)}
              >
                Al final
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={ocupado}
                aria-label={`Retirar ${r.placa}`}
                onClick={() => setPendiente({ tipo: 'retirar', item: r })}
              >
                Retirar
              </Button>
            </span>
          )}
        />
        {data && (
          <p style={{ ...MUTED, margin: 0 }}>
            {data.baseMin === null
              ? 'La parada no tiene frecuencia base: configurala abajo para calcular las horas de salida.'
              : `Frecuencia base: ${data.baseMin} min. Se actualiza cada 5 segundos.`}
          </p>
        )}
        <Recientes salidas={data?.salidasRecientes ?? []} />
      </div>
      <ConfirmDialog
        open={pendiente !== null}
        variant={pendiente?.tipo === 'retirar' ? 'danger' : 'primary'}
        title={pendiente?.tipo === 'retirar' ? 'Retirar de la fila' : 'Despachar antes de su hora'}
        message={
          pendiente?.tipo === 'retirar'
            ? `${pendiente.item.placa} sale de la fila sin registrarse como salida.`
            : `${pendiente?.item.placa ?? ''} todavía no está habilitado. La salida queda marcada como anticipada.`
        }
        confirmLabel={pendiente?.tipo === 'retirar' ? 'Retirar' : 'Despachar'}
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
          { key: 'hora', header: 'Salió', render: (r) => <span style={NUM}>{horaLocalBolivia(r.salidaTs)}</span> },
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
