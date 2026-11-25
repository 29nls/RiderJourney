import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { currentAdmin } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const admin = await currentAdmin();
  if (admin) redirect('/');
  return (
    <main className="loginPage">
      <section className="loginPanel">
        <div className="brand loginBrand">
          <span className="brandMark">RJ</span>
          <span>
            <strong>RiderJourney</strong>
            <small>Konsol admin</small>
          </span>
        </div>
        <h1>Masuk dengan akun admin</h1>
        <p className="prose">
          Konsol ini hanya untuk staf yang terdaftar. Setelah masuk, tindakan sensitif tetap memerlukan
          kode authenticator.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
