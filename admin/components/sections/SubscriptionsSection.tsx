'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate, query } from '@/lib/client';
import type { ListResponse, RunAction, SubscriptionItem } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, StatusPill, TableWrap } from '../ui';

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

export function SubscriptionsSection({ runAction, can }: Props) {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<SubscriptionItem | null>(null);
  const [userId, setUserId] = useState('');
  const [planCode, setPlanCode] = useState('pro');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useApi<ListResponse<SubscriptionItem>>(`subscriptions${query({ status, limit: 50 })}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const target = selected?.id ?? userId;
    const result = await runAction(
      (stepUp) => api('subscriptions/grant', {
        method: 'POST',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ userId: target, planCode, days: Number(days), reason }),
      }),
      'Akses manual diberikan.',
    );
    setBusy(false);
    if (result) {
      setReason('');
      setSelected(null);
      list.reload();
    }
  }

  return (
    <div className="pageStack">
      <div className="filterBar">
        <Field label="Status langganan">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="in_grace">Masa tenggang</option>
            <option value="canceled">Dibatalkan</option>
            <option value="paused">Dijeda</option>
            <option value="expired">Kedaluwarsa</option>
          </select>
        </Field>
        <p className="filterNote">
          Status Play Billing diverifikasi ulang dari provider. Pemberian manual hanya untuk dukungan dan
          membutuhkan fitur berbayar yang sudah diaktifkan.
        </p>
      </div>

      {list.loading && <Loading label="Memuat langganan..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && <EmptyState title="Belum ada langganan pada filter ini." />}
      {list.data && list.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Daftar langganan pengguna</caption>
            <thead>
              <tr>
                <th scope="col">Pengguna</th>
                <th scope="col">Paket</th>
                <th scope="col">Sumber</th>
                <th scope="col">Status</th>
                <th scope="col">Berakhir</th>
                <th scope="col">Verifikasi terakhir</th>
                <th scope="col"><span className="srOnly">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((subscription) => (
                <tr key={subscription.id} className={selected?.id === subscription.id ? 'selectedRow' : undefined}>
                  <td>
                    <strong>{subscription.username}</strong>
                    <span className="cellSub">{subscription.email}</span>
                  </td>
                  <td>{subscription.planCode}</td>
                  <td>{subscription.provider === 'google_play' ? 'Google Play' : 'Manual'}</td>
                  <td><StatusPill value={subscription.status} /></td>
                  <td>{formatDate(subscription.expiresAt)}</td>
                  <td>{formatDate(subscription.lastVerifiedAt)}</td>
                  <td>
                    {can('subscriptions.manage') && (
                      <button type="button" className="linkButton" onClick={() => {
                        setSelected(subscription);
                        setUserId('');
                        setPlanCode(subscription.planCode === 'free' ? 'pro' : subscription.planCode);
                        setReason('');
                      }}>
                        Beri akses
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {can('subscriptions.manage') && (
        <ActionForm title={selected ? `Beri akses untuk ${selected.username}` : 'Beri akses manual'} onCancel={() => setSelected(null)}>
          <form className="stack" onSubmit={submit}>
            {!selected && (
              <Field label="ID pengguna" hint="UUID akun dari halaman Pengguna.">
                <input value={userId} onChange={(event) => setUserId(event.target.value)} required minLength={36} maxLength={36} />
              </Field>
            )}
            {selected && <input type="hidden" value={selected.id} readOnly />}
            <div className="fieldRow">
              <Field label="Paket">
                <input value={planCode} onChange={(event) => setPlanCode(event.target.value)} required />
              </Field>
              <Field label="Durasi (hari)">
                <input type="number" value={days} onChange={(event) => setDays(event.target.value)} min={1} max={3650} required />
              </Field>
            </div>
            <Field label="Alasan" hint="Wajib. Tersimpan di audit log bersama paket dan durasi.">
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
            </Field>
            {selected && (
              <p className="notice">
                ID pengguna: <code>{selected.id}</code>
              </p>
            )}
            <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3 || (!selected && userId.length !== 36)}>
              {busy ? 'Menyimpan...' : 'Berikan akses'}
            </button>
          </form>
        </ActionForm>
      )}

      {!can('subscriptions.manage') && (
        <p className="notice">Peran Anda hanya dapat membaca data langganan.</p>
      )}
    </div>
  );
}
