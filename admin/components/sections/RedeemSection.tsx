'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import type { ListResponse, RedeemItem, RunAction } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, StatusPill, TableWrap } from '../ui';

type CreatedCode = { id: string; code: string; codePrefix: string; rewardKind: string; quotaTotal: number };

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
  notify: (kind: 'ok' | 'error', message: string) => void;
};

export function RedeemSection({ runAction, can, notify }: Props) {
  const [kind, setKind] = useState<'points' | 'subscription_days' | 'poster_template'>('points');
  const [points, setPoints] = useState('100');
  const [planCode, setPlanCode] = useState('pro');
  const [days, setDays] = useState('30');
  const [template, setTemplate] = useState('first_light');
  const [quota, setQuota] = useState('10');
  const [expires, setExpires] = useState('');
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<CreatedCode | null>(null);
  const [selected, setSelected] = useState<RedeemItem | null>(null);
  const [disableReason, setDisableReason] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useApi<ListResponse<RedeemItem>>('redeem');

  async function create(event: FormEvent) {
    event.preventDefault();
    const rewardValue = kind === 'points'
      ? { points: Number(points) }
      : kind === 'subscription_days'
        ? { planCode, days: Number(days) }
        : { template };
    setBusy(true);
    const result = await runAction(
      (stepUp) => api<CreatedCode>('redeem', {
        method: 'POST',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({
          rewardKind: kind,
          rewardValue,
          quotaTotal: Number(quota),
          expiresAt: expires ? new Date(expires).toISOString() : undefined,
          reason,
        }),
      }),
      'Kode redeem dibuat.',
    );
    setBusy(false);
    if (result) {
      setCreated(result);
      setReason('');
      list.reload();
    }
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) => api(`redeem/${selected.id}/disable`, {
        method: 'POST',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ reason: disableReason }),
      }),
      'Kode dinonaktifkan.',
    );
    setBusy(false);
    if (result) {
      setSelected(null);
      setDisableReason('');
      list.reload();
    }
  }

  async function copyCode() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.code);
      notify('ok', 'Kode disalin ke clipboard.');
    } catch {
      notify('error', 'Clipboard tidak tersedia. Salin kode secara manual.');
    }
  }

  return (
    <div className="pageStack">
      {created && (
        <section className="codeBanner" aria-live="polite">
          <div>
            <p className="kicker">Kode dibuat, hanya ditampilkan sekali</p>
            <p className="redeemCode">{created.code}</p>
            <p className="listMeta">Reward {created.rewardKind} · kuota {created.quotaTotal} · prefix {created.codePrefix}</p>
          </div>
          <div className="ledeActions">
            <button type="button" className="button primary" onClick={copyCode}>Salin kode</button>
            <button type="button" className="button" onClick={() => setCreated(null)}>Selesai</button>
          </div>
        </section>
      )}

      {list.loading && <Loading label="Memuat kode redeem..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && <EmptyState title="Belum ada kode redeem." />}
      {list.data && list.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Daftar kode redeem</caption>
            <thead>
              <tr>
                <th scope="col">Prefix</th>
                <th scope="col">Reward</th>
                <th scope="col">Terpakai</th>
                <th scope="col">Kedaluwarsa</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="srOnly">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((item) => (
                <tr key={item.id} className={selected?.id === item.id ? 'selectedRow' : undefined}>
                  <td><code>{item.codePrefix}</code></td>
                  <td>
                    {item.rewardKind}
                    <span className="cellSub">{JSON.stringify(item.rewardValue)}</span>
                  </td>
                  <td>{item.quotaUsed} / {item.quotaTotal}</td>
                  <td>{formatDate(item.expiresAt)}</td>
                  <td><StatusPill value={item.active ? 'active' : 'disabled'} /></td>
                  <td>
                    {can('redeem.manage') && item.active && (
                      <button type="button" className="linkButton" onClick={() => { setSelected(item); setDisableReason(''); }}>
                        Nonaktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {can('redeem.manage') && (
        <div className="twoColumn">
          <ActionForm title="Buat kode redeem">
            <form className="stack" onSubmit={create}>
              <Field label="Jenis reward">
                <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                  <option value="points">Poin</option>
                  <option value="subscription_days">Hari langganan</option>
                  <option value="poster_template">Template poster</option>
                </select>
              </Field>
              {kind === 'points' && (
                <Field label="Jumlah poin">
                  <input type="number" value={points} onChange={(event) => setPoints(event.target.value)} min={1} max={1000000} required />
                </Field>
              )}
              {kind === 'subscription_days' && (
                <div className="fieldRow">
                  <Field label="Paket">
                    <input value={planCode} onChange={(event) => setPlanCode(event.target.value)} required />
                  </Field>
                  <Field label="Hari">
                    <input type="number" value={days} onChange={(event) => setDays(event.target.value)} min={1} max={3650} required />
                  </Field>
                </div>
              )}
              {kind === 'poster_template' && (
                <Field label="Template">
                  <select value={template} onChange={(event) => setTemplate(event.target.value)}>
                    <option value="first_light">first_light</option>
                    <option value="peloton_lines">peloton_lines</option>
                    <option value="night_odometer">night_odometer</option>
                  </select>
                </Field>
              )}
              <div className="fieldRow">
                <Field label="Kuota pemakaian">
                  <input type="number" value={quota} onChange={(event) => setQuota(event.target.value)} min={1} max={100000} required />
                </Field>
                <Field label="Kedaluwarsa (opsional)">
                  <input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} />
                </Field>
              </div>
              <Field label="Alasan pembuatan" hint="Wajib dan tersimpan di audit log.">
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
              </Field>
              <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
                {busy ? 'Membuat...' : 'Buat kode'}
              </button>
            </form>
          </ActionForm>

          <div className="notesPanel">
            <h2>Aturan redeem</h2>
            <ul className="plainList">
              <li>Kode disimpan sebagai HMAC, bukan teks biasa. Kode asli hanya tampil setelah dibuat.</li>
              <li>Satu kode hanya dapat dipakai sekali per akun, dengan idempotency key dari klien.</li>
              <li>Kuota dikunci di transaksi, sehingga dua permintaan bersamaan tidak bisa melampaui kuota.</li>
              <li>Poin masuk ke ledger immutable dengan referensi redeem.</li>
            </ul>
          </div>
        </div>
      )}

      {selected && (
        <ActionForm title={`Nonaktifkan kode ${selected.codePrefix}`} onCancel={() => setSelected(null)}>
          <form className="stack" onSubmit={disable}>
            <Field label="Alasan" hint="Kode yang dinonaktifkan tidak bisa dipakai lagi.">
              <textarea value={disableReason} onChange={(event) => setDisableReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
            </Field>
            <button type="submit" className="button primary" disabled={busy || disableReason.trim().length < 3}>
              {busy ? 'Menyimpan...' : 'Nonaktifkan kode'}
            </button>
          </form>
        </ActionForm>
      )}
    </div>
  );
}
