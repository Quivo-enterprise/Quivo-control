'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DatePicker,
  Input,
  Loader,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
} from '@quivo/design-system';
import type {
  Asignacion,
  Conductor,
  EstadoRotacion,
  Linea,
  Ruta,
  Turno,
  Vehiculo,
} from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { ApiError } from '../../../src/lib/api/client';
import { lineasApi } from '../../../src/lib/api/lineas';
import { rutasApi } from '../../../src/lib/api/rutas';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';
import { conductoresApi } from '../../../src/lib/api/conductores';
import { rotacionesApi, type RotacionConAsignaciones } from '../../../src/lib/api/rotaciones';
import { useSindicatoOptions } from '../../../src/lib/api/use-sindicato-options';

const HORARIOS: { label: string; value: Turno }[] = [
  { label: 'Mañana', value: 'manana' },
  { label: 'Tarde', value: 'tarde' },
  { label: 'Noche', value: 'noche' },
];

interface RutaConLinea extends Ruta {
  linea: Linea;
}

interface EdicionAsignacion {
  asignacion: Asignacion;
}

interface FiltrosRotaciones {
  periodo: string;
  estado: EstadoRotacion | '';
}

const FILTROS_ROTACIONES_VACIOS: FiltrosRotaciones = { periodo: '', estado: '' };

/** RF-51..57 (QUI-233) — vista de rotación por periodo: grilla vehículo × fecha/horario
 * contra el API real de QUI-232. `admin_quivo` no tiene sindicato propio, así que necesita
 * elegir uno antes de poder generar o ver rutas/vehículos (mismo patrón que socios/vehículos,
 * QUI-228); `admin_sindicato` queda forzado al suyo. */
export default function RotacionesPage() {
  const { token, user } = useAuth();
  const { options: sindicatoOptions } = useSindicatoOptions();

  const [sindicatoSeleccionado, setSindicatoSeleccionado] = useState('');
  const sindicatoId =
    user?.rol === 'admin_quivo' ? sindicatoSeleccionado : (user?.sindicatoId ?? '');

  const [rutas, setRutas] = useState<RutaConLinea[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [rotaciones, setRotaciones] = useState<RotacionConAsignaciones[]>([]);
  const [rotacionActual, setRotacionActual] = useState<RotacionConAsignaciones | null>(null);

  const [loadingCatalogo, setLoadingCatalogo] = useState(false);
  const [loadingRotaciones, setLoadingRotaciones] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoGeneracion, setAvisoGeneracion] = useState<string | null>(null);

  const [periodo, setPeriodo] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [horariosSeleccionados, setHorariosSeleccionados] = useState<Turno[]>(['manana']);
  const [rutasSeleccionadas, setRutasSeleccionadas] = useState<string[]>([]);

  const [filtrosRotaciones, setFiltrosRotaciones] =
    useState<FiltrosRotaciones>(FILTROS_ROTACIONES_VACIOS);
  const [filtrosRotacionesAplicados, setFiltrosRotacionesAplicados] =
    useState<FiltrosRotaciones>(FILTROS_ROTACIONES_VACIOS);

  const [confirmacion, setConfirmacion] = useState<'publicar' | 'anular' | null>(null);
  const [modalAsignacion, setModalAsignacion] = useState<EdicionAsignacion | null>(null);
  const [modalNuevaAsignacion, setModalNuevaAsignacion] = useState(false);

  // Catálogo del sindicato (líneas/rutas/vehículos/conductores) — todos filtrados en el
  // cliente por `sindicatoId`, porque para `admin_quivo` esos endpoints devuelven todos los
  // tenants mezclados (no tienen un query param de filtro, ver QUI-220..224).
  useEffect(() => {
    if (!token || !sindicatoId) {
      setRutas([]);
      setVehiculos([]);
      setConductores([]);
      setLoadingCatalogo(false);
      return;
    }
    let cancelado = false;
    setLoadingCatalogo(true);
    setError(null);
    Promise.all([lineasApi.listar(token), vehiculosApi.listar(token), conductoresApi.listar(token)])
      .then(async ([todasLineas, todosVehiculos, todosConductores]) => {
        const lineasDelSindicato = todasLineas.filter((l) => l.sindicatoId === sindicatoId);

        const rutasPorLinea = await Promise.all(
          lineasDelSindicato.map((linea) =>
            rutasApi.listarPorLinea(token, linea.id).then((rs) => rs.map((r) => ({ ...r, linea }))),
          ),
        );
        if (cancelado) return;
        setVehiculos(todosVehiculos.filter((v) => v.sindicatoId === sindicatoId));
        setConductores(todosConductores.filter((c) => c.sindicatoId === sindicatoId));
        setRutas(rutasPorLinea.flat());
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingCatalogo(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId]);

  useEffect(() => {
    if (!token || !sindicatoId) {
      setRotaciones([]);
      setRotacionActual(null);
      setLoadingRotaciones(false);
      return;
    }
    let cancelado = false;
    setLoadingRotaciones(true);
    rotacionesApi
      .listar(token)
      .then(async (lista) => {
        const propias = lista.filter((r) => r.sindicatoId === sindicatoId);
        const conDetalle = await Promise.all(
          propias.map((r) => rotacionesApi.obtener(token, r.id)),
        );
        if (cancelado) return;
        setRotaciones(conDetalle);
        setRotacionActual((actual) =>
          actual ? (conDetalle.find((rotacion) => rotacion.id === actual.id) ?? null) : null,
        );
      })
      .catch((err: unknown) => {
        if (!cancelado) setError(mensajeError(err));
      })
      .finally(() => {
        if (!cancelado) setLoadingRotaciones(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token, sindicatoId]);

  const vehiculoPorId = useMemo(() => new Map(vehiculos.map((v) => [v.id, v])), [vehiculos]);
  const rutaPorId = useMemo(() => new Map(rutas.map((r) => [r.id, r])), [rutas]);
  const conductorPorId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const rotacionesFiltradas = useMemo(() => {
    const periodoBuscado = filtrosRotacionesAplicados.periodo.trim().toLocaleLowerCase();
    return rotaciones.filter(
      (rotacion) =>
        (!periodoBuscado || rotacion.periodo.toLocaleLowerCase().includes(periodoBuscado)) &&
        (!filtrosRotacionesAplicados.estado ||
          rotacion.estado === filtrosRotacionesAplicados.estado),
    );
  }, [filtrosRotacionesAplicados, rotaciones]);
  const rangoFechasInvalido = Boolean(fechaInicio && fechaFin && fechaFin < fechaInicio);

  function seleccionarSindicato(siguienteSindicatoId: string) {
    setSindicatoSeleccionado(siguienteSindicatoId);
    setRutas([]);
    setVehiculos([]);
    setConductores([]);
    setRotaciones([]);
    setRotacionActual(null);
    setConfirmacion(null);
    setModalAsignacion(null);
    setModalNuevaAsignacion(false);
    setAvisoGeneracion(null);
    setError(null);
    setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
    setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
  }

  function aplicarFiltrosRotaciones() {
    setFiltrosRotacionesAplicados({ ...filtrosRotaciones });
  }

  function limpiarFiltrosRotaciones() {
    setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
    setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
  }

  function toggleHorario(horario: Turno) {
    setHorariosSeleccionados((prev) =>
      prev.includes(horario) ? prev.filter((h) => h !== horario) : [...prev, horario],
    );
  }

  function toggleRuta(rutaId: string) {
    setRutasSeleccionadas((prev) =>
      prev.includes(rutaId) ? prev.filter((r) => r !== rutaId) : [...prev, rutaId],
    );
  }

  async function refrescarRotacion(id: string) {
    if (!token) return;
    const actualizada = await rotacionesApi.obtener(token, id);
    setRotaciones((prev) => prev.map((r) => (r.id === id ? actualizada : r)));
    setRotacionActual((prev) => (prev?.id === id ? actualizada : prev));
  }

  async function generarRotacion() {
    if (
      !token ||
      !sindicatoId ||
      !periodo.trim() ||
      !fechaInicio ||
      !fechaFin ||
      rangoFechasInvalido ||
      rutasSeleccionadas.length === 0 ||
      horariosSeleccionados.length === 0
    ) {
      return;
    }
    setGenerando(true);
    setError(null);
    setAvisoGeneracion(null);
    try {
      const fechas = rangoDeFechas(fechaInicio, fechaFin);
      const nueva = await rotacionesApi.generar(token, {
        sindicatoId: user?.rol === 'admin_quivo' ? sindicatoId : undefined,
        periodo: periodo.trim(),
        rutaIds: rutasSeleccionadas,
        fechas,
        horarios: horariosSeleccionados,
      });
      setRotaciones((prev) => [nueva, ...prev]);
      setRotacionActual(nueva);
      setFiltrosRotaciones(FILTROS_ROTACIONES_VACIOS);
      setFiltrosRotacionesAplicados(FILTROS_ROTACIONES_VACIOS);
      const avisos: string[] = [];
      const totalPedido = fechas.length * horariosSeleccionados.length * rutasSeleccionadas.length;
      if (nueva.asignaciones.length < totalPedido) {
        avisos.push(
          `Se generaron ${nueva.asignaciones.length} de ${totalPedido} asignaciones — el resto quedó sin vehículo disponible en esa fecha y horario.`,
        );
      }
      if (nueva.sinCobertura.length > 0) {
        const detalle = nueva.sinCobertura
          .map(({ vehiculoId, rutaId }) => {
            const placa = vehiculoPorId.get(vehiculoId)?.placa ?? vehiculoId;
            const ruta = rutas.find((r) => r.id === rutaId);
            const etiquetaRuta = ruta ? `${ruta.linea.nombre} (${ruta.sentido})` : rutaId;
            return `${placa} → ${etiquetaRuta}`;
          })
          .join(', ');
        avisos.push(
          `${nueva.sinCobertura.length} vehículo(s) no llegaron a cubrir alguna ruta pedida en este período (agenda sin slots libres): ${detalle}.`,
        );
      }
      if (avisos.length > 0) setAvisoGeneracion(avisos.join(' '));
      setPeriodo('');
      setFechaInicio('');
      setFechaFin('');
      setRutasSeleccionadas([]);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGenerando(false);
    }
  }

  async function confirmarPublicarOAnular() {
    if (!token || !rotacionActual || !confirmacion) return;
    setProcesando(true);
    setError(null);
    try {
      if (confirmacion === 'publicar') {
        await rotacionesApi.publicar(token, rotacionActual.id);
      } else {
        await rotacionesApi.anular(token, rotacionActual.id);
      }
      await refrescarRotacion(rotacionActual.id);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setProcesando(false);
      setConfirmacion(null);
    }
  }

  const columnasGrilla = useMemo(() => {
    if (!rotacionActual) return [];
    const claves = new Map<string, { fecha: string; horario: Turno }>();
    for (const asignacion of rotacionActual.asignaciones) {
      const fecha = new Date(asignacion.fecha).toISOString().slice(0, 10);
      claves.set(`${fecha}|${asignacion.horario}`, { fecha, horario: asignacion.horario });
    }
    return [...claves.values()].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || a.horario.localeCompare(b.horario),
    );
  }, [rotacionActual]);

  const filasGrilla = useMemo(() => {
    if (!rotacionActual) return [];
    const vehiculoIds = [...new Set(rotacionActual.asignaciones.map((a) => a.vehiculoId))];
    return vehiculoIds.sort((a, b) =>
      (vehiculoPorId.get(a)?.placa ?? '').localeCompare(vehiculoPorId.get(b)?.placa ?? ''),
    );
  }, [rotacionActual, vehiculoPorId]);

  function celda(vehiculoId: string, fecha: string, horario: Turno): Asignacion | undefined {
    return rotacionActual?.asignaciones.find(
      (a) =>
        a.vehiculoId === vehiculoId &&
        new Date(a.fecha).toISOString().slice(0, 10) === fecha &&
        a.horario === horario,
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Rotaciones"
        subtitle="RF-51..57 — generar, editar y publicar rotaciones (QUI-233)."
      />
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}
      {avisoGeneracion && (
        <Alert variant="warning" title="Reparto parcial">
          {avisoGeneracion}
        </Alert>
      )}

      {user?.rol === 'admin_quivo' && (
        <Card header="Sindicato">
          <Select
            id="sindicato"
            name="sindicato"
            options={[{ label: 'Seleccionar...', value: '' }, ...sindicatoOptions]}
            value={sindicatoSeleccionado}
            onChange={(event) => seleccionarSindicato(event.target.value)}
          />
        </Card>
      )}

      {user?.rol === 'admin_quivo' && !sindicatoId && (
        <Alert variant="info" title="Seleccioná un sindicato">
          Elegí un sindicato para consultar o gestionar sus rotaciones.
        </Alert>
      )}

      {sindicatoId && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '340px 1fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Card header="Generar rotación">
              {loadingCatalogo ? (
                <Loader label="Cargando catálogo..." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <Input
                    label="Periodo"
                    placeholder="2026-09"
                    value={periodo}
                    onChange={(e) => setPeriodo(e.target.value)}
                  />
                  <DatePicker
                    label="Desde"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                  />
                  <DatePicker
                    label="Hasta"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                  />
                  {rangoFechasInvalido && (
                    <Alert variant="warning" title="Rango de fechas inválido">
                      La fecha final debe ser igual o posterior a la fecha inicial.
                    </Alert>
                  )}
                  <div>
                    <span className="qv-field__label">Horarios</span>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                      {HORARIOS.map((h) => (
                        <Checkbox
                          key={h.value}
                          label={h.label}
                          checked={horariosSeleccionados.includes(h.value)}
                          onChange={() => toggleHorario(h.value)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="qv-field__label">Rutas</span>
                    {rutas.length === 0 ? (
                      <p>Sin rutas en este sindicato todavía.</p>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          marginTop: '0.25rem',
                        }}
                      >
                        {rutas.map((r) => (
                          <Checkbox
                            key={r.id}
                            label={`${r.linea.codigo} — ${r.sentido}`}
                            checked={rutasSeleccionadas.includes(r.id)}
                            onChange={() => toggleRuta(r.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={generarRotacion}
                    disabled={
                      generando ||
                      !periodo ||
                      !fechaInicio ||
                      !fechaFin ||
                      rangoFechasInvalido ||
                      rutasSeleccionadas.length === 0 ||
                      horariosSeleccionados.length === 0
                    }
                  >
                    {generando ? 'Generando...' : 'Generar borrador'}
                  </Button>
                </div>
              )}
            </Card>

            <Card header="Rotaciones">
              {loadingRotaciones ? (
                <Loader label="Cargando..." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <Input
                    label="Buscar por período"
                    placeholder="Ej. 2026-08"
                    value={filtrosRotaciones.periodo}
                    onChange={(event) =>
                      setFiltrosRotaciones((actual) => ({ ...actual, periodo: event.target.value }))
                    }
                  />
                  <Select
                    label="Estado"
                    options={[
                      { label: 'Todos', value: '' },
                      { label: 'Borrador', value: 'borrador' },
                      { label: 'Publicada', value: 'publicada' },
                    ]}
                    value={filtrosRotaciones.estado}
                    onChange={(event) =>
                      setFiltrosRotaciones((actual) => ({
                        ...actual,
                        estado: event.target.value as EstadoRotacion | '',
                      }))
                    }
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button size="sm" onClick={aplicarFiltrosRotaciones}>
                      Aplicar filtros
                    </Button>
                    <Button size="sm" variant="ghost" onClick={limpiarFiltrosRotaciones}>
                      Limpiar filtros
                    </Button>
                  </div>
                  {rotacionesFiltradas.length === 0 ? (
                    <span>
                      {rotaciones.length === 0
                        ? 'Sin rotaciones todavía.'
                        : 'No hay rotaciones que coincidan con los filtros aplicados.'}
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {rotacionesFiltradas.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRotacionActual(r)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            textAlign: 'left',
                            padding: '0.5rem',
                            borderRadius: '0.5rem',
                            border: 'none',
                            cursor: 'pointer',
                            background:
                              r.id === rotacionActual?.id
                                ? 'var(--qv-color-primary)'
                                : 'transparent',
                            color: r.id === rotacionActual?.id ? '#fff' : 'inherit',
                          }}
                        >
                          <span>{r.periodo}</span>
                          <StatusBadge
                            status={r.estado === 'publicada' ? 'active' : 'pending'}
                            label={r.estado}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          <Card
            header={rotacionActual ? `Rotación ${rotacionActual.periodo}` : 'Rotación'}
            footer={
              rotacionActual ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {rotacionActual.estado === 'borrador' && (
                    <>
                      <Button size="sm" onClick={() => setModalNuevaAsignacion(true)}>
                        + Agregar asignación
                      </Button>
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => setConfirmacion('publicar')}
                      >
                        Publicar
                      </Button>
                    </>
                  )}
                  {rotacionActual.estado === 'publicada' && (
                    <Button size="sm" variant="danger" onClick={() => setConfirmacion('anular')}>
                      Anular
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          >
            {!rotacionActual ? (
              <span>Elegí una rotación de la lista o generá una nueva.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <StatusBadge
                  status={rotacionActual.estado === 'publicada' ? 'active' : 'pending'}
                  label={rotacionActual.estado}
                />
                {filasGrilla.length === 0 ? (
                  <span>Esta rotación no tiene asignaciones.</span>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={celdaEncabezado}>Vehículo</th>
                          {columnasGrilla.map((col) => (
                            <th key={`${col.fecha}|${col.horario}`} style={celdaEncabezado}>
                              {col.fecha} · {etiquetaHorario(col.horario)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filasGrilla.map((vehiculoId) => (
                          <tr key={vehiculoId}>
                            <td style={celdaCuerpo}>
                              {vehiculoPorId.get(vehiculoId)?.placa ?? vehiculoId}
                            </td>
                            {columnasGrilla.map((col) => {
                              const asignacion = celda(vehiculoId, col.fecha, col.horario);
                              return (
                                <td key={`${col.fecha}|${col.horario}`} style={celdaCuerpo}>
                                  {asignacion ? (
                                    <button
                                      onClick={() =>
                                        rotacionActual.estado === 'borrador' &&
                                        setModalAsignacion({ asignacion })
                                      }
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        cursor:
                                          rotacionActual.estado === 'borrador'
                                            ? 'pointer'
                                            : 'default',
                                        textAlign: 'left',
                                        padding: 0,
                                      }}
                                    >
                                      <div>
                                        {rutaPorId.get(asignacion.rutaId)?.sentido ??
                                          asignacion.rutaId}
                                      </div>
                                      <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                                        {asignacion.conductorId
                                          ? (conductorPorId.get(asignacion.conductorId)?.nombre ??
                                            'Conductor')
                                          : 'Sin conductor'}
                                      </div>
                                    </button>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmacion !== null}
        title={confirmacion === 'publicar' ? 'Publicar rotación' : 'Anular rotación'}
        message={
          confirmacion === 'publicar'
            ? 'Una vez publicada, esta rotación queda disponible para la app móvil.'
            : 'La rotación vuelve a borrador y deja de alimentar la app móvil hasta que se publique de nuevo.'
        }
        variant={confirmacion === 'anular' ? 'danger' : 'primary'}
        confirmLabel={procesando ? 'Procesando...' : 'Confirmar'}
        onConfirm={confirmarPublicarOAnular}
        onCancel={() => setConfirmacion(null)}
      />

      {rotacionActual && modalAsignacion && (
        <AsignacionModal
          token={token}
          rotacion={rotacionActual}
          asignacion={modalAsignacion.asignacion}
          rutas={rutas}
          vehiculos={vehiculos}
          conductores={conductores}
          onClose={() => setModalAsignacion(null)}
          onGuardado={() => {
            setModalAsignacion(null);
            void refrescarRotacion(rotacionActual.id);
          }}
        />
      )}

      {rotacionActual && modalNuevaAsignacion && (
        <NuevaAsignacionModal
          token={token}
          rotacion={rotacionActual}
          rutas={rutas}
          vehiculos={vehiculos}
          conductores={conductores}
          onClose={() => setModalNuevaAsignacion(false)}
          onGuardado={() => {
            setModalNuevaAsignacion(false);
            void refrescarRotacion(rotacionActual.id);
          }}
        />
      )}
    </div>
  );
}

function AsignacionModal(props: {
  token: string | null;
  rotacion: RotacionConAsignaciones;
  asignacion: Asignacion;
  rutas: RutaConLinea[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { token, rotacion, asignacion, rutas, vehiculos, conductores, onClose, onGuardado } = props;
  const [rutaId, setRutaId] = useState(asignacion.rutaId);
  const [conductorId, setConductorId] = useState(asignacion.conductorId ?? '');
  const [horario, setHorario] = useState<Turno>(asignacion.horario);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  async function guardar() {
    if (!token) return;
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.actualizarAsignacion(token, rotacion.id, asignacion.id, {
        rutaId,
        conductorId: conductorId || null,
        horario,
      });
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar() {
    if (!token) return;
    setConfirmarQuitar(false);
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.eliminarAsignacion(token, rotacion.id, asignacion.id);
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Modal
        open
        title={`Editar asignación — ${vehiculos.find((v) => v.id === asignacion.vehiculoId)?.placa ?? ''}`}
        onClose={onClose}
        footer={
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Button variant="danger" onClick={() => setConfirmarQuitar(true)} disabled={guardando}>
              Quitar
            </Button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant="ghost" onClick={onClose} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {error && (
            <Alert variant="danger" title="No se pudo guardar">
              {error}
            </Alert>
          )}
          <Select
            label="Ruta"
            options={rutas.map((r) => ({ label: `${r.linea.codigo} — ${r.sentido}`, value: r.id }))}
            value={rutaId}
            onChange={(e) => setRutaId(e.target.value)}
          />
          <Select
            label="Conductor"
            options={[
              { label: 'Sin conductor', value: '' },
              ...conductores.map((c) => ({ label: c.nombre, value: c.id })),
            ]}
            value={conductorId}
            onChange={(e) => setConductorId(e.target.value)}
          />
          <Select
            label="Horario"
            options={HORARIOS}
            value={horario}
            onChange={(e) => setHorario(e.target.value as Turno)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmarQuitar}
        title="Quitar asignación"
        message="Esta asignación se elimina de la rotación. Esta acción no se puede deshacer."
        variant="danger"
        confirmLabel={guardando ? 'Quitando...' : 'Quitar'}
        onConfirm={quitar}
        onCancel={() => setConfirmarQuitar(false)}
      />
    </>
  );
}

function NuevaAsignacionModal(props: {
  token: string | null;
  rotacion: RotacionConAsignaciones;
  rutas: RutaConLinea[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { token, rotacion, rutas, vehiculos, conductores, onClose, onGuardado } = props;
  const [vehiculoId, setVehiculoId] = useState(vehiculos[0]?.id ?? '');
  const [rutaId, setRutaId] = useState(rutas[0]?.id ?? '');
  const [conductorId, setConductorId] = useState('');
  const [fecha, setFecha] = useState('');
  const [horario, setHorario] = useState<Turno>('manana');
  const [orden, setOrden] = useState('1');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!token || !vehiculoId || !rutaId || !fecha) return;
    setGuardando(true);
    setError(null);
    try {
      await rotacionesApi.crearAsignacion(token, rotacion.id, {
        vehiculoId,
        rutaId,
        conductorId: conductorId || undefined,
        fecha: new Date(fecha),
        horario,
        orden: Number(orden),
      });
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open
      title="Agregar asignación"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !vehiculoId || !rutaId || !fecha}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {error && (
          <Alert variant="danger" title="No se pudo guardar">
            {error}
          </Alert>
        )}
        <Select
          label="Vehículo"
          options={vehiculos.map((v) => ({ label: v.placa, value: v.id }))}
          value={vehiculoId}
          onChange={(e) => setVehiculoId(e.target.value)}
        />
        <Select
          label="Ruta"
          options={rutas.map((r) => ({ label: `${r.linea.codigo} — ${r.sentido}`, value: r.id }))}
          value={rutaId}
          onChange={(e) => setRutaId(e.target.value)}
        />
        <Select
          label="Conductor"
          options={[
            { label: 'Sin conductor', value: '' },
            ...conductores.map((c) => ({ label: c.nombre, value: c.id })),
          ]}
          value={conductorId}
          onChange={(e) => setConductorId(e.target.value)}
        />
        <DatePicker label="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        <Select
          label="Horario"
          options={HORARIOS}
          value={horario}
          onChange={(e) => setHorario(e.target.value as Turno)}
        />
        <Input
          label="Orden"
          type="number"
          value={orden}
          onChange={(e) => setOrden(e.target.value)}
        />
      </div>
    </Modal>
  );
}

const celdaEncabezado: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '2px solid var(--qv-color-border, #ddd)',
  whiteSpace: 'nowrap',
};

const celdaCuerpo: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid var(--qv-color-border, #eee)',
  whiteSpace: 'nowrap',
};

function etiquetaHorario(horario: Turno): string {
  return HORARIOS.find((h) => h.value === horario)?.label ?? horario;
}

/** Rango inclusivo día a día — el doc técnico no especifica el formato de selección de
 * fechas para generar una rotación, así que "desde/hasta" con todos los días intermedios
 * es una asunción razonable de este equipo. */
function rangoDeFechas(desde: string, hasta: string): Date[] {
  const fechas: Date[] = [];
  const cursor = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (cursor.getTime() <= fin.getTime()) {
    fechas.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return fechas;
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
