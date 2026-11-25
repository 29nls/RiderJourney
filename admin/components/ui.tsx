'use client';

import type { ReactNode } from 'react';
import { ApiError } from '@/lib/client';

export function StatusPill({ value }: { value: string }) {
  const tone = /active|published|visible|ready|succeeded|verified|restored/i.test(value)
    ? 'ok'
    : /pending|queued|in_grace|paused|on_hold|reviewing/i.test(value)
      ? 'wait'
      : /suspended|hidden|removed|expired|failed|cancelled|deleted|rejected/i.test(value)
        ? 'bad'
        : 'neutral';
  return <span className={`status ${tone}`}>{value}</span>;
}

export function Loading({ label }: { label: string }) {
  return <p className="stateLine" role="status">{label}</p>;
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="stateBox" role="alert">
      <p><strong>{error.title}</strong></p>
      <p>{error.detail ?? 'Permintaan tidak dapat diselesaikan.'}</p>
      {onRetry && <button type="button" className="button" onClick={onRetry}>Coba lagi</button>}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="stateBox">
      <p><strong>{title}</strong></p>
      {action}
    </div>
  );
}

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panelHead">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function ActionForm({ title, children, onCancel }: { title: string; children: ReactNode; onCancel?: () => void }) {
  return (
    <div className="actionBox">
      <div className="actionHead">
        <h3>{title}</h3>
        {onCancel && <button type="button" className="linkButton" onClick={onCancel}>Tutup</button>}
      </div>
      {children}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="tableWrap">{children}</div>;
}
