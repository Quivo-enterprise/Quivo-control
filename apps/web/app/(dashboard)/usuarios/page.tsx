'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Grid,
  Input,
  Loader,
  MetricCard,
  PageHeader,
  Select,
  Tooltip,
} from '@quivo/design-system';
import type { UsuarioAdministrativo } from '@quivo/shared';
import {
  Building2,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { usuariosApi } from '../../../src/lib/api/usuarios';
import { ApiError } from '../../../src/lib/api/client';

const OPCIONES_ROL = [
  { label: 'Todos los roles', value: '' },
  { label: 'Administrador QUIVO', value: 'admin_quivo' },
  { label: 'Administrador de sindicato', value: 'admin_sindicato' },
  { label: 'Conductor', value: 'conductor' },
];

export default function UsuariosPage() {
  const { token } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdministrativo[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [rol, setRol] = useState('');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [confirmarRestablecimiento, setConfirmarRestablecimiento] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelado = false;
    setCargandoUsuarios(true);
    setErrorUsuarios(null);
    usuariosApi
      .listar(token)
      .then((data) => {
        if (!cancelado) setUsuarios(data);
      })
      .catch((err: unknown) => {
        if (!cancelado) {
          setErrorUsuarios(err instanceof ApiError ? err.message : 'Error al cargar usuarios');
        }
      })
      .finally(() => {
        if (!cancelado) setCargandoUsuarios(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const usuariosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLocaleLowerCase();
    return usuarios.filter(
      (usuario) =>
        (!rol || usuario.rol === rol) &&
        (!texto ||
          usuario.name.toLocaleLowerCase().includes(texto) ||
          usuario.email.toLocaleLowerCase().includes(texto)),
    );
  }, [busqueda, rol, usuarios]);

  const hayFiltrosActivos = Boolean(busqueda || rol);

  const totalAdminQuivo = useMemo(() => usuarios.filter((u) => u.rol === 'admin_quivo').length, [usuarios]);
  const totalAdminSindicato = useMemo(() => usuarios.filter((u) => u.rol === 'admin_sindicato').length, [usuarios]);
  const totalConductores = useMemo(() => usuarios.filter((u) => u.rol === 'conductor').length, [usuarios]);

  function prepararRestablecimiento(usuario: UsuarioAdministrativo) {
    setEmail(usuario.email);
    setError(null);
    setAviso(null);
  }

  async function resetear() {
    if (!token || !email.trim() || newPassword.length < 8 || newPassword !== confirmPassword)
      return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      await usuariosApi.resetearPassword(token, { email: email.trim(), newPassword });
      setAviso(
        `Contraseña actualizada para ${email.trim()}. Comunicásela por un canal seguro — no queda registrada en ningún lado.`,
      );
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
    } finally {
      setGuardando(false);
      setConfirmarRestablecimiento(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title="Directorio de Usuarios"
        subtitle="Control de accesos y restablecimiento asistido de credenciales administrativas."
      />

      {error && (
        <Alert variant="danger" title="No se pudo actualizar">
          {error}
        </Alert>
      )}
      {aviso && (
        <Alert variant="success" title="Listo">
          {aviso}
        </Alert>
      )}

      {/* Métricas KPI de Usuarios */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(13.5rem, 1fr))',
          gap: '0.875rem',
        }}
      >
        <div
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
            <Users size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total de Cuentas
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {usuarios.length}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                activas
              </span>
            </div>
          </div>
        </div>

        <div
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
            <ShieldCheck size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Admins Centrales
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {totalAdminQuivo}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                QUIVO
              </span>
            </div>
          </div>
        </div>

        <div
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
            <Building2 size={19} />
          </span>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--qv-text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Admins Sindicato
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {totalAdminSindicato}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                operadores
              </span>
            </div>
          </div>
        </div>

        <div
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
              Conductores
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginTop: '0.2rem' }}>
              <strong style={{ fontSize: '1.25rem', color: '#ffffff', fontWeight: 800 }}>
                {totalConductores}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--qv-text-secondary)', fontWeight: 500 }}>
                móviles
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Directorio de Usuarios y Restablecimiento */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 22rem', gap: '1.25rem', alignItems: 'start' }}>
        {/* Tabla de Usuarios con Barra de Filtros */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              padding: '0.85rem 1.15rem',
              backgroundColor: 'var(--qv-surface-glass)',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid var(--qv-border-glass)',
              borderRadius: 'var(--qv-radius-xl)',
              boxShadow: 'var(--qv-shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <div style={{ minWidth: '13rem', flex: '1 1 auto' }}>
                <Input
                  placeholder="Buscar por nombre o email..."
                  value={busqueda}
                  onChange={(event) => setBusqueda(event.target.value)}
                />
              </div>

              <div style={{ minWidth: '12rem' }}>
                <Select
                  options={OPCIONES_ROL}
                  value={rol}
                  onChange={(event) => setRol(event.target.value)}
                />
              </div>

              {hayFiltrosActivos && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBusqueda('');
                    setRol('');
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>

            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--qv-text-secondary)' }}>
              {usuariosFiltrados.length} de {usuarios.length} cuentas
            </span>
          </div>

          {cargandoUsuarios ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <Loader label="Cargando directorio de usuarios..." />
            </div>
          ) : errorUsuarios ? (
            <Alert variant="danger" title="Error">
              {errorUsuarios}
            </Alert>
          ) : usuariosFiltrados.length === 0 ? (
            <Card>
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--qv-text-muted)' }}>
                <UserCog size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
                <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--qv-text-secondary)', margin: '0 0 0.25rem 0' }}>
                  Sin usuarios encontrados
                </p>
                <span style={{ fontSize: '0.8125rem' }}>
                  No hay cuentas que coincidan con los criterios de búsqueda.
                </span>
              </div>
            </Card>
          ) : (
            <div className="qv-table-wrap">
              <table className="qv-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Email</th>
                    <th>Rol en Plataforma</th>
                    <th>Ámbito</th>
                    <th style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {usuariosFiltrados.map((u) => {
                    const inicial = (u.name?.[0] || u.email?.[0] || 'U').toUpperCase();
                    return (
                      <tr key={u.id} role="row">
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <div
                              style={{
                                width: '2rem',
                                height: '2rem',
                                borderRadius: '50%',
                                backgroundColor: 'var(--qv-color-primary)',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                flexShrink: 0,
                              }}
                            >
                              {inicial}
                            </div>
                            <strong style={{ fontSize: '0.875rem', color: '#ffffff' }}>
                              {u.name}
                            </strong>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem', color: 'var(--qv-text-secondary)' }}>
                            <Mail size={13} style={{ color: 'var(--qv-color-primary)' }} />
                            <span style={{ color: '#ffffff' }}>{u.email}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.15rem 0.5rem',
                              borderRadius: 'var(--qv-radius-full)',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor:
                                u.rol === 'admin_quivo'
                                  ? 'color-mix(in srgb, var(--qv-color-accent) 15%, transparent)'
                                  : u.rol === 'admin_sindicato'
                                    ? 'color-mix(in srgb, var(--qv-color-primary) 15%, transparent)'
                                    : 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
                              color:
                                u.rol === 'admin_quivo'
                                  ? 'var(--qv-color-accent)'
                                  : u.rol === 'admin_sindicato'
                                    ? 'var(--qv-color-primary)'
                                    : 'var(--qv-text-secondary)',
                              border: '1px solid var(--qv-border-glass)',
                            }}
                          >
                            {u.rol === 'admin_quivo'
                              ? 'Admin QUIVO'
                              : u.rol === 'admin_sindicato'
                                ? 'Admin Sindicato'
                                : 'Conductor'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--qv-text-secondary)', fontWeight: 600 }}>
                            {u.sindicatoId ?? 'Central QUIVO'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="qv-table-actions-capsule">
                            <Tooltip content="Restablecer contraseña">
                              <button
                                type="button"
                                className="qv-action-pill-btn"
                                onClick={() => prepararRestablecimiento(u)}
                                aria-label="Restablecer contraseña"
                              >
                                <KeyRound size={13} />
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Panel Lateral de Restablecimiento */}
        <Card header="Restablecer Contraseña">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--qv-text-secondary)', lineHeight: 1.4 }}>
              Asigna una nueva clave para el usuario seleccionado. Al actualizarse, se cerrarán todas sus sesiones activas de inmediato.
            </p>

            <Input
              label="Email del usuario"
              type="email"
              placeholder="ejemplo@sindicato.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Contraseña nueva"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              helperText="Mínimo 8 caracteres alfanuméricos."
            />
            <Input
              label="Confirmar contraseña nueva"
              type="password"
              placeholder="Repite la contraseña"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              helperText={
                confirmPassword && confirmPassword !== newPassword
                  ? 'Las contraseñas no coinciden.'
                  : undefined
              }
            />
            <Button
              onClick={() => setConfirmarRestablecimiento(true)}
              disabled={
                guardando ||
                !email.trim() ||
                newPassword.length < 8 ||
                newPassword !== confirmPassword
              }
            >
              <Lock size={14} style={{ marginRight: '0.35rem' }} />
              {guardando ? 'Actualizando...' : 'Restablecer contraseña'}
            </Button>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmarRestablecimiento}
        title="Confirmar restablecimiento"
        message={`Se revocarán todas las sesiones activas de ${email.trim()} y deberá iniciar sesión con la nueva credencial. Confirma que la comunicarás por un canal seguro.`}
        variant="danger"
        confirmLabel={guardando ? 'Actualizando...' : 'Confirmar restablecimiento'}
        onConfirm={resetear}
        onCancel={() => setConfirmarRestablecimiento(false)}
      />
    </div>
  );
}
