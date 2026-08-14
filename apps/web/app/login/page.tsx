'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AuthLayout, LoginForm } from '@quivo/design-system';
import { BrandLogo } from '../../src/components/brand-logo';
import { useAuth } from '../../src/lib/auth/auth-context';

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const router = useRouter();
  const [mostrarAyudaPassword, setMostrarAyudaPassword] = useState(false);

  const handleSubmit = async (email: string, password: string) => {
    try {
      await login(email, password);
      router.push('/');
    } catch {
      // el error ya queda expuesto vía useAuth().error
    }
  };

  return (
    <AuthLayout
      logo={<BrandLogo variant="logotipo" height={32} />}
      title="QUIVO Control"
      subtitle="Panel administrativo"
    >
      <LoginForm
        onSubmit={handleSubmit}
        loading={loading}
        error={error ?? undefined}
        onForgotPasswordClick={() => setMostrarAyudaPassword(true)}
      />
      {/* Sin flujo de email (el proyecto no tiene proveedor configurado) — el reset lo hace
          un administrador QUIVO desde el panel (Usuarios), no algo self-service acá. */}
      {mostrarAyudaPassword && (
        <Alert variant="info" title="¿Olvidaste tu contraseña?" style={{ marginTop: '1rem' }}>
          Pedile a un administrador QUIVO que te la restablezca desde el panel (Usuarios).
        </Alert>
      )}
    </AuthLayout>
  );
}
