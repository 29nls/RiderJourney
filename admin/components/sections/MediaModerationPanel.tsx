'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate, shortId } from '@/lib/client';
import type { RunAction } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, Panel, StatusPill, TableWrap } from '../ui';

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

type MediaItem = {
  id: string;
  ownerId: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  scanStatus: string;
  moderationStatus: string;
  moderationReason: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewerId: string | null;
  createdAt: string;
};

type MediaQueue = {
  items: MediaItem[];
  nextCursor: string | null;
  summary: { pendingReview: number; approved: number; rejected: number; hidden: number; notRequired: number };
};

type MediaHistory = {
  items: Array<{
    id: string;
    actorId: string | null;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
};

type MediaPreview = { url: string; mimeType: string; sizeBytes: number; scanStatus: string; expiresInSeconds: number };

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Menunggu tinjauan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  hidden: 'Disembunyikan',
  not_required: 'Tidak perlu moderasi',
};

/**
 * The review queue is a policy tool, not a malware tool: the scan column is
 * shown but only ever changes through the scan worker. The preview comes from
 * an admin endpoint that refuses to mint a URL for media the scanner has not
 * cleared.
 */
export function MediaModerationPanel({ runAction, can }: Props) {
  const [status, setStatus] = useState('pending_review');
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [action, setAction] = useState<'approve' | 'reject' | 'hide'>('approve');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const queue = useApi<MediaQueue>(`media/moderation?status=${status}&limit=50`);
  const preview = useApi<MediaPreview>(selected ? `media/moderation/${selected.id}/preview` : null);
  const history = useApi<MediaHistory>(selected ? `media/moderation/${selected.id}/history` : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) =>
        api(`media/moderation/${selected.id}/decision`, {
          method: 'POST',
          headers: { 'X-Step-Up-Token': stepUp },
          body: JSON.stringify({ action, reason: reason.trim() || undefined }),
        }),
      'Keputusan moderasi media disimpan.',
    );
    setBusy(false);
    if (result) {
      setSelected(null);
      setReason('');
      queue.reload();
    }
  }

  return (
    <div className="pageStack">
      <div className="filterBar">
        <Field label="Status moderasi">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSelected(null);
            }}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      {queue.data && (
        <p className="listMeta">
          {queue.data.summary.pendingReview} menunggu tinjauan · {queue.data.summary.approved} disetujui ·{' '}
          {queue.data.summary.rejected} ditolak · {queue.data.summary.hidden} disembunyikan
        </p>
      )}
      {queue.loading && <Loading label="Memuat antrean media..." />}
      {queue.error && <ErrorState error={queue.error} onRetry={queue.reload} />}
      {queue.data?.items.length === 0 && <EmptyState title="Tidak ada media pada filter ini." />}

      {queue.data && queue.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Antrean moderasi media</caption>
            <thead>
              <tr>
                <th scope="col">Media</th>
                <th scope="col">Pemilik</th>
                <th scope="col">Pemindaian</th>
                <th scope="col">Moderasi</th>
                <th scope="col">Diminta</th>
                <th scope="col"><span className="srOnly">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {queue.data.items.map((item) => (
                <tr key={item.id} className={selected?.id === item.id ? 'selectedRow' : undefined}>
                  <td>
                    <strong>{item.purpose}</strong>
                    <span className="cellSub">{shortId(item.id)} · {(item.sizeBytes / 1024).toFixed(0)} KB</span>
                  </td>
                  <td>{shortId(item.ownerId)}</td>
                  <td><StatusPill value={item.scanStatus} /></td>
                  <td><StatusPill value={item.moderationStatus} /></td>
                  <td>{item.requestedAt ? formatDate(item.requestedAt) : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="linkButton"
                      onClick={() => {
                        setSelected(item);
                        setAction(item.moderationStatus === 'approved' ? 'reject' : 'approve');
                        setReason('');
                      }}
                    >
                      Tinjau
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {selected && (
        <section className="detailPanel">
          <div className="detailHead">
            <div>
              <p className="kicker">Media {shortId(selected.id)}</p>
              <h2>{selected.purpose}</h2>
              <p className="listMeta">
                Pemindaian {selected.scanStatus} · moderasi {selected.moderationStatus}
              </p>
            </div>
            <button type="button" className="linkButton" onClick={() => setSelected(null)}>Tutup</button>
          </div>

          {preview.loading && <Loading label="Menyiapkan pratinjau..." />}
          {preview.error && (
            <p className="notice">
              Pratinjau tidak tersedia: {preview.error.detail ?? preview.error.title}. Media yang belum lolos
              pemindaian tidak pernah disajikan, termasuk kepada admin.
            </p>
          )}
          {preview.data && (
            preview.data.mimeType.startsWith('video/') ? (
              <video className="previewMedia" src={preview.data.url} controls preload="none" />
            ) : (
              <img
                className="previewMedia"
                src={preview.data.url}
                alt={`Pratinjau media ${shortId(selected.id)}`}
              />
            )
          )}

          {can('media.moderate') ? (
            <ActionForm title="Keputusan moderasi" onCancel={() => setSelected(null)}>
              <form className="stack" onSubmit={submit}>
                <Field label="Tindakan">
                  <select
                    value={action}
                    onChange={(event) => setAction(event.target.value as 'approve' | 'reject' | 'hide')}
                  >
                    <option value="approve">Setujui</option>
                    <option value="reject">Tolak</option>
                    <option value="hide">Sembunyikan</option>
                  </select>
                </Field>
                <Field label="Alasan" hint="Wajib untuk menolak atau menyembunyikan; tersimpan di audit log.">
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    required={action !== 'approve'}
                  />
                </Field>
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || (action !== 'approve' && reason.trim().length < 3)}
                >
                  {busy ? 'Menyimpan...' : 'Simpan keputusan'}
                </button>
              </form>
            </ActionForm>
          ) : (
            <p className="notice">Peran Anda tidak memiliki izin moderasi media.</p>
          )}

          <Panel title="Riwayat moderasi">
            {history.loading && <Loading label="Memuat riwayat..." />}
            {history.data?.items.length === 0 && <EmptyState title="Belum ada riwayat." />}
            {history.data && history.data.items.length > 0 && (
              <ul className="timeline">
                {history.data.items.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.action}</strong> — {entry.fromStatus ?? '—'} → {entry.toStatus}
                    <span className="cellSub">
                      {formatDate(entry.createdAt)}
                      {entry.actorId ? ` · ${shortId(entry.actorId)}` : ' · sistem'}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}
    </div>
  );
}
