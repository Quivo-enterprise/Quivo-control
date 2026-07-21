'use client';

import { useRouter } from 'next/navigation';
import { AuthLayout, LoginForm } from '@quivo/design-system';
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
    <AuthLayout title="QUIVO Control" subtitle="Panel administrativo">
      <LoginForm onSubmit={handleSubmit} loading={loading} error={error ?? undefined} />
    </AuthLayout>
  );
}
