'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input, PageHeader } from '@quivo/design-system';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { usuariosApi } from '../../../src/lib/api/usuarios';
import { ApiError } from '../../../src/lib/api/client';

/** Reset asistido de contraseña (solo `admin_quivo`) — el proyecto no tiene proveedor de
 * email configurado, así que no hay flujo de "olvidé mi contraseña" por email; la
 * contraseña nueva se comunica al usuario fuera de banda (WhatsApp, en persona, etc.). */
export default function UsuariosPage() {
  const { token } = useAuth();
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function resetear() {
    if (!token || !email.trim() || newPassword.length < 8) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      await usuariosApi.resetearPassword(token, { email: email.trim(), newPassword });
      setAviso(
        `Contraseña actualizada para ${email.trim()}. Comunicásela por un canal seguro — no queda registrada en ningún lado.`,
      );
      setNewPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Usuarios"
        subtitle="Solo administrador QUIVO — reset asistido de contraseña (sin email configurado)."
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

      <Card header="Restablecer contraseña">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px' }}>
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
          <Button
            onClick={resetear}
            disabled={guardando || !email.trim() || newPassword.length < 8}
          >
            {guardando ? 'Actualizando...' : 'Restablecer contraseña'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
