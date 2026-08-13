'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProgressBarProps } from '@quivo/design-system';
import {
  ActionButton,
  Alert,
  ChartCard,
  DataPanel,
  Grid,
  KpiCard,
  Loader,
  ProgressBar,
} from '@quivo/design-system';
import type {
  Conductor,
  Rotacion,
  Sancion,
  Sindicato,
  Socio,
  SyncErrorEntry,
  Vehiculo,
} from '@quivo/shared';
import { useAuth } from '../../src/lib/auth/auth-context';
import { ApiError } from '../../src/lib/api/client';
import { sindicatosApi } from '../../src/lib/api/sindicatos';
import { sociosApi } from '../../src/lib/api/socios';
import { vehiculosApi } from '../../src/lib/api/vehiculos';
import { conductoresApi } from '../../src/lib/api/conductores';
import { rotacionesApi } from '../../src/lib/api/rotaciones';
import { sancionesApi } from '../../src/lib/api/sanciones';
import { syncErroresApi } from '../../src/lib/api/sync-errores';

const VEHICULO_VARIANT: Record<Vehiculo['estado'], ProgressBarProps['variant']> = {
  pendiente: 'primary',
  activo: 'success',
  inactivo: 'danger',
  suspendido: 'warning',
  mantenimiento: 'accent',
};

const CONDUCTOR_VARIANT: Record<Conductor['estado'], ProgressBarProps['variant']> = {
  activo: 'success',
  inactivo: 'danger',
};

function contarPorEstado<E extends string>(rows: { estado: E }[]): [E, number][] {
  const counts = new Map<E, number>();
  for (const row of rows) {
    counts.set(row.estado, (counts.get(row.estado) ?? 0) + 1);
  }
  return [...counts.entries()];
}

/** RF-01..19 (KPIs reales) — reemplaza los datos de ejemplo de QUI-227: encontrado durante
 * el repaso de M1-M4 que esta página seguía en `demo-data.ts` aunque las 4 APIs que necesita
 * (sindicatos/socios/vehículos/conductores) ya son reales desde QUI-220..224. `admin_quivo`
 * ve el conteo real de sindicatos activos; `admin_sindicato`/`operador` no pueden llamar
 * `GET /v1/sindicatos` (QUI-220 es admin_quivo-only), así que esa tarjeta queda oculta para
 * ellos en vez de mostrar un 0 engañoso. */
export default function DashboardHomePage() {
  const { token, user } = useAuth();
  const [sindicatos, setSindicatos] = useState<Sindicato[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [rotaciones, setRotaciones] = useState<Rotacion[]>([]);
  const [sancionesPendientes, setSancionesPendientes] = useState<Sancion[]>([]);
  const [erroresSync, setErroresSync] = useState<SyncErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      user?.rol === 'admin_quivo' ? sindicatosApi.listar(token) : Promise.resolve<Sindicato[]>([]),
      sociosApi.listar(token),
      vehiculosApi.listar(token),
      conductoresApi.listar(token),
      rotacionesApi.listar(token),
      sancionesApi.listar(token, { estado: 'pendiente' }),
      syncErroresApi.listar(token, { desde: haceSieteDias() }),
    ])
      .then(([s, so, v, c, r, sa, es]) => {
        setSindicatos(s);
        setSocios(so);
        setVehiculos(v);
        setConductores(c);
        setRotaciones(r);
        setSancionesPendientes(sa);
        setErroresSync(es);
      })
      .catch((err: unknown) => setError(mensajeError(err)))
      .finally(() => setLoading(false));
  }, [token, user?.rol]);

  const sindicatosActivos = sindicatos.filter((s) => s.estado === 'activo').length;
  const vehiculosSinAsignar = vehiculos.filter((v) => !v.socioId).length;
  const conductoresActivos = conductores.filter((c) => c.estado === 'activo').length;
  const sociosActivos = socios.filter((s) => s.estado === 'activo').length;
  const rotacionesBorrador = rotaciones.filter((rotacion) => rotacion.estado === 'borrador').length;
  const vehiculosQueRequierenAtencion = vehiculos.filter(
    (vehiculo) => vehiculo.estado !== 'activo',
  ).length;

  const flotaPorEstado = useMemo(() => contarPorEstado(vehiculos), [vehiculos]);
  const conductoresPorEstado = useMemo(() => contarPorEstado(conductores), [conductores]);

  if (loading) {
    return <Loader label="Cargando panel..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}
      <Grid columns={user?.rol === 'admin_quivo' ? 4 : 3} gap="md">
        {user?.rol === 'admin_quivo' && (
          <KpiCard label="Sindicatos activos" value={sindicatosActivos} tone="primary" />
        )}
        <KpiCard
          label="Vehículos registrados"
          value={vehiculos.length}
          delta={`${vehiculosSinAsignar} sin socio asignado`}
          tone="accent"
        />
        <KpiCard
          label="Conductores activos"
          value={conductoresActivos}
          delta={`de ${conductores.length} registrados`}
          tone="success"
        />
        <KpiCard
          label="Socios activos"
          value={sociosActivos}
          delta={`de ${socios.length} registrados`}
          tone="neutral"
        />
      </Grid>
      <DataPanel
        title="Acciones prioritarias"
        description="Resumen operativo con accesos directos a los pendientes que requieren seguimiento."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
            gap: '1rem',
          }}
        >
          <AccionPrioritaria
            titulo="Borradores de rotación"
            detalle={
              rotacionesBorrador === 0
                ? 'No hay rotaciones pendientes de publicación.'
                : `${rotacionesBorrador} ${rotacionesBorrador === 1 ? 'borrador requiere' : 'borradores requieren'} revisión.`
            }
            accion="Revisar rotaciones"
            href="/rotaciones"
          />
          <AccionPrioritaria
            titulo="Sanciones pendientes"
            detalle={
              sancionesPendientes.length === 0
                ? 'No hay sanciones pendientes de resolución.'
                : `${sancionesPendientes.length} ${sancionesPendientes.length === 1 ? 'sanción espera' : 'sanciones esperan'} una decisión.`
            }
            accion="Revisar sanciones"
            href="/reglas"
          />
          <AccionPrioritaria
            titulo="Errores de sincronización"
            detalle={
              erroresSync.length === 0
                ? 'No se registraron errores en los últimos 7 días.'
                : `${erroresSync.length} ${erroresSync.length === 1 ? 'error fue reportado' : 'errores fueron reportados'} en los últimos 7 días.`
            }
            accion="Ver errores de sync"
            href="/sync-errores"
          />
          <AccionPrioritaria
            titulo="Flota para regularizar"
            detalle={
              vehiculosQueRequierenAtencion === 0
                ? 'Toda la flota registrada está activa.'
                : `${vehiculosQueRequierenAtencion} ${vehiculosQueRequierenAtencion === 1 ? 'vehículo requiere' : 'vehículos requieren'} seguimiento de estado.`
            }
            accion="Revisar flota"
            href="/vehiculos"
          />
        </div>
      </DataPanel>
      <Grid columns={2} gap="md">
        <ChartCard title="Flota por estado" subtitle={`${vehiculos.length} vehículos registrados`}>
          {flotaPorEstado.length === 0 ? (
            <span>Sin vehículos todavía.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {flotaPorEstado.map(([estado, count]) => (
                <ProgressBar
                  key={estado}
                  label={`${estado} (${count})`}
                  value={count}
                  max={vehiculos.length}
                  variant={VEHICULO_VARIANT[estado]}
                  showValue
                />
              ))}
            </div>
          )}
        </ChartCard>
        <ChartCard
          title="Conductores por estado"
          subtitle={`${conductores.length} conductores registrados`}
        >
          {conductoresPorEstado.length === 0 ? (
            <span>Sin conductores todavía.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {conductoresPorEstado.map(([estado, count]) => (
                <ProgressBar
                  key={estado}
                  label={`${estado} (${count})`}
                  value={count}
                  max={conductores.length}
                  variant={CONDUCTOR_VARIANT[estado]}
                  showValue
                />
              ))}
            </div>
          )}
        </ChartCard>
      </Grid>
      <DataPanel
        title="Bienvenido a QUIVO Control"
        description="Panel administrativo con datos reales."
      >
        <p>Usá el menú lateral para navegar entre los módulos habilitados para tu rol.</p>
      </DataPanel>
    </div>
  );
}

function AccionPrioritaria({
  titulo,
  detalle,
  accion,
  href,
}: {
  titulo: string;
  detalle: string;
  accion: string;
  href: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '10rem',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.75rem',
        justifyContent: 'space-between',
        padding: '1rem',
        border: '1px solid var(--qv-border-subtle, #d8dde6)',
        borderRadius: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <strong>{titulo}</strong>
        <span>{detalle}</span>
      </div>
      <ActionButton href={href} label={accion} size="sm" />
    </div>
  );
}

function haceSieteDias(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}
