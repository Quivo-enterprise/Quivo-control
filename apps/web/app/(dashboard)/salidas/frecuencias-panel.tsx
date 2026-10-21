'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Checkbox, ConfirmDialog, DataTable, FormField, Input, Select, Tag } from '@quivo/design-system';
import {
  BaseFrecuenciaSchema,
  CrearFrecuenciaReglaSchema,
  FRECUENCIA_MAX_MINUTOS,
  FRECUENCIA_MIN_MINUTOS,
  type AlcanceFrecuencia,
  type FrecuenciaRegla,
  type GrupoVehiculo,
  type Vehiculo,
} from '@quivo/shared';
import { Plus, Timer } from 'lucide-react';
import { formatearHoraBolivia } from '../../../src/lib/en-vivo/jornadas';
import {
  fechaCorta,
  hastaMinDeFormulario,
  horaAMinutos,
  mensajesReglaPorCampo,
  textoAlcance,
  textoFranja,
} from '../../../src/lib/salidas/salidas.logic';
import { enfocar } from '../../../src/lib/salidas/foco';
import { mensajeError, useAccionesFrecuencia, useReglasSalida } from './use-salidas';

const MUTED = { color: 'var(--qv-text-secondary)', fontSize: 'var(--qv-text-sm)' } as const;
const NUM = { fontVariantNumeric: 'tabular-nums' } as const;

interface Props {
  token: string;
  pcId: string;
  /** `null` = el rol no ve grupos (operador): el alcance "grupo" no se ofrece. */
  grupos: GrupoVehiculo[] | null;
  /** Solo trufis activos (selector de la regla por trufi). */
  vehiculos: Vehiculo[];
  /** Placa de todos los vehículos, para nombrar el alcance de reglas existentes. */
  placaPorId: Record<string, string>;
}

export function FrecuenciasPanel({ token, pcId, grupos, vehiculos, placaPorId }: Props) {
  const reglas = useReglasSalida(token, pcId);
  const { crearRegla, anularRegla, fijarBase } = useAccionesFrecuencia(token, pcId);
  const [anulando, setAnulando] = useState<FrecuenciaRegla | null>(null);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);

  const data = reglas.data;

  const confirmarAnular = async () => {
    if (!anulando) return;
    const id = anulando.id;
    setAnulando(null);
    setErrorAnular(null);
    try {
      await anularRegla.mutateAsync(id);
    } catch (e) {
      setErrorAnular(mensajeError(e));
    }
  };

  return (
    <Card
      header={
        <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Timer size={18} aria-hidden /> Frecuencias de hoy
          {data && <Tag variant="neutral">{fechaCorta(data.fecha)}</Tag>}
        </h2>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {reglas.isError && !data && <Alert variant="danger" title="No se pudieron cargar las frecuencias">{mensajeError(reglas.error)}</Alert>}
        {errorAnular && <Alert variant="danger" title="No se pudo anular la regla">{errorAnular}</Alert>}

        <BaseForm
          key={`${pcId}:${data?.baseMin ?? 'null'}`}
          baseMin={data?.baseMin ?? null}
          cargando={reglas.isPending}
          guardando={fijarBase.isPending}
          onGuardar={(frecuenciaSalidaMin) => fijarBase.mutateAsync({ frecuenciaSalidaMin })}
        />

        <DataTable<FrecuenciaRegla>
          loading={reglas.isPending}
          rows={data?.reglas ?? []}
          empty="No hay reglas para hoy: rige la frecuencia base."
          columns={[
            { key: 'alcance', header: 'Aplica a', render: (r) => textoAlcance(r, grupos ?? [], placaPorId) },
            { key: 'min', header: 'Cada', render: (r) => <strong style={NUM}>{r.minutos} min</strong> },
            { key: 'franja', header: 'Franja', render: (r) => <span style={NUM}>{textoFranja(r.desdeMin, r.hastaMin)}</span> },
            {
              key: 'quien',
              header: 'Creada',
              render: (r) => <span style={{ ...MUTED, ...NUM }}>a las {formatearHoraBolivia(r.creadaEn)}</span>,
            },
          ]}
          actions={(r) => (
            <Button
              size="sm"
              variant="danger"
              aria-label={`Anular regla de ${r.minutos} minutos`}
              disabled={anularRegla.isPending}
              onClick={() => setAnulando(r)}
            >
              Anular
            </Button>
          )}
        />

        <ReglaForm
          grupos={grupos}
          vehiculos={vehiculos}
          guardando={crearRegla.isPending}
          onCrear={(regla) => crearRegla.mutateAsync(regla)}
        />
      </div>
      <ConfirmDialog
        open={anulando !== null}
        variant="danger"
        title="Anular regla"
        message={
          anulando
            ? `Se anula la regla de ${anulando.minutos} min (${textoFranja(anulando.desdeMin, anulando.hastaMin).toLowerCase()}). La fila se recalcula con la regla que siga vigente.`
            : undefined
        }
        confirmLabel="Anular regla"
        onConfirm={() => void confirmarAnular()}
        onCancel={() => setAnulando(null)}
      />
    </Card>
  );
}

function BaseForm({
  baseMin,
  cargando,
  guardando,
  onGuardar,
}: {
  baseMin: number | null;
  cargando: boolean;
  guardando: boolean;
  onGuardar: (min: number | null) => Promise<unknown>;
}) {
  const [valor, setValor] = useState(baseMin === null ? '' : String(baseMin));
  const [error, setError] = useState<string | null>(null);

  const campo = useRef<HTMLDivElement>(null);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const numero = valor.trim() === '' ? null : Number(valor);
    const parsed = BaseFrecuenciaSchema.safeParse({ frecuenciaSalidaMin: numero });
    if (!parsed.success) {
      setError(`Ingresá un número entero de ${FRECUENCIA_MIN_MINUTOS} a ${FRECUENCIA_MAX_MINUTOS} minutos, o dejalo vacío.`);
      enfocar(campo.current, 'input');
      return;
    }
    setError(null);
    try {
      await onGuardar(parsed.data.frecuenciaSalidaMin);
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <form onSubmit={(e) => void guardar(e)} noValidate style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div ref={campo} style={{ flex: '1 1 12rem', minWidth: 0, maxWidth: '16rem' }}>
        <FormField
          label="Frecuencia base (minutos)"
          htmlFor="salidas-base"
          error={error ?? undefined}
          helperText="Rige cuando ninguna regla del día aplica."
        >
          <Input
            id="salidas-base"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={FRECUENCIA_MIN_MINUTOS}
            max={FRECUENCIA_MAX_MINUTOS}
            value={valor}
            disabled={cargando}
            onChange={(e) => setValor(e.target.value)}
            aria-invalid={Boolean(error)}
            fullWidth
          />
        </FormField>
      </div>
      <Button type="submit" variant="secondary" disabled={cargando || guardando}>
        {guardando ? 'Guardando…' : 'Guardar base'}
      </Button>
    </form>
  );
}

const OPCIONES_ALCANCE: { label: string; value: AlcanceFrecuencia }[] = [
  { label: 'Todos los trufis', value: 'todos' },
  { label: 'Un grupo', value: 'grupo' },
  { label: 'Un trufi', value: 'vehiculo' },
];

function ReglaForm({
  grupos,
  vehiculos,
  guardando,
  onCrear,
}: {
  grupos: GrupoVehiculo[] | null;
  vehiculos: Vehiculo[];
  guardando: boolean;
  onCrear: (regla: ReturnType<typeof CrearFrecuenciaReglaSchema.parse>) => Promise<unknown>;
}) {
  const [alcance, setAlcance] = useState<AlcanceFrecuencia>('todos');
  const [grupoId, setGrupoId] = useState('');
  const [vehiculoId, setVehiculoId] = useState('');
  const [minutos, setMinutos] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [hastaFinDelDia, setHastaFinDelDia] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);

  const alcances = OPCIONES_ALCANCE.filter((o) => o.value !== 'grupo' || grupos !== null);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    setErrorApi(null);
    const desdeMin = desde ? horaAMinutos(desde) : null;
    const hastaMin = hastaMinDeFormulario(hasta, hastaFinDelDia);
    const parsed = CrearFrecuenciaReglaSchema.safeParse({
      alcance,
      grupoId: alcance === 'grupo' ? grupoId || null : null,
      vehiculoId: alcance === 'vehiculo' ? vehiculoId || null : null,
      minutos: minutos.trim() === '' ? undefined : Number(minutos),
      desdeMin,
      hastaMin,
    });
    if (!parsed.success) {
      const msgs = mensajesReglaPorCampo(
        parsed.error.issues,
        { alcance, desdeMin, hastaMin },
        { min: FRECUENCIA_MIN_MINUTOS, max: FRECUENCIA_MAX_MINUTOS },
      );
      if (hastaFinDelDia && msgs.hastaMin) msgs.hastaMin = 'Indicá desde qué hora, o desmarcá "Hasta el final del día".';
      setErrores(msgs);
      // Foco al primer campo inválido, en el orden visual del formulario.
      const orden: [string, string][] = [
        ['alcance', 'regla-alcance'],
        ['grupoId', 'regla-grupo'],
        ['vehiculoId', 'regla-vehiculo'],
        ['minutos', 'regla-minutos'],
        ['desdeMin', 'regla-desde'],
        ['hastaMin', hastaFinDelDia ? 'regla-desde' : 'regla-hasta'],
      ];
      const primero = orden.find(([k]) => msgs[k]);
      if (primero) formRef.current?.querySelector<HTMLElement>(`#${primero[1]}`)?.focus();
      return;
    }
    setErrores({});
    try {
      await onCrear(parsed.data);
      setMinutos('');
      setDesde('');
      setHasta('');
      setHastaFinDelDia(false);
    } catch (err) {
      setErrorApi(mensajeError(err));
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => void crear(e)}
      noValidate
      aria-label="Nueva regla de frecuencia"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--qv-border-subtle)', paddingTop: '1rem' }}
    >
      <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Nueva regla para hoy</h3>
      {errorApi && <Alert variant="danger" title="No se pudo crear la regla">{errorApi}</Alert>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem', alignItems: 'start' }}>
        <FormField label="Aplica a" htmlFor="regla-alcance" error={errores.alcance}>
          <Select id="regla-alcance" options={alcances} value={alcance} onChange={(e) => setAlcance(e.target.value as AlcanceFrecuencia)} fullWidth />
        </FormField>
        {alcance === 'grupo' && (
          <FormField label="Grupo" htmlFor="regla-grupo" required error={errores.grupoId}>
            <Select
              id="regla-grupo"
              placeholder="Elegí un grupo…"
              options={(grupos ?? []).filter((g) => g.estado === 'activo').map((g) => ({ label: g.nombre, value: g.id }))}
              value={grupoId}
              aria-invalid={Boolean(errores.grupoId)}
              onChange={(e) => setGrupoId(e.target.value)}
              fullWidth
            />
          </FormField>
        )}
        {alcance === 'vehiculo' && (
          <FormField label="Trufi" htmlFor="regla-vehiculo" required error={errores.vehiculoId}>
            <Select
              id="regla-vehiculo"
              placeholder="Elegí un trufi…"
              options={vehiculos.map((v) => ({ label: v.numeroInterno ? `${v.placa} · int. ${v.numeroInterno}` : v.placa, value: v.id }))}
              value={vehiculoId}
              aria-invalid={Boolean(errores.vehiculoId)}
              onChange={(e) => setVehiculoId(e.target.value)}
              fullWidth
            />
          </FormField>
        )}
        <FormField label="Cada (minutos)" htmlFor="regla-minutos" required error={errores.minutos}>
          <Input id="regla-minutos" type="number" inputMode="numeric" autoComplete="off" min={FRECUENCIA_MIN_MINUTOS} max={FRECUENCIA_MAX_MINUTOS} value={minutos} onChange={(e) => setMinutos(e.target.value)} aria-invalid={Boolean(errores.minutos)} fullWidth />
        </FormField>
        <FormField label="Desde (opcional)" htmlFor="regla-desde" error={errores.desdeMin}>
          <Input id="regla-desde" type="time" value={desde} onChange={(e) => setDesde(e.target.value)} aria-invalid={Boolean(errores.desdeMin)} fullWidth />
        </FormField>
        <FormField label="Hasta (opcional)" htmlFor="regla-hasta" error={errores.hastaMin} helperText="Sin franja rige todo el día.">
          <Input id="regla-hasta" type="time" value={hastaFinDelDia ? '' : hasta} disabled={hastaFinDelDia} onChange={(e) => setHasta(e.target.value)} aria-invalid={Boolean(errores.hastaMin)} fullWidth />
          <Checkbox label="Hasta el final del día" checked={hastaFinDelDia} onChange={(e) => setHastaFinDelDia(e.target.checked)} />
        </FormField>
      </div>
      <div>
        <Button type="submit" disabled={guardando}>
          <Plus size={16} aria-hidden /> {guardando ? 'Creando…' : 'Crear regla'}
        </Button>
      </div>
    </form>
  );
}
