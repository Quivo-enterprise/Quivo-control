'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Input,
  PageHeader,
  Select,
  type DataColumn,
} from '@quivo/design-system';
import type { UsuarioAdministrativo } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { usuariosApi } from '../../../src/lib/api/usuarios';
import { ApiError } from '../../../src/lib/api/client';

const OPCIONES_ROL = [
  { label: 'Todos los roles', value: '' },
  { label: 'Administrador QUIVO', value: 'admin_quivo' },
  { label: 'Administrador de sindicato', value: 'admin_sindicato' },
  { label: 'Conductor', value: 'conductor' },
];

const USER_COLUMNS: DataColumn<UsuarioAdministrativo>[] = [
  { key: 'name', header: 'Nombre' },
  { key: 'email', header: 'Email' },
  { key: 'rol', header: 'Rol' },
  {
    key: 'sindicatoId',
    header: 'Ámbito',
    render: (usuario) => usuario.sindicatoId ?? 'QUIVO',
  },
];

/** Reset asistido de contraseña (solo `admin_quivo`) — el proyecto no tiene proveedor de
 * email configurado, así que no hay flujo de "olvidé mi contraseña" por email; la
 * contraseña nueva se comunica al usuario fuera de banda (WhatsApp, en persona, etc.). */
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Usuarios"
        subtitle="Directorio y reset asistido de contraseña — solo administrador QUIVO."
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

      <Card header="Usuarios registrados">
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: '1rem',
          }}
        >
          <Input
            label="Buscar por nombre o email"
            placeholder="Ej. admin@sindicato.local"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
          <Select
            label="Rol"
            options={OPCIONES_ROL}
            value={rol}
            onChange={(event) => setRol(event.target.value)}
          />
          {hayFiltrosActivos && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setBusqueda('');
                setRol('');
              }}
            >
              Limpiar filtros
            </Button>
          )}
          <span aria-live="polite">
            {usuariosFiltrados.length} de {usuarios.length}{' '}
            {usuariosFiltrados.length === 1 ? 'usuario visible' : 'usuarios visibles'}
          </span>
        </div>
        <DataTable
          columns={USER_COLUMNS}
          rows={usuariosFiltrados}
          loading={cargandoUsuarios}
          error={errorUsuarios ?? undefined}
          empty={
            hayFiltrosActivos
              ? 'No hay usuarios que coincidan con los filtros.'
              : 'No hay usuarios registrados.'
          }
          actions={(usuario) => (
            <Button variant="ghost" size="sm" onClick={() => prepararRestablecimiento(usuario)}>
              Preparar restablecimiento
            </Button>
          )}
        />
      </Card>

      <Card header="Restablecer contraseña">
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px' }}
        >
          <Input
            label="Email del usuario"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label="Contraseña nueva"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helperText="Mínimo 8 caracteres. Se revocan las sesiones activas de ese usuario."
          />
          <Input
            label="Confirmar contraseña nueva"
            type="password"
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
            {guardando ? 'Actualizando...' : 'Restablecer contraseña'}
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmarRestablecimiento}
        title="Restablecer contraseña"
        message={`Se revocarán las sesiones activas de ${email.trim()} y deberá iniciar sesión con la nueva contraseña. Confirmá que la comunicarás por un canal seguro.`}
        variant="danger"
        confirmLabel={guardando ? 'Actualizando...' : 'Restablecer contraseña'}
        onConfirm={resetear}
        onCancel={() => setConfirmarRestablecimiento(false)}
      />
    </div>
  );
}
