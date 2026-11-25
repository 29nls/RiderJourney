'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, formatDate } from '@/lib/client';
import type { ConfigItem, ListResponse, RunAction } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, Field, Loading } from '../ui';

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

export function ConfigSection({ runAction, can }: Props) {
  const list = useApi<ListResponse<ConfigItem>>('config');
  const [selected, setSelected] = useState<ConfigItem | null>(null);
  const [json, setJson] = useState('');
  const [reason, setReason] = useState('');
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected) {
      setJson(JSON.stringify(selected.value, null, 2));
      setReason('');
      setParseError('');
    }
  }, [selected]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Nilai harus objek JSON.');
      value = parsed as Record<string, unknown>;
      setParseError('');
    } catch (cause) {
      setParseError(cause instanceof Error ? cause.message : 'JSON tidak valid.');
      return;
    }
    setBusy(true);
    const result = await runAction(
      (stepUp) => api('config', {
        method: 'PUT',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ key: selected.key, value, reason }),
      }),
      'Konfigurasi disimpan.',
    );
    setBusy(false);
    if (result) {
      setSelected(null);
      list.reload();
    }
  }

  return (
    <div className="pageStack">
      <p className="notice">
        Perubahan di sini hanya berlaku bila kill switch deployment juga aktif. Fitur berbayar memerlukan
        <code> PAID_FEATURES_ENABLED=true </code> di server dan nilai konfigurasi ini. Jangan aktifkan sebelum
        kebijakan, syarat layanan, dan produk Play siap.
      </p>

      {list.loading && <Loading label="Memuat konfigurasi..." />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.items.length === 0 && <EmptyState title="Belum ada konfigurasi server." />}
      <div className="configGrid">
        {list.data?.items.map((item) => (
          <article className="configCard" key={item.key}>
            <div>
              <h2>{item.key}</h2>
              <p className="listMeta">Diubah {formatDate(item.updatedAt)}{item.updatedBy ? ` oleh ${item.updatedBy}` : ''}</p>
            </div>
            <pre>{JSON.stringify(item.value, null, 2)}</pre>
            {can('config.write') && (
              <button type="button" className="button" onClick={() => setSelected(item)}>Ubah</button>
            )}
          </article>
        ))}
      </div>

      {selected && (
        <section className="detailPanel">
          <div className="detailHead">
            <div>
              <p className="kicker">Konfigurasi {selected.key}</p>
              <h2>Ubah nilai</h2>
            </div>
            <button type="button" className="linkButton" onClick={() => setSelected(null)}>Tutup</button>
          </div>
          <form className="stack" onSubmit={submit}>
            <Field label="Nilai JSON" hint="Struktur divalidasi server. Kunci selain features, app_version, dan retention ditolak.">
              <textarea className="codeInput" value={json} onChange={(event) => setJson(event.target.value)} rows={10} spellCheck={false} required />
            </Field>
            {parseError && <p className="formError" role="alert">{parseError}</p>}
            <Field label="Alasan perubahan" hint="Wajib, tersimpan dengan nilai sebelum dan sesudah.">
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
            </Field>
            <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
              {busy ? 'Menyimpan...' : 'Simpan konfigurasi'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
