'use client';

import { useRouter } from 'next/navigation';
import { AuthLayout, LoginForm } from '@quivo/design-system';
import { BrandLogo } from '../../src/components/brand-logo';
import { useAuth } from '../../src/lib/auth/auth-context';

export default function LoginPage() {
  const { login, loading, error } = useAuth();
  const router = useRouter();

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
      <LoginForm onSubmit={handleSubmit} loading={loading} error={error ?? undefined} />
    </AuthLayout>
  );
}
