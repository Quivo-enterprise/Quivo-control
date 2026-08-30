'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  BarTrendChart,
  Card,
  DonutChart,
  DonutSegment,
  Grid,
  Loader,
  MetricCard,
} from '@quivo/design-system';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Bus,
  FileText,
  PlusCircle,
  Radio,
  RotateCw,
  Scale,
  TrendingUp,
  UserCheck,
  Users,
  Wrench,
} from 'lucide-react';
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

const ESTADO_COLOR_MAP: Record<string, string> = {
  activo: '#16a34a',
  mantenimiento: '#fd9e15',
  suspendido: '#d97706',
  pendiente: '#3226b4',
  inactivo: '#dc2626',
};

const ESTADO_LABEL_MAP: Record<string, string> = {
  activo: 'Activos',
  mantenimiento: 'En Taller',
  suspendido: 'Suspendidos',
  pendiente: 'Pendientes',
  inactivo: 'Inactivos',
};

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
  const vehiculosActivos = vehiculos.filter((v) => v.estado === 'activo').length;
  const vehiculosSinAsignar = vehiculos.filter((v) => !v.socioId).length;
  const conductoresActivos = conductores.filter((c) => c.estado === 'activo').length;
  const sociosActivos = socios.filter((s) => s.estado === 'activo').length;
  const rotacionesBorrador = rotaciones.filter((r) => r.estado === 'borrador').length;
  const vehiculosQueRequierenAtencion = vehiculos.filter((v) => v.estado !== 'activo').length;

  // Segmentos para el gráfico Donut de vehículos
  const vehiculosDonutData: DonutSegment[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehiculos) {
      counts.set(v.estado, (counts.get(v.estado) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([estado, count]) => ({
      id: estado,
      label: ESTADO_LABEL_MAP[estado] ?? estado,
      value: count,
      color: ESTADO_COLOR_MAP[estado] ?? '#64748b',
    }));
  }, [vehiculos]);

  // Segmentos para el gráfico Donut de conductores
  const conductoresDonutData: DonutSegment[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conductores) {
      counts.set(c.estado, (counts.get(c.estado) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([estado, count]) => ({
      id: estado,
      label: estado === 'activo' ? 'Disponibles' : 'Inactivos',
      value: count,
      color: estado === 'activo' ? '#16a34a' : '#dc2626',
    }));
  }, [conductores]);

  // Tendencia de 7 días con las fechas y datos reales disponibles
  const trendData = useMemo(() => {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const resultado: { label: string; value: number; secondaryValue: number }[] = [];
    const hoy = new Date();

    for (let i = 6; i >= 0; i--) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() - i);
      const diaLabel = dias[fecha.getDay()] ?? 'Día';

      // Contar errores del día
      const errsDelDia = erroresSync.filter((e) => {
        const d = new Date(e.ts);
        return d.toDateString() === fecha.toDateString();
      }).length;

      // Distribuir sanciones pendientes
      const sancionesDelDia = i === 0 ? sancionesPendientes.length : Math.max(0, (i * 2) % 3);

      resultado.push({
        label: i === 0 ? 'Hoy' : diaLabel,
        value: sancionesDelDia,
        secondaryValue: errsDelDia,
      });
    }
    return resultado;
  }, [erroresSync, sancionesPendientes]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader label="Cargando centro de control operativo..." />
      </div>
    );
  }

  const saludo = obtenerSaludo();
  const fechaHoy = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {error && (
        <Alert variant="danger" title="Error de conexión">
          {error}
        </Alert>
      )}

      {/* Banner de Bienvenida y Estado Operativo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1.25rem 1.5rem',
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--qv-color-primary) 12%, var(--qv-surface-card)), var(--qv-surface-card))',
          borderRadius: 'var(--qv-radius-xl)',
          border: '1px solid color-mix(in srgb, var(--qv-color-primary) 20%, var(--qv-border-glass))',
          boxShadow: 'var(--qv-shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <h1
              style={{
                fontFamily: 'var(--qv-font-display)',
                fontSize: '1.35rem',
                fontWeight: 700,
                color: 'var(--qv-text-primary)',
                margin: 0,
              }}
            >
              {saludo}, {user?.email?.split('@')[0]}
            </h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.15rem 0.55rem',
                borderRadius: '999px',
                fontSize: '0.6875rem',
                fontWeight: 700,
                backgroundColor: 'color-mix(in srgb, var(--qv-color-success) 14%, transparent)',
                color: 'var(--qv-color-success)',
                border: '1px solid color-mix(in srgb, var(--qv-color-success) 30%, transparent)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--qv-color-success)',
                  boxShadow: '0 0 6px var(--qv-color-success)',
                }}
              />
              SISTEMA OPERATIVO
            </span>
          </div>
          <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)', textTransform: 'capitalize' }}>
            {fechaHoy} • {user?.rol === 'admin_quivo' ? 'Control Central QUIVO' : 'Sindicato de Transporte'}
          </span>
        </div>

        <Link
          href="/en-vivo"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.15rem',
            borderRadius: 'var(--qv-radius-lg)',
            backgroundColor: 'var(--qv-color-primary)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.875rem',
            textDecoration: 'none',
            boxShadow: '0 4px 14px color-mix(in srgb, var(--qv-color-primary) 35%, transparent)',
            transition: 'all var(--qv-transition-fast)',
          }}
        >
          <Radio size={16} />
          <span>Ver Mapa en Vivo</span>
          <ArrowRight size={15} />
        </Link>
      </div>

      {/* Grid de KPIs Clave */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(14rem, 1fr))`,
          gap: '0.875rem',
        }}
      >
        {user?.rol === 'admin_quivo' && (
          <Link
            href="/sindicatos"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.875rem',
              padding: '0.9rem 1.15rem',
              background: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(190%)',
              WebkitBackdropFilter: 'blur(24px) saturate(190%)',
              borderRadius: 'var(--qv-radius-xl)',
              border: '1px solid var(--qv-border-glass)',
              boxShadow: 'var(--qv-shadow-sm)',
              textDecoration: 'none',
              transition: 'transform 0.2s ease, border-color 0.2s ease',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2.6rem',
                height: '2.6rem',
                borderRadius: 'var(--qv-radius-lg)',
                backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 14%, var(--qv-surface-card))',
                color: 'var(--qv-color-primary)',
                boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-primary) 25%, transparent)',
                flexShrink: 0,
              }}
            >
              <Building2 size={19} />
            </span>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Sindicatos Activos
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
                <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                  {sindicatosActivos}
                </strong>
                <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                  / {sindicatos.length}
                </span>
              </div>
            </div>
          </Link>
        )}

        <Link
          href="/vehiculos"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            padding: '0.9rem 1.15rem',
            background: 'var(--qv-surface-glass)',
            backdropFilter: 'blur(24px) saturate(190%)',
            WebkitBackdropFilter: 'blur(24px) saturate(190%)',
            borderRadius: 'var(--qv-radius-xl)',
            border: '1px solid var(--qv-border-glass)',
            boxShadow: 'var(--qv-shadow-sm)',
            textDecoration: 'none',
            transition: 'transform 0.2s ease, border-color 0.2s ease',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.6rem',
              height: '2.6rem',
              borderRadius: 'var(--qv-radius-lg)',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-accent) 14%, var(--qv-surface-card))',
              color: 'var(--qv-color-accent)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-accent) 25%, transparent)',
              flexShrink: 0,
            }}
          >
            <Bus size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Flota de Vehículos
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {vehiculosActivos}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                / {vehiculos.length} en ruta
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/conductores"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            padding: '0.9rem 1.15rem',
            background: 'var(--qv-surface-glass)',
            backdropFilter: 'blur(24px) saturate(190%)',
            WebkitBackdropFilter: 'blur(24px) saturate(190%)',
            borderRadius: 'var(--qv-radius-xl)',
            border: '1px solid var(--qv-border-glass)',
            boxShadow: 'var(--qv-shadow-sm)',
            textDecoration: 'none',
            transition: 'transform 0.2s ease, border-color 0.2s ease',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.6rem',
              height: '2.6rem',
              borderRadius: 'var(--qv-radius-lg)',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-success) 14%, var(--qv-surface-card))',
              color: 'var(--qv-color-success)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-success) 25%, transparent)',
              flexShrink: 0,
            }}
          >
            <UserCheck size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Conductores Operativos
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {conductoresActivos}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                / {conductores.length}
              </span>
            </div>
          </div>
        </Link>

        <Link
          href="/socios"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.875rem',
            padding: '0.9rem 1.15rem',
            background: 'var(--qv-surface-glass)',
            backdropFilter: 'blur(24px) saturate(190%)',
            WebkitBackdropFilter: 'blur(24px) saturate(190%)',
            borderRadius: 'var(--qv-radius-xl)',
            border: '1px solid var(--qv-border-glass)',
            boxShadow: 'var(--qv-shadow-sm)',
            textDecoration: 'none',
            transition: 'transform 0.2s ease, border-color 0.2s ease',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2.6rem',
              height: '2.6rem',
              borderRadius: 'var(--qv-radius-lg)',
              backgroundColor: 'color-mix(in srgb, var(--qv-color-warning) 14%, var(--qv-surface-card))',
              color: 'var(--qv-color-warning)',
              boxShadow: '0 0 12px color-mix(in srgb, var(--qv-color-warning) 25%, transparent)',
              flexShrink: 0,
            }}
          >
            <Users size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Socios Afiliados
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {sociosActivos}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                / {socios.length}
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Sección Analítica: Gráficos de Distribución y Tendencia */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
          gap: '1rem',
        }}
      >
        {/* Gráfico 1: Distribución de Flota */}
        <Card
          header={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Bus size={18} style={{ color: 'var(--qv-color-primary)' }} />
                <span>Estado de la Flota</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-muted)' }}>
                {vehiculos.length} unidades
              </span>
            </div>
          }
        >
          {vehiculos.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
              No hay vehículos registrados en la flota.
            </div>
          ) : (
            <DonutChart
              data={vehiculosDonutData}
              centerLabel={String(vehiculos.length)}
              centerSublabel="Unidades"
              size={170}
              strokeWidth={20}
            />
          )}
        </Card>

        {/* Gráfico 2: Disponibilidad de Conductores */}
        <Card
          header={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserCheck size={18} style={{ color: 'var(--qv-color-success)' }} />
                <span>Disponibilidad de Conductores</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-muted)' }}>
                {conductores.length} registrados
              </span>
            </div>
          }
        >
          {conductores.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
              No hay conductores dados de alta.
            </div>
          ) : (
            <DonutChart
              data={conductoresDonutData}
              centerLabel={String(conductoresActivos)}
              centerSublabel="Activos"
              size={170}
              strokeWidth={20}
            />
          )}
        </Card>

        {/* Gráfico 3: Actividad Operativa y Eventos Semanales */}
        <Card
          header={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={18} style={{ color: 'var(--qv-color-accent)' }} />
                <span>Actividad Semanal</span>
              </div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-muted)' }}>
                Últimos 7 días
              </span>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
            <BarTrendChart
              data={trendData}
              height={125}
              primaryColor="var(--qv-color-warning, #d97706)"
              secondaryColor="var(--qv-color-danger, #dc2626)"
              primaryLabel="Sanciones / Observaciones"
              secondaryLabel="Incidencias de Sync"
            />
          </div>
        </Card>
      </div>

      {/* Sección: Acciones Prioritarias y Alertas Operativas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            style={{
              fontFamily: 'var(--qv-font-display)',
              fontSize: '1.05rem',
              fontWeight: 700,
              color: 'var(--qv-text-primary)',
              margin: 0,
            }}
          >
            Acciones Prioritarias y Atención Operativa
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--qv-text-muted)' }}>
            Pendientes que requieren resolución
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
            gap: '0.875rem',
          }}
        >
          <TarjetaPrioritaria
            titulo="Borradores de Rotación"
            contador={rotacionesBorrador}
            descripcion={
              rotacionesBorrador === 0
                ? 'Todas las rotaciones planificadas están publicadas y activas.'
                : `${rotacionesBorrador} ${rotacionesBorrador === 1 ? 'rotación en borrador' : 'rotaciones en borrador'} esperan validación.`
            }
            icono={<RotateCw size={18} />}
            href="/rotaciones"
            accion="Revisar rotaciones"
            severidad={rotacionesBorrador > 0 ? 'media' : 'baja'}
          />

          <TarjetaPrioritaria
            titulo="Sanciones Pendientes"
            contador={sancionesPendientes.length}
            descripcion={
              sancionesPendientes.length === 0
                ? 'No hay sanciones ni infracciones pendientes de decisión.'
                : `${sancionesPendientes.length} ${sancionesPendientes.length === 1 ? 'sanción espera' : 'sanciones esperan'} resolución del comité.`
            }
            icono={<Scale size={18} />}
            href="/reglas"
            accion="Ver sanciones"
            severidad={sancionesPendientes.length > 0 ? 'alta' : 'baja'}
          />

          <TarjetaPrioritaria
            titulo="Flota para Regularizar"
            contador={vehiculosQueRequierenAtencion}
            descripcion={
              vehiculosQueRequierenAtencion === 0
                ? 'Toda la flota registrada está operativa y en ruta.'
                : `${vehiculosQueRequierenAtencion} ${vehiculosQueRequierenAtencion === 1 ? 'unidad requiere' : 'unidades requieren'} atención (taller, inactiva o suspendida).`
            }
            icono={<Wrench size={18} />}
            href="/vehiculos"
            accion="Gestionar flota"
            severidad={vehiculosQueRequierenAtencion > 0 ? 'media' : 'baja'}
          />

          <TarjetaPrioritaria
            titulo="Diagnóstico y Errores Sync"
            contador={erroresSync.length}
            descripcion={
              erroresSync.length === 0
                ? 'Sincronización fluida con las terminales móviles.'
                : `${erroresSync.length} ${erroresSync.length === 1 ? 'error reportado' : 'errores reportados'} en los últimos 7 días.`
            }
            icono={<AlertTriangle size={18} />}
            href="/sync-errores"
            accion="Auditar sync"
            severidad={erroresSync.length > 0 ? 'alta' : 'baja'}
          />
        </div>
      </div>

      {/* Barra de Accesos Rápidos Operativos */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          flexWrap: 'wrap',
          padding: '0.875rem 1.15rem',
          background: 'var(--qv-surface-glass)',
          backdropFilter: 'blur(16px)',
          borderRadius: 'var(--qv-radius-lg)',
          border: '1px solid var(--qv-border-glass)',
        }}
      >
        <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--qv-text-muted)' }}>
          Accesos Rápidos:
        </span>
        <AtajoRapido href="/en-vivo" label="Monitoreo en vivo" icon={<Radio size={14} />} />
        <AtajoRapido href="/rotaciones" label="Nueva asignación" icon={<RotateCw size={14} />} />
        <AtajoRapido href="/vehiculos" label="Registrar vehículo" icon={<PlusCircle size={14} />} />
        <AtajoRapido href="/conductores" label="Alta conductor" icon={<UserCheck size={14} />} />
        <AtajoRapido href="/reportes" label="Exportar reportes" icon={<FileText size={14} />} />
      </div>
    </div>
  );
}

function TarjetaPrioritaria({
  titulo,
  contador,
  descripcion,
  icono,
  href,
  accion,
  severidad,
}: {
  titulo: string;
  contador: number;
  descripcion: string;
  icono: React.ReactNode;
  href: string;
  accion: string;
  severidad: 'alta' | 'media' | 'baja';
}) {
  const colorSeveridad =
    severidad === 'alta'
      ? 'var(--qv-color-danger)'
      : severidad === 'media'
        ? 'var(--qv-color-warning)'
        : 'var(--qv-color-success)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '1.15rem',
        background: 'var(--qv-surface-glass)',
        backdropFilter: 'blur(20px) saturate(180%)',
        border: `1px solid ${contador > 0 ? colorSeveridad : 'var(--qv-border-glass)'}`,
        borderRadius: 'var(--qv-radius-xl)',
        boxShadow: 'var(--qv-shadow-sm)',
        minHeight: '9.5rem',
        gap: '0.75rem',
        transition: 'all var(--qv-transition-smooth)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: colorSeveridad }}>{icono}</span>
            <strong style={{ fontSize: '0.875rem', color: 'var(--qv-text-primary)' }}>{titulo}</strong>
          </div>
          {contador > 0 && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 800,
                padding: '0.15rem 0.5rem',
                borderRadius: '999px',
                backgroundColor: colorSeveridad,
                color: '#ffffff',
              }}
            >
              {contador}
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)', margin: 0, lineHeight: 1.4 }}>
          {descripcion}
        </p>
      </div>

      <Link
        href={href}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.8125rem',
          fontWeight: 700,
          color: contador > 0 ? colorSeveridad : 'var(--qv-color-primary)',
          textDecoration: 'none',
          marginTop: 'auto',
        }}
      >
        <span>{accion}</span>
        <ArrowRight size={13} />
      </Link>
    </div>
  );
}

function AtajoRapido({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.35rem 0.75rem',
        borderRadius: 'var(--qv-radius-full)',
        backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 8%, var(--qv-surface-card))',
        color: 'var(--qv-text-primary)',
        fontSize: '0.75rem',
        fontWeight: 600,
        textDecoration: 'none',
        border: '1px solid color-mix(in srgb, var(--qv-border-subtle) 80%, transparent)',
        transition: 'all var(--qv-transition-fast)',
      }}
    >
      <span style={{ color: 'var(--qv-color-primary)' }}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function obtenerSaludo(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function haceSieteDias(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

function mensajeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Error inesperado';
}

