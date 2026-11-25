'use client';

import { FormEvent, useState } from 'react';
import { formatDate, query } from '@/lib/client';
import type { AuditItem, ListResponse } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, Field, Loading, TableWrap } from '../ui';

export function AuditSection() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [applied, setApplied] = useState({ action: '', actor: '' });
  const list = useApi<ListResponse<AuditItem>>(`audit${query({ ...applied, limit: 100 })}`);

  function submit(event: FormEvent) {
    event.preventDefault();
    setApplied({ action: action.trim(), actor: actor.trim() });
  }

  return (
    <div className="pageStack">
      <form className="filterBar" onSubmit={submit}>
        <Field label="Aksi">
          <input value={action} onChange={(event) => setAction(event.target.value)} maxLength={80} />
        </Field>
        <Field label="Aktor">
          <input value={actor} onChange={(event) => setActor(event.target.value)} maxLength={120} />
        </Field>
        <button type="submit" className="button primary">Terapkan</button>
      </form>

      {list.loading && <Loading label="Memuat audit log..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && <EmptyState title="Tidak ada catatan audit pada filter ini." />}
      {list.data && list.data.items.length > 0 && (
        <TableWrap>
          <table>
            <caption className="srOnly">Audit tindakan admin</caption>
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Aktor</th>
                <th scope="col">Aksi</th>
                <th scope="col">Target</th>
                <th scope="col">Alasan</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.createdAt)}</td>
                  <td>{entry.actor}</td>
                  <td><code>{entry.action}</code></td>
                  <td>
                    {entry.targetType}
                    {entry.targetId && <span className="cellSub">{entry.targetId}</span>}
                  </td>
                  <td>{entry.reason}</td>
                  <td>
                    <details>
                      <summary>Lihat</summary>
                      <pre>{JSON.stringify({ before: entry.before, after: entry.after, requestId: entry.requestId }, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
