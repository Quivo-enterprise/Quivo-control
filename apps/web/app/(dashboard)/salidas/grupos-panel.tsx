'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, FormField, Input, Loader, PlateBadge, Select, StatusBadge } from '@quivo/design-system';
import {
  ActualizarGrupoVehiculoSchema,
  CrearGrupoVehiculoSchema,
  type GrupoVehiculo,
  type Vehiculo,
} from '@quivo/shared';
import { Pencil, Plus, Users, X } from 'lucide-react';
import { ApiError } from '../../../src/lib/api/client';
import { mensajeError, useAccionesGrupo, useGruposVehiculo } from './use-salidas';

const MUTED = { color: 'var(--qv-text-secondary)', fontSize: 'var(--qv-text-sm)' } as const;

/** El 409 del backend trae el motivo; si no, este texto cubre el caso "ya está en otro grupo". */
function mensajeMiembro(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) {
    return e.message && !/^Error de API/.test(e.message)
      ? e.message
      : 'Ese trufi ya está en otro grupo. Quitalo de ahí primero.';
  }
  return mensajeError(e);
}

export function GruposPanel({ token, vehiculos }: { token: string; vehiculos: Vehiculo[] }) {
  const grupos = useGruposVehiculo(token, true);
  const acciones = useAccionesGrupo(token);
  const [nombre, setNombre] = useState('');
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const placaPorId = Object.fromEntries(vehiculos.map((v) => [v.id, v.placa]));

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = CrearGrupoVehiculoSchema.safeParse({ nombre });
    if (!parsed.success) {
      setErrorNombre('Poné un nombre de hasta 80 caracteres.');
      return;
    }
    setErrorNombre(null);
    setError(null);
    try {
      await acciones.crear.mutateAsync(parsed.data);
      setNombre('');
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <Card
      header={
        <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={18} aria-hidden /> Grupos de trufis
        </h2>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ ...MUTED, margin: 0 }}>
          Un grupo permite fijar una frecuencia distinta a un conjunto de trufis. Cada trufi pertenece a un solo grupo.
        </p>
        {error && <Alert variant="danger" title="No se pudo guardar">{error}</Alert>}
        {grupos.isPending && <Loader label="Cargando grupos…" />}
        {grupos.isError && <Alert variant="danger" title="No se pudieron cargar los grupos">{mensajeError(grupos.error)}</Alert>}
        {grupos.data?.length === 0 && <p style={MUTED}>Todavía no hay grupos.</p>}
        {grupos.data?.map((g) => (
          <GrupoItem
            key={g.id}
            grupo={g}
            vehiculos={vehiculos}
            placaPorId={placaPorId}
            ocupado={acciones.actualizar.isPending || acciones.agregarMiembro.isPending || acciones.quitarMiembro.isPending}
            onError={setError}
            onRenombrar={(nuevo) => acciones.actualizar.mutateAsync({ id: g.id, data: { nombre: nuevo } })}
            onEstado={() =>
              acciones.actualizar.mutateAsync({ id: g.id, data: { estado: g.estado === 'activo' ? 'inactivo' : 'activo' } })
            }
            onAgregar={(vehiculoId) => acciones.agregarMiembro.mutateAsync({ id: g.id, vehiculoId })}
            onQuitar={(vehiculoId) => acciones.quitarMiembro.mutateAsync({ id: g.id, vehiculoId })}
          />
        ))}
        <form
          onSubmit={(e) => void crear(e)}
          noValidate
          aria-label="Alta de grupo"
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--qv-border-subtle)', paddingTop: '1rem' }}
        >
          <div style={{ width: '16rem' }}>
            <FormField label="Nuevo grupo" htmlFor="grupo-nuevo" error={errorNombre ?? undefined}>
              <Input id="grupo-nuevo" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} aria-invalid={Boolean(errorNombre)} fullWidth />
            </FormField>
          </div>
          <Button type="submit" disabled={acciones.crear.isPending}>
            <Plus size={16} aria-hidden /> Crear grupo
          </Button>
        </form>
      </div>
    </Card>
  );
}

function GrupoItem({
  grupo,
  vehiculos,
  placaPorId,
  ocupado,
  onError,
  onRenombrar,
  onEstado,
  onAgregar,
  onQuitar,
}: {
  grupo: GrupoVehiculo;
  vehiculos: Vehiculo[];
  placaPorId: Record<string, string>;
  ocupado: boolean;
  onError: (mensaje: string | null) => void;
  onRenombrar: (nombre: string) => Promise<unknown>;
  onEstado: () => Promise<unknown>;
  onAgregar: (vehiculoId: string) => Promise<unknown>;
  onQuitar: (vehiculoId: string) => Promise<unknown>;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(grupo.nombre);
  const [nuevo, setNuevo] = useState('');

  const correr = async (fn: () => Promise<unknown>, mapear: (e: unknown) => string = mensajeError) => {
    onError(null);
    try {
      await fn();
    } catch (e) {
      onError(mapear(e));
    }
  };

  const guardarNombre = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = ActualizarGrupoVehiculoSchema.safeParse({ nombre });
    if (!parsed.success) return onError('El nombre no puede estar vacío ni pasar de 80 caracteres.');
    await correr(() => onRenombrar(parsed.data.nombre as string));
    setEditando(false);
  };

  const disponibles = vehiculos.filter((v) => !grupo.vehiculoIds.includes(v.id));

  return (
    <section
      aria-label={`Grupo ${grupo.nombre}`}
      style={{ border: '1px solid var(--qv-border-subtle)', borderRadius: 'var(--qv-radius-md)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {editando ? (
          <form onSubmit={(e) => void guardarNombre(e)} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Input aria-label={`Nombre del grupo ${grupo.nombre}`} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
            <Button type="submit" size="sm" disabled={ocupado}>Guardar</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditando(false); setNombre(grupo.nombre); }}>Cancelar</Button>
          </form>
        ) : (
          <>
            <strong>{grupo.nombre}</strong>
            <StatusBadge status={grupo.estado === 'activo' ? 'active' : 'inactive'} label={grupo.estado === 'activo' ? 'Activo' : 'Inactivo'} />
            <Button size="sm" variant="ghost" aria-label={`Renombrar ${grupo.nombre}`} onClick={() => setEditando(true)}>
              <Pencil size={14} aria-hidden /> Renombrar
            </Button>
            <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => void correr(onEstado)}>
              {grupo.estado === 'activo' ? 'Desactivar' : 'Activar'}
            </Button>
          </>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {grupo.vehiculoIds.length === 0 && <li style={MUTED}>Sin trufis.</li>}
        {grupo.vehiculoIds.map((id) => (
          <li key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <PlateBadge plate={placaPorId[id] ?? 'sin placa'} />
            <Button
              size="sm"
              variant="ghost"
              disabled={ocupado}
              aria-label={`Quitar ${placaPorId[id] ?? 'trufi'} de ${grupo.nombre}`}
              onClick={() => void correr(() => onQuitar(id))}
            >
              <X size={14} aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '14rem' }}>
          <Select
            aria-label={`Agregar trufi a ${grupo.nombre}`}
            placeholder="Agregar un trufi…"
            options={disponibles.map((v) => ({ label: v.numeroInterno ? `${v.placa} · int. ${v.numeroInterno}` : v.placa, value: v.id }))}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={ocupado || !nuevo}
          onClick={() => void correr(() => onAgregar(nuevo), mensajeMiembro).then(() => setNuevo(''))}
        >
          Agregar
        </Button>
      </div>
    </section>
  );
}
