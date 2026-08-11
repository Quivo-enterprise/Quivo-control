'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DatePicker,
  Input,
  Loader,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Tabs,
  TextArea,
  type StatusBadgeStatus,
} from '@quivo/design-system';
import type { Conductor, EstadoSancion, Regla, Sancion, Socio, SujetoTipo, Vehiculo } from '@quivo/shared';
import { ModuleTablePage, type EntityFieldConfig, type ModuleDataSource } from '../../../src/components/module-table-page';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { ApiError } from '../../../src/lib/api/client';
import { reglasApi } from '../../../src/lib/api/reglas';
import { sancionesApi } from '../../../src/lib/api/sanciones';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { sociosApi } from '../../../src/lib/api/socios';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

const GRAVEDAD_BADGE: Record<Regla['gravedad'], StatusBadgeStatus> = {
  leve: 'idle',
  grave: 'warning',
  gravisima: 'canceled',
};

const ESTADO_REGLA_BADGE: Record<Regla['estado'], StatusBadgeStatus> = {
  activo: 'active',
  inactivo: 'inactive',
};

const ESTADO_SANCION_BADGE: Record<EstadoSancion, StatusBadgeStatus> = {
  pendiente: 'pending',
  aplicada: 'warning',
  apelada: 'idle',
  pagada: 'active',
  anulada: 'canceled',
};

const SUJETO_TIPOS: { label: string; value: SujetoTipo }[] = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
  { label: 'Socio', value: 'socio' },
];

// Mismo límite fijo que sanciones.service.ts.
const TAMANO_PAGINA = 200;

type Transicion = 'aplicar' | 'anular' | 'apelar' | 'pagar';

const TRANSICIONES_POR_ESTADO: Record<EstadoSancion, Transicion[]> = {
  pendiente: ['aplicar', 'anular'],
  aplicada: ['apelar', 'pagar', 'anular'],
  apelada: ['aplicar', 'anular'],
  pagada: [],
  anulada: [],
};

const LABEL_TRANSICION: Record<Transicion, string> = {
  aplicar: 'Aplicar',
  anular: 'Anular',
  apelar: 'Apelar',
  pagar: 'Marcar pagada',
};

/** RF-40..50 (QUI-245) — reemplaza el modo demo. Dos pestañas: reglas (CRUD simple vía
 * ModuleTablePage, igual que vehículos/líneas) y sanciones (flujo de transiciones propio,
 * igual patrón que rotaciones QUI-233). */
export default function ReglasPage() {
  const [tab, setTab] = useState('reglas');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader title="Reglas y sanciones" subtitle="RF-40..50 (QUI-244/245)." />
      <Tabs
        items={[
          { value: 'reglas', label: 'Reglas' },
          { value: 'sanciones', label: 'Sanciones' },
        ]}
        value={tab}
        onValueChange={setTab}
      />
      {tab === 'reglas' ? <ReglasTab /> : <SancionesTab />}
    </div>
  );
}

function ReglasTab() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions, nombrePorId } = useSindicatoOptions();

  // Sin catálogo fijo de tipos de regla (decisión explícita — ver QUI-245): sugerimos los
  // valores ya usados vía <datalist> para evitar variantes del mismo texto ("puntualidad" vs
  // "Puntualidad") sin bloquear tipos nuevos que un sindicato quiera dar de alta.
  const [tiposExistentes, setTiposExistentes] = useState<string[]>([]);
  useEffect(() => {
    if (!token) return;
    reglasApi
      .listar(token)
      .then((reglas) => setTiposExistentes(Array.from(new Set(reglas.map((r) => r.tipo))).sort()))
      .catch(() => {});
  }, [token]);

  const fields = useMemo<EntityFieldConfig[]>(() => {
    const base: EntityFieldConfig[] = [
      { key: 'nombre', label: 'Nombre', kind: 'text', required: true },
      { key: 'tipo', label: 'Tipo', kind: 'text', required: true, suggestions: tiposExistentes },
      {
        key: 'gravedad',
        label: 'Gravedad',
        kind: 'select',
        options: [
          { label: 'Leve', value: 'leve' },
          { label: 'Grave', value: 'grave' },
          { label: 'Gravísima', value: 'gravisima' },
        ],
        required: true,
      },
      {
        key: 'aplicaA',
        label: 'Aplica a',
        kind: 'select',
        options: SUJETO_TIPOS,
        required: true,
      },
      { key: 'descripcion', label: 'Descripción', kind: 'text' },
    ];
    if (user?.rol === 'admin_quivo') {
      base.push({ key: 'sindicatoId', label: 'Sindicato', kind: 'select', options: sindicatoOptions, required: true });
    }
    base.push({
      key: 'estado',
      label: 'Estado',
      kind: 'select',
      options: [
        { label: 'Activo', value: 'activo' },
        { label: 'Inactivo', value: 'inactivo' },
      ],
    });
    return base;
  }, [user?.rol, sindicatoOptions, tiposExistentes]);

  const dataSource = useMemo<ModuleDataSource<Regla>>(
    () => ({
      list: () => reglasApi.listar(token ?? ''),
      create: (values) => reglasApi.crear(token ?? '', values as never),
      update: (id, values) => reglasApi.actualizar(token ?? '', id, values as never),
    }),
    [token],
  );

  return (
    <ModuleTablePage<Regla>
      title="Reglas"
      subtitle="Estatutos por sindicato."
      entityLabel="regla"
      searchPlaceholder="Buscar por nombre o tipo..."
      searchKeys={['nombre', 'tipo']}
      fields={fields}
      createDefaults={{ gravedad: 'leve', aplicaA: 'conductor', estado: 'activo', sindicatoId: user?.sindicatoId ?? '' }}
      dataSource={dataSource}
      columns={[
        { key: 'nombre', header: 'Nombre' },
        { key: 'tipo', header: 'Tipo' },
        {
          key: 'sindicatoId',
          header: 'Sindicato',
          render: (row) => nombrePorId[row.sindicatoId] ?? row.sindicatoId,
        },
        {
          key: 'gravedad',
          header: 'Gravedad',
          render: (row) => <StatusBadge status={GRAVEDAD_BADGE[row.gravedad]} label={row.gravedad} />,
        },
        { key: 'aplicaA', header: 'Aplica a' },
        {
          key: 'estado',
          header: 'Estado',
          render: (row) => <StatusBadge status={ESTADO_REGLA_BADGE[row.estado]} />,
        },
      ]}
    />
  );
}

function SancionesTab() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [sindicatoSeleccionado, setSindicatoSeleccionado] = useState('');
  const sindicatoId = user?.rol === 'admin_quivo' ? sindicatoSeleccionado : (user?.sindicatoId ?? '');

  const [reglas, setReglas] = useState<Regla[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [sanciones, setSanciones] = useState<Sancion[]>([]);

  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalNueva, setModalNueva] = useState(false);
  const [confirmacion, setConfirmacion] = useState<{ sancion: Sancion; transicion: Transicion } | null>(null);
  const [procesando, setProcesando] = useState(false);

  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroReglaId, setFiltroReglaId] = useState('');

  // Reglas/vehículos/conductores/socios: catálogos chicos, se recargan solo al cambiar de
  // sindicato (los usa el modal de nueva sanción para poblar selects).
  useEffect(() => {
    if (!token || !sindicatoId) return;
    setError(null);
    Promise.all([
      reglasApi.listar(token),
      vehiculosApi.listar(token),
      conductoresApi.listar(token),
      sociosApi.listar(token),
    ])
      .then(([r, v, c, s]) => {
        setReglas(r.filter((x) => x.sindicatoId === sindicatoId));
        setVehiculos(v.filter((x) => x.sindicatoId === sindicatoId));
        setConductores(c.filter((x) => x.sindicatoId === sindicatoId));
        setSocios(s.filter((x) => x.sindicatoId === sindicatoId));
      })
      .catch((err: unknown) => setError(mensajeError(err)));
  }, [token, sindicatoId]);

  // Sanciones: filtradas y paginadas server-side (puede crecer sin límite con el tiempo, a
  // diferencia de los catálogos de arriba) — se recarga también al cambiar de filtro.
  useEffect(() => {
    if (!token || !sindicatoId) return;
    setLoading(true);
    setError(null);
    sancionesApi
      .listar(token, {
        sindicatoId,
        estado: (filtroEstado || undefined) as EstadoSancion | undefined,
        reglaId: filtroReglaId || undefined,
      })
      .then((rows) => {
        setSanciones(rows);
        setHasMore(rows.length === TAMANO_PAGINA);
      })
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, sindicatoId, filtroEstado, filtroReglaId]);

  const reglaPorId = useMemo(() => new Map(reglas.map((r) => [r.id, r])), [reglas]);
  const sujetoLabel = useMemo(() => {
    const vehiculoPorId = new Map(vehiculos.map((v) => [v.id, v.placa]));
    const conductorPorId = new Map(conductores.map((c) => [c.id, c.nombre]));
    const socioPorId = new Map(socios.map((s) => [s.id, s.nombre]));
    return (sujetoTipo: SujetoTipo, sujetoId: string): string => {
      if (sujetoTipo === 'vehiculo') return vehiculoPorId.get(sujetoId) ?? sujetoId;
      if (sujetoTipo === 'conductor') return conductorPorId.get(sujetoId) ?? sujetoId;
      return socioPorId.get(sujetoId) ?? sujetoId;
    };
  }, [vehiculos, conductores, socios]);

  async function cargarMasSanciones() {
    if (!token || !sindicatoId) return;
    setCargandoMas(true);
    setError(null);
    try {
      const rows = await sancionesApi.listar(token, {
        sindicatoId,
        estado: (filtroEstado || undefined) as EstadoSancion | undefined,
        reglaId: filtroReglaId || undefined,
        skip: sanciones.length,
      });
      setSanciones((actual) => [...actual, ...rows]);
      setHasMore(rows.length === TAMANO_PAGINA);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setCargandoMas(false);
    }
  }

  async function refrescar() {
    if (!token || !sindicatoId) return;
    const lista = await sancionesApi.listar(token, {
      sindicatoId,
      estado: (filtroEstado || undefined) as EstadoSancion | undefined,
      reglaId: filtroReglaId || undefined,
    });
    setSanciones(lista);
    setHasMore(lista.length === TAMANO_PAGINA);
  }

  async function confirmarTransicion() {
    if (!token || !confirmacion) return;
    setProcesando(true);
    setError(null);
    try {
      await sancionesApi[confirmacion.transicion](token, confirmacion.sancion.id);
      await refrescar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setProcesando(false);
      setConfirmacion(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <Alert variant="danger" title="Error">{error}</Alert>}

      {user?.rol === 'admin_quivo' && (
        <Card header="Sindicato">
          <Select
            options={[{ label: 'Seleccionar...', value: '' }, ...sindicatoOptions]}
            value={sindicatoSeleccionado}
            onChange={(e) => setSindicatoSeleccionado(e.target.value)}
          />
        </Card>
      )}

      {sindicatoId && (
        <>
          <Card header="Filtros">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', alignItems: 'end' }}>
              <Select
                label="Estado"
                options={[
                  { label: 'Todos', value: '' },
                  { label: 'Pendiente', value: 'pendiente' },
                  { label: 'Aplicada', value: 'aplicada' },
                  { label: 'Apelada', value: 'apelada' },
                  { label: 'Pagada', value: 'pagada' },
                  { label: 'Anulada', value: 'anulada' },
                ]}
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
              />
              <Select
                label="Regla"
                options={[{ label: 'Todas', value: '' }, ...reglas.map((r) => ({ label: r.nombre, value: r.id }))]}
                value={filtroReglaId}
                onChange={(e) => setFiltroReglaId(e.target.value)}
              />
              <Button onClick={() => setModalNueva(true)}>+ Nueva sanción</Button>
            </div>
          </Card>

          {loading ? (
            <Loader label="Cargando sanciones..." />
          ) : sanciones.length === 0 ? (
            <Card header="Sanciones">
              <span>Sin sanciones para estos filtros.</span>
            </Card>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={celdaEncabezado}>Fecha del hecho</th>
                    <th style={celdaEncabezado}>Regla</th>
                    <th style={celdaEncabezado}>Sujeto</th>
                    <th style={celdaEncabezado}>Motivo</th>
                    <th style={celdaEncabezado}>Estado</th>
                    <th style={celdaEncabezado}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sanciones.map((s) => (
                    <tr key={s.id}>
                      <td style={celdaCuerpo}>{formatearFecha(s.fechaHecho)}</td>
                      <td style={celdaCuerpo}>{reglaPorId.get(s.reglaId)?.nombre ?? s.reglaId}</td>
                      <td style={celdaCuerpo}>
                        {sujetoLabel(s.sujetoTipo, s.sujetoId)} ({s.sujetoTipo})
                      </td>
                      <td style={celdaCuerpo}>{s.motivo}</td>
                      <td style={celdaCuerpo}>
                        <StatusBadge status={ESTADO_SANCION_BADGE[s.estado]} label={s.estado} />
                      </td>
                      <td style={celdaCuerpo}>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {TRANSICIONES_POR_ESTADO[s.estado].map((t) => (
                            <Button
                              key={t}
                              size="sm"
                              variant={t === 'anular' ? 'danger' : 'ghost'}
                              onClick={() => setConfirmacion({ sancion: s, transicion: t })}
                            >
                              {LABEL_TRANSICION[t]}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button variant="secondary" onClick={cargarMasSanciones} disabled={cargandoMas}>
                {cargandoMas ? 'Cargando...' : 'Cargar más'}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmacion !== null}
        title={confirmacion ? `${LABEL_TRANSICION[confirmacion.transicion]} sanción` : ''}
        message={
          confirmacion?.transicion === 'anular'
            ? 'La sanción queda anulada y no puede volver a modificarse.'
            : confirmacion?.transicion === 'pagar'
              ? 'La sanción queda marcada como pagada (estado terminal).'
              : undefined
        }
        variant={confirmacion?.transicion === 'anular' ? 'danger' : 'primary'}
        confirmLabel={procesando ? 'Procesando...' : 'Confirmar'}
        onConfirm={confirmarTransicion}
        onCancel={() => setConfirmacion(null)}
      />

      {sindicatoId && modalNueva && (
        <NuevaSancionModal
          token={token}
          sindicatoId={sindicatoId}
          reglas={reglas}
          vehiculos={vehiculos}
          conductores={conductores}
          socios={socios}
          onClose={() => setModalNueva(false)}
          onCreada={() => {
            setModalNueva(false);
            void refrescar();
          }}
        />
      )}
    </div>
  );
}

function NuevaSancionModal(props: {
  token: string | null;
  sindicatoId: string;
  reglas: Regla[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  socios: Socio[];
  onClose: () => void;
  onCreada: () => void;
}) {
  const { token, sindicatoId, reglas, vehiculos, conductores, socios, onClose, onCreada } = props;
  const [reglaId, setReglaId] = useState(reglas[0]?.id ?? '');
  const [sujetoTipo, setSujetoTipo] = useState<SujetoTipo>('vehiculo');
  const [sujetoId, setSujetoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fechaHecho, setFechaHecho] = useState('');
  const [evidenciaRef, setEvidenciaRef] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opcionesSujeto =
    sujetoTipo === 'vehiculo'
      ? vehiculos.map((v) => ({ label: v.placa, value: v.id }))
      : sujetoTipo === 'conductor'
        ? conductores.map((c) => ({ label: c.nombre, value: c.id }))
        : socios.map((s) => ({ label: s.nombre, value: s.id }));

  async function guardar() {
    if (!token || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho) return;
    setGuardando(true);
    setError(null);
    try {
      await sancionesApi.crear(token, {
        sindicatoId,
        reglaId,
        sujetoTipo,
        sujetoId,
        motivo: motivo.trim(),
        fechaHecho: new Date(fechaHecho),
        evidenciaRef: evidenciaRef.trim() || undefined,
      });
      onCreada();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Nueva sanción"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {error && <Alert variant="danger" title="No se pudo guardar">{error}</Alert>}
        <Select
          label="Regla"
          options={reglas.map((r) => ({ label: `${r.nombre} (${r.gravedad})`, value: r.id }))}
          value={reglaId}
          onChange={(e) => setReglaId(e.target.value)}
        />
        <Select
          label="Tipo de sujeto"
          options={SUJETO_TIPOS}
          value={sujetoTipo}
          onChange={(e) => {
            setSujetoTipo(e.target.value as SujetoTipo);
            setSujetoId('');
          }}
        />
        <Select
          label="Sujeto"
          options={opcionesSujeto}
          value={sujetoId}
          onChange={(e) => setSujetoId(e.target.value)}
        />
        <TextArea label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <DatePicker label="Fecha del hecho" value={fechaHecho} onChange={(e) => setFechaHecho(e.target.value)} />
        <Input
          label="Referencia de evidencia (opcional)"
          value={evidenciaRef}
          onChange={(e) => setEvidenciaRef(e.target.value)}
          helperText="Vinculación automática a datos de recorrido llega con M3 — por ahora es texto libre."
        />
      </div>
    </Modal>
  );
}

const celdaEncabezado = {
  textAlign: 'left' as const,
  padding: '0.5rem',
  borderBottom: '2px solid var(--qv-color-border, #ddd)',
};

const celdaCuerpo = {
  padding: '0.5rem',
  borderBottom: '1px solid var(--qv-color-border, #eee)',
};

// `fechaHecho` es una fecha "pura" (medianoche UTC), no un instante — formatearla con
// `toLocaleDateString` sin fijar `timeZone: 'UTC'` la corre un día para atrás en cualquier
// browser al oeste de UTC (bug real encontrado probando esto en vivo).
function formatearFecha(fecha: Date): string {
  return new Date(fecha).toLocaleDateString('es-BO', { timeZone: 'UTC' });
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
