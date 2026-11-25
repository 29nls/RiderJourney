'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate, query, shortId } from '@/lib/client';
import type { ListResponse, ReportItem, RunAction } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, StatusPill, TableWrap } from '../ui';

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

export function ReportsSection({ runAction, can }: Props) {
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState<ReportItem | null>(null);
  const [resolution, setResolution] = useState('actioned');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useApi<ListResponse<ReportItem>>(`reports${query({ status, limit: 50 })}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) => api(`reports/${selected.id}`, {
        method: 'PATCH',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ status: resolution, reason }),
      }),
      'Laporan diperbarui.',
    );
    setBusy(false);
    if (result) {
      setSelected(null);
      setReason('');
      list.reload();
    }
  }

  return (
    <div className="pageStack">
      <div className="filterBar">
        <Field label="Status laporan">
          <select value={status} onChange={(event) => { setStatus(event.target.value); setSelected(null); }}>
            <option value="pending">Menunggu</option>
            <option value="reviewed">Ditinjau</option>
            <option value="actioned">Ditindak</option>
            <option value="dismissed">Ditolak</option>
            <option value="">Semua</option>
          </select>
        </Field>
        <p className="filterNote">Laporan diurutkan dari yang terbaru. Tindakan wajib memiliki alasan.</p>
      </div>

      {list.loading && <Loading label="Memuat laporan..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={`Tidak ada laporan berstatus ${status || 'apa pun'}.`} />
      )}
      {list.data && list.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Antrean laporan konten</caption>
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Alasan</th>
                <th scope="col">Pelapor</th>
                <th scope="col">Status</th>
                <th scope="col">Masuk</th>
                <th scope="col"><span className="srOnly">Tindakan</span></th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((report) => (
                <tr key={report.id} className={selected?.id === report.id ? 'selectedRow' : undefined}>
                  <td>
                    <strong>{report.targetType}</strong>
                    <span className="cellSub">{shortId(report.targetId)}</span>
                  </td>
                  <td>
                    {report.reason}
                    {report.detail && <span className="cellSub">{report.detail}</span>}
                  </td>
                  <td>{report.reporter}</td>
                  <td><StatusPill value={report.status} /></td>
                  <td>{formatDate(report.createdAt)}</td>
                  <td>
                    <button type="button" className="linkButton" onClick={() => {
                      setSelected(report);
                      setResolution(report.status === 'pending' ? 'actioned' : report.status);
                      setReason(report.resolutionNote ?? '');
                    }}>
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
        <section className="detailPanel" aria-live="polite">
          <div className="detailHead">
            <div>
              <p className="kicker">Laporan {shortId(selected.id)}</p>
              <h2>{selected.targetType} · {selected.reason}</h2>
              <p className="listMeta">Pelapor {selected.reporter}, masuk {formatDate(selected.createdAt)}</p>
            </div>
            <button type="button" className="linkButton" onClick={() => setSelected(null)}>Tutup</button>
          </div>
          {selected.note && <p className="notice">Catatan pelapor: {selected.note}</p>}
          {can('reports.act') ? (
            <ActionForm title="Putuskan laporan" onCancel={() => setSelected(null)}>
              <form className="stack" onSubmit={submit}>
                <Field label="Status keputusan">
                  <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                    <option value="actioned">Ditindak</option>
                    <option value="reviewed">Ditinjau, tanpa tindakan</option>
                    <option value="dismissed">Ditolak</option>
                  </select>
                </Field>
                <Field label="Alasan keputusan" hint="Tersimpan permanen di audit log.">
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
                </Field>
                <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
                  {busy ? 'Menyimpan...' : 'Simpan keputusan'}
                </button>
              </form>
            </ActionForm>
          ) : (
            <p className="notice">Peran Anda hanya dapat membaca laporan.</p>
          )}
        </section>
      )}
    </div>
  );
}
