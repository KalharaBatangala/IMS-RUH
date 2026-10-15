import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

// Server-side guard for every dashboard page: the session must still match an active,
// approved user with the same session version (role/status changes log people out).
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    // Clears the stale cookie first so proxy.ts does not bounce /login back here.
    redirect('/api/auth/logout');
  }
  return <>{children}</>;
}
