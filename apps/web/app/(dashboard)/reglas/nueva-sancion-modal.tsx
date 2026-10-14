import { useState } from 'react';
import { Alert, Button, DatePicker, Input, Modal, Select, TextArea } from '@quivo/design-system';
import type { Conductor, CrearSancion, Regla, Socio, SujetoTipo, Vehiculo } from '@quivo/shared';
import { ApiError } from '../../../src/lib/api/client';
import { sancionesApi } from '../../../src/lib/api/sanciones';
import { fechaDesdeDiaLocal } from '../../../src/lib/fecha-local';

export const SUJETO_TIPOS: { label: string; value: SujetoTipo }[] = [
  { label: 'Vehículo', value: 'vehiculo' },
  { label: 'Conductor', value: 'conductor' },
  { label: 'Socio', value: 'socio' },
];

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

/** Valores con los que abre el modal (p. ej. desde una infracción de `/en-vivo`). `fechaHecho`
 * es `YYYY-MM-DD`, el formato del `DatePicker`. */
export interface ValoresInicialesSancion {
  reglaId?: string;
  sujetoTipo?: SujetoTipo;
  sujetoId?: string;
  motivo?: string;
  fechaHecho?: string;
  evidenciaRef?: string;
}

/** Cuerpo de la sanción sin `sindicatoId` (lo que recibe `POST /infracciones/:id/sancionar`). */
export type DatosSancion = Omit<CrearSancion, 'sindicatoId'>;

export function NuevaSancionModal(props: {
  token: string | null;
  sindicatoId: string;
  reglas: Regla[];
  vehiculos: Vehiculo[];
  conductores: Conductor[];
  socios: Socio[];
  onClose: () => void;
  onCreada: () => void;
  /** Opcional: precarga el formulario. Sin esto el modal se comporta como siempre (`/reglas`). */
  valoresIniciales?: ValoresInicialesSancion;
  /** Opcional: en vez de `POST /sanciones`, entrega los datos a este callback (p. ej. para
   * `POST /infracciones/:id/sancionar`). Si lanza, el mensaje se muestra en el modal. */
  onSubmitOverride?: (datos: DatosSancion) => Promise<unknown>;
  /** Opcional: restringe los tipos de sujeto elegibles (default: todos). */
  sujetoTipos?: SujetoTipo[];
  /** Opcional: limita el sujeto a UNA entidad por tipo (p. ej. el conductor y el vehículo de una
   * infracción). Un tipo sin id (`null`/ausente) no se ofrece; al cambiar de tipo el sujeto queda
   * preseleccionado. Sin esto (`/reglas`) se puede elegir cualquiera. */
  sujetosPermitidos?: Partial<Record<SujetoTipo, string | null>>;
  /** Opcional (con `sujetosPermitidos`): nombre a mostrar del sujeto permitido por tipo cuando no
   * está en las listas cargadas (p. ej. la placa / el conductor de la infracción), para que el admin
   * vea siempre a quién sanciona. */
  sujetosEtiquetas?: Partial<Record<SujetoTipo, string>>;
  /** Opcional: texto de ayuda bajo "Regla" (p. ej. cuando no se pudo preseleccionar ninguna). */
  avisoRegla?: string;
}) {
  const {
    token,
    sindicatoId,
    reglas,
    vehiculos,
    conductores,
    socios,
    onClose,
    onCreada,
    valoresIniciales,
    onSubmitOverride,
    sujetoTipos,
    sujetosPermitidos,
    sujetosEtiquetas,
    avisoRegla,
  } = props;
  const tiposSujeto = SUJETO_TIPOS.filter(
    (t) => (!sujetoTipos || sujetoTipos.includes(t.value)) && (!sujetosPermitidos || Boolean(sujetosPermitidos[t.value])),
  );
  // Sin `valoresIniciales` (`/reglas`) se preselecciona la primera regla, como siempre. Con ellos
  // manda lo que se pasó: si no hay `reglaId` válido queda vacío y el admin debe elegir.
  const [reglaId, setReglaId] = useState(
    valoresIniciales
      ? reglas.some((r) => r.id === valoresIniciales.reglaId)
        ? (valoresIniciales.reglaId as string)
        : ''
      : (reglas[0]?.id ?? ''),
  );
  const [sujetoTipo, setSujetoTipo] = useState<SujetoTipo>(
    valoresIniciales?.sujetoTipo && tiposSujeto.some((t) => t.value === valoresIniciales.sujetoTipo)
      ? valoresIniciales.sujetoTipo
      : (tiposSujeto[0]?.value ?? 'vehiculo'),
  );
  const [sujetoId, setSujetoId] = useState(
    sujetosPermitidos ? (sujetosPermitidos[sujetoTipo] ?? '') : (valoresIniciales?.sujetoId ?? ''),
  );
  const [motivo, setMotivo] = useState(valoresIniciales?.motivo ?? '');
  const [fechaHecho, setFechaHecho] = useState(valoresIniciales?.fechaHecho ?? '');
  const [evidenciaRef, setEvidenciaRef] = useState(valoresIniciales?.evidenciaRef ?? '');
  const evidenciaFija = Boolean(valoresIniciales?.evidenciaRef);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idPermitido = sujetosPermitidos?.[sujetoTipo] ?? null;
  const todosLosSujetos =
    sujetoTipo === 'vehiculo'
      ? vehiculos.map((v) => ({ label: v.placa, value: v.id }))
      : sujetoTipo === 'conductor'
        ? conductores.map((c) => ({ label: c.nombre, value: c.id }))
        : socios.map((s) => ({ label: s.nombre, value: s.id }));
  let opcionesSujeto = sujetosPermitidos ? todosLosSujetos.filter((o) => o.value === idPermitido) : todosLosSujetos;
  // El sujeto de la infracción puede no estar en las listas (otro sindicato, lista no cargada): se
  // ofrece igual, con su nombre, en vez de un select vacío con un id oculto.
  if (sujetosPermitidos && idPermitido && opcionesSujeto.length === 0) {
    opcionesSujeto = [{ label: sujetosEtiquetas?.[sujetoTipo] || 'Sujeto de la infracción', value: idPermitido }];
  }

  async function guardar() {
    if (!token || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho) return;
    const fecha = fechaDesdeDiaLocal(fechaHecho);
    if (!fecha) {
      setError('La fecha del hecho no es válida.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const datos: DatosSancion = {
        reglaId,
        sujetoTipo,
        sujetoId,
        motivo: motivo.trim(),
        fechaHecho: fecha,
        evidenciaRef: evidenciaRef.trim() || undefined,
      };
      if (onSubmitOverride) await onSubmitOverride(datos);
      else await sancionesApi.crear(token, { sindicatoId, ...datos });
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
          <Button
            onClick={guardar}
            disabled={guardando || !reglaId || !sujetoId || !motivo.trim() || !fechaHecho}
          >
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
          label="Regla"
          options={reglas.map((r) => ({ label: `${r.nombre} — [${r.gravedad.toUpperCase()}]`, value: r.id }))}
          value={reglaId}
          placeholder={valoresIniciales ? 'Elegí la regla' : undefined}
          helperText={!reglaId ? avisoRegla : undefined}
          onChange={(e) => setReglaId(e.target.value)}
        />
        <Select
          label="Tipo de sujeto"
          options={tiposSujeto}
          value={sujetoTipo}
          onChange={(e) => {
            const tipo = e.target.value as SujetoTipo;
            setSujetoTipo(tipo);
            setSujetoId(sujetosPermitidos?.[tipo] ?? '');
          }}
        />
        <Select
          label="Sujeto"
          options={opcionesSujeto}
          value={sujetoId}
          onChange={(e) => setSujetoId(e.target.value)}
        />
        <TextArea label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <DatePicker
          label="Fecha del hecho"
          value={fechaHecho}
          onChange={(e) => setFechaHecho(e.target.value)}
        />
        <Input
          label="Referencia de evidencia (opcional)"
          value={evidenciaRef}
          onChange={(e) => setEvidenciaRef(e.target.value)}
          readOnly={evidenciaFija}
          helperText={
            evidenciaFija
              ? 'Vinculada automáticamente a la infracción y a la sesión de recorrido.'
              : 'Vinculación automática a datos de recorrido llega con M3 — por ahora es texto libre.'
          }
        />
      </div>
    </Modal>
  );
}
