'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';

type Props = {
  open: boolean;
  enrolled: boolean;
  onClose: () => void;
  onToken: (token: string) => void;
};

export function StepUpDialog({ open, enrolled, onClose, onToken }: Props) {
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'start' | 'enroll' | 'verify'>('start');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCode('');
    setError('');
    setStep(enrolled ? 'verify' : 'start');
  }, [open, enrolled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function beginEnrollment() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ secret: string; otpauthUri: string }>('mfa/enroll', { method: 'POST' });
      setSecret(result.secret);
      setOtpauthUri(result.otpauthUri);
      setStep('enroll');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.detail ?? cause.title : 'Pendaftaran MFA gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Masukkan 6 digit dari aplikasi authenticator.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (step === 'enroll') {
        await api('mfa/confirm', { method: 'POST', body: JSON.stringify({ code }) });
      }
      const result = await api<{ stepUpToken: string }>('mfa/step-up', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setSecret('');
      setOtpauthUri('');
      onToken(result.stepUpToken);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.detail ?? cause.title : 'Verifikasi MFA gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
        <div className="dialogHead">
          <div>
            <p className="kicker">Tindakan sensitif</p>
            <h2 id="stepup-title">{enrolled ? 'Verifikasi authenticator' : 'Aktifkan MFA admin'}</h2>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Tutup dialog">Tutup</button>
        </div>

        {step === 'start' && (
          <div className="stack">
            <p className="prose">
              Tindakan moderasi, konfigurasi, dan pemberian akses memerlukan kode dari aplikasi authenticator.
              MFA belum terdaftar untuk akun ini.
            </p>
            <button type="button" className="button primary" onClick={beginEnrollment} disabled={busy}>
              {busy ? 'Menyiapkan...' : 'Mulai pendaftaran authenticator'}
            </button>
          </div>
        )}

        {step === 'enroll' && (
          <div className="stack">
            <p className="prose">
              Masukkan secret ini ke aplikasi authenticator, lalu ketik kode 6 digit yang muncul. Secret hanya
              ditampilkan sekali.
            </p>
            <dl className="secretBox">
              <dt>Secret</dt>
              <dd><code>{secret}</code></dd>
              <dt>URI</dt>
              <dd><code className="break">{otpauthUri}</code></dd>
            </dl>
            <form onSubmit={submit} className="stack">
              <label className="field">
                <span>Kode authenticator</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
              </label>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? 'Memverifikasi...' : 'Konfirmasi dan verifikasi'}
              </button>
            </form>
          </div>
        )}

        {step === 'verify' && (
          <form onSubmit={submit} className="stack">
            <p className="prose">Kode berlaku sekitar 30 detik dan tidak dapat dipakai ulang untuk sesi lain.</p>
            <label className="field">
              <span>Kode authenticator</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
              />
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Memverifikasi...' : 'Verifikasi'}
            </button>
          </form>
        )}

        {error && <p className="formError" role="alert">{error}</p>}
      </div>
    </div>
  );
}
