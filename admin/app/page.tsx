import { redirect } from 'next/navigation';
import { AdminConsole } from '@/components/AdminConsole';
import { currentAdmin } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const admin = await currentAdmin();
  if (!admin) redirect('/login');
  return <AdminConsole admin={admin} />;
}
