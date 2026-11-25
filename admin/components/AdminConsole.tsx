'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/client';
import type { AdminSession, RunAction, SectionId } from '@/lib/types';
import { StepUpDialog } from './StepUpDialog';
import { Dashboard } from './sections/Dashboard';
import { UsersSection } from './sections/UsersSection';
import { ReportsSection } from './sections/ReportsSection';
import { ModerationSection } from './sections/ModerationSection';
import { SubscriptionsSection } from './sections/SubscriptionsSection';
import { RedeemSection } from './sections/RedeemSection';
import { ConfigSection } from './sections/ConfigSection';
import { AuditSection } from './sections/AuditSection';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  group: string;
  permission?: string;
}> = [
  { id: 'ringkasan', label: 'Ringkasan', group: 'Operasi' },
  { id: 'pengguna', label: 'Pengguna', group: 'Operasi', permission: 'users.read' },
  { id: 'laporan', label: 'Laporan', group: 'Operasi', permission: 'reports.read' },
  { id: 'moderasi', label: 'Moderasi', group: 'Operasi', permission: 'posts.read' },
  { id: 'langganan', label: 'Langganan', group: 'Komersial', permission: 'subscriptions.read' },
  { id: 'redeem', label: 'Redeem', group: 'Komersial', permission: 'redeem.manage' },
  { id: 'konfigurasi', label: 'Konfigurasi', group: 'Sistem', permission: 'config.read' },
  { id: 'audit', label: 'Audit log', group: 'Sistem', permission: 'audit.read' },
];

const TITLES: Record<SectionId, { title: string; note: string }> = {
  ringkasan: { title: 'Ringkasan operasi', note: 'Antrean yang perlu keputusan, bukan angka pajangan.' },
  pengguna: { title: 'Pengguna', note: 'Cari akun, periksa status, dan batasi akses dengan alasan.' },
  laporan: { title: 'Laporan konten', note: 'Tinjau laporan dan simpan keputusan yang dapat diaudit.' },
  moderasi: { title: 'Moderasi konten', note: 'Post dan komunitas yang membutuhkan tindakan.' },
  langganan: { title: 'Langganan', note: 'Status dari provider dan pemberian akses manual.' },
  redeem: { title: 'Kode redeem', note: 'Buat, pantau kuota, dan nonaktifkan kode.' },
  konfigurasi: { title: 'Konfigurasi server', note: 'Kill switch dan kebijakan yang dibaca backend.' },
  audit: { title: 'Audit log', note: 'Setiap tindakan admin, lengkap dengan nilai sebelum dan sesudah.' },
};

const ROLE_LABEL: Record<AdminSession['role'], string> = {
  support: 'Support',
  moderator: 'Moderator',
  admin: 'Admin',
  superadmin: 'Superadmin',
};

type Toast = { kind: 'ok' | 'error'; message: string } | null;

export function AdminConsole({ admin }: { admin: AdminSession }) {
  const [section, setSection] = useState<SectionId>('ringkasan');
  const [mfaEnrolled, setMfaEnrolled] = useState(admin.mfa.enrolled);
  const [stepUpToken, setStepUpToken] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const pending = useRef<{ resolve: (token: string) => void; reject: (error: Error) => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowed = useCallback(
    (permission: string) => admin.role === 'superadmin' || admin.permissions.includes(permission),
    [admin],
  );

  useEffect(() => {
    const stored = sessionStorage.getItem('rj_admin_step_up');
    if (stored) setStepUpToken(stored);
    const hash = window.location.hash.replace('#', '') as SectionId;
    const match = SECTIONS.find((entry) => entry.id === hash && (!entry.permission || allowed(entry.permission)));
    if (match) setSection(match.id);
  }, [allowed]);

  const notify = useCallback((kind: 'ok' | 'error', message: string) => {
    setToast({ kind, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const openSection = (next: SectionId) => {
    setSection(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  const requestStepUp = useCallback(() => new Promise<string>((resolve, reject) => {
    pending.current = { resolve, reject };
    setStepUpOpen(true);
  }), []);

  const finishStepUp = (token: string) => {
    sessionStorage.setItem('rj_admin_step_up', token);
    setStepUpToken(token);
    setMfaEnrolled(true);
    setStepUpOpen(false);
    pending.current?.resolve(token);
    pending.current = null;
  };

  const closeStepUp = () => {
    setStepUpOpen(false);
    pending.current?.reject(new Error('STEP_UP_CANCELLED'));
    pending.current = null;
  };

  const runAction: RunAction = useCallback(async (action, success) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const token = stepUpToken ?? await requestStepUp();
        const result = await action(token);
        notify('ok', success ?? 'Perubahan disimpan.');
        return result;
      } catch (cause) {
        if (cause instanceof ApiError && (cause.code === 'STEP_UP_REQUIRED' || cause.code === 'STEP_UP_INVALID') && attempt === 0) {
          sessionStorage.removeItem('rj_admin_step_up');
          setStepUpToken(null);
          continue;
        }
        if (cause instanceof Error && cause.message === 'STEP_UP_CANCELLED') return null;
        notify('error', cause instanceof ApiError ? cause.detail ?? cause.title : 'Perubahan gagal disimpan.');
        return null;
      }
    }
    return null;
  }, [notify, requestStepUp, stepUpToken]);

  async function logout() {
    await fetch('/api/session', { method: 'DELETE' });
    window.location.assign('/login');
  }

  const visible = SECTIONS.filter((entry) => !entry.permission || allowed(entry.permission));
  const groups = [...new Set(visible.map((entry) => entry.group))];
  const meta = TITLES[section];

  return (
    <div className="appShell">
      <aside className="rail">
        <div className="brand">
          <span className="brandMark">RJ</span>
          <span>
            <strong>RiderJourney</strong>
            <small>Konsol admin</small>
          </span>
        </div>
        <nav className="nav" aria-label="Bagian konsol admin">
          {groups.map((group) => (
            <div className="navGroup" key={group}>
              <p className="navLabel">{group}</p>
              {visible.filter((entry) => entry.group === group).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={section === entry.id ? 'navItem active' : 'navItem'}
                  aria-current={section === entry.id ? 'page' : undefined}
                  onClick={() => openSection(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="railFoot">
          <p className="navLabel">Sesi</p>
          <p className="railIdentity">{ROLE_LABEL[admin.role]}</p>
          <p className="railMeta">API terhubung</p>
        </div>
      </aside>

      <div className="mainColumn">
        <header className="topbar">
          <div>
            <p className="kicker">Konsol admin</p>
            <h1>{meta.title}</h1>
            <p className="pageNote">{meta.note}</p>
          </div>
          <div className="topActions">
            <button
              type="button"
              className={mfaEnrolled ? 'mfaState enrolled' : 'mfaState pending'}
              onClick={() => setStepUpOpen(true)}
            >
              {mfaEnrolled ? 'MFA aktif' : 'MFA belum aktif'}
            </button>
            <button type="button" className="button" onClick={logout}>Keluar</button>
          </div>
        </header>

        <main className="content" id="main">
          {section === 'ringkasan' && <Dashboard onOpen={openSection} can={allowed} />}
          {section === 'pengguna' && <UsersSection runAction={runAction} can={allowed} />}
          {section === 'laporan' && <ReportsSection runAction={runAction} can={allowed} />}
          {section === 'moderasi' && <ModerationSection runAction={runAction} can={allowed} />}
          {section === 'langganan' && <SubscriptionsSection runAction={runAction} can={allowed} />}
          {section === 'redeem' && <RedeemSection runAction={runAction} can={allowed} notify={notify} />}
          {section === 'konfigurasi' && <ConfigSection runAction={runAction} can={allowed} />}
          {section === 'audit' && <AuditSection />}
        </main>
      </div>

      <StepUpDialog open={stepUpOpen} enrolled={mfaEnrolled} onClose={closeStepUp} onToken={finishStepUp} />

      {toast && (
        <div className={toast.kind === 'ok' ? 'toast ok' : 'toast bad'} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
