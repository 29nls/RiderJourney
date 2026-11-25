'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate, query, shortId } from '@/lib/client';
import type { ListResponse, RunAction, UserListItem } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, StatusPill, TableWrap } from '../ui';

type Detail = {
  user: UserListItem & { bio: string | null; city: string | null; emailVerified: boolean };
  counts: { vehicles: number; posts: number; reports: number };
  subscription: {
    items: Array<{ planCode: string; status: string; expiresAt: string | null }>;
    entitlements: { planCode: string; convoyCapacity: number };
  } | null;
  deletion: { id: string; status: string; execute_after: string } | null;
};

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

export function UsersSection({ runAction, can }: Props) {
  const [draftQuery, setDraftQuery] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState('suspended');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useApi<ListResponse<UserListItem>>(`users${query({ q: applied.q, status: applied.status, limit: 50 })}`);
  const detail = useApi<Detail>(selected ? `users/${selected}` : null);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setApplied({ q: draftQuery.trim(), status });
    setSelected(null);
  }

  async function submitStatus(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) => api(`users/${selected}/status`, {
        method: 'PATCH',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ status: nextStatus, reason }),
      }),
      'Status pengguna diperbarui.',
    );
    setBusy(false);
    if (result) {
      setReason('');
      list.reload();
      detail.reload();
    }
  }

  return (
    <div className="pageStack">
      <form className="filterBar" onSubmit={applyFilters} role="search">
        <Field label="Cari akun">
          <input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="suspended">Dibatasi</option>
            <option value="deletion_pending">Menunggu penghapusan</option>
            <option value="deleted">Dihapus</option>
          </select>
        </Field>
        <button type="submit" className="button primary">Terapkan</button>
      </form>

      {list.loading && <Loading label="Memuat daftar akun..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState title="Tidak ada akun yang cocok. Ubah kata kunci atau status." />
      )}
      {list.data && list.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Daftar akun pengguna</caption>
            <thead>
              <tr>
                <th scope="col">Akun</th>
                <th scope="col">Status</th>
                <th scope="col">Paket</th>
                <th scope="col">Peran</th>
                <th scope="col">Dibuat</th>
                <th scope="col"><span className="srOnly">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((user) => (
                <tr key={user.id} className={selected === user.id ? 'selectedRow' : undefined}>
                  <td>
                    <strong>{user.username}</strong>
                    <span className="cellSub">{user.email}</span>
                  </td>
                  <td><StatusPill value={user.status} /></td>
                  <td>{user.planCode}</td>
                  <td>{user.role ?? 'pengguna'}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <button type="button" className="linkButton" onClick={() => setSelected(user.id)}>
                      Buka
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {selected && (
        <section className="detailPanel" aria-live="polite">
          {detail.loading && <Loading label="Memuat detail akun..." />}
          {detail.error && <ErrorState error={detail.error} onRetry={detail.reload} />}
          {detail.data && (
            <>
              <div className="detailHead">
                <div>
                  <p className="kicker">Akun {shortId(detail.data.user.id)}</p>
                  <h2>{detail.data.user.displayName}</h2>
                  <p className="listMeta">{detail.data.user.email} · @{detail.data.user.username}</p>
                </div>
                <button type="button" className="linkButton" onClick={() => setSelected(null)}>Tutup</button>
              </div>
              <dl className="factGrid">
                <div><dt>Status</dt><dd><StatusPill value={detail.data.user.status} /></dd></div>
                <div><dt>Paket</dt><dd>{detail.data.subscription?.items[0]?.planCode ?? 'free'}</dd></div>
                <div><dt>Kendaraan</dt><dd>{detail.data.counts.vehicles}</dd></div>
                <div><dt>Post</dt><dd>{detail.data.counts.posts}</dd></div>
                <div><dt>Laporan diterima</dt><dd>{detail.data.counts.reports}</dd></div>
                <div><dt>Email terverifikasi</dt><dd>{detail.data.user.emailVerified ? 'Ya' : 'Belum'}</dd></div>
              </dl>
              {detail.data.deletion && (
                <p className="notice">
                  Penghapusan akun berstatus {detail.data.deletion.status}, dijadwalkan {formatDate(detail.data.deletion.execute_after)}.
                </p>
              )}
              {can('users.suspend') ? (
                <ActionForm title="Ubah status akun" onCancel={() => setReason('')}>
                  <form className="stack" onSubmit={submitStatus}>
                    <Field label="Status baru">
                      <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                        <option value="suspended">Batasi akses</option>
                        <option value="active">Pulihkan akses</option>
                      </select>
                    </Field>
                    <Field label="Alasan" hint="Wajib, minimal 3 karakter. Alasan tersimpan di audit log.">
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
                    </Field>
                    <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
                      {busy ? 'Menyimpan...' : 'Simpan status'}
                    </button>
                  </form>
                </ActionForm>
              ) : (
                <p className="notice">Peran Anda dapat melihat akun, tetapi tidak dapat mengubah statusnya.</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
