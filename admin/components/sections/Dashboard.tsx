'use client';

import { formatBytes, formatDate } from '@/lib/client';
import type { AuditItem, DashboardData, ListResponse, ReportItem, SectionId } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { EmptyState, ErrorState, Loading, Panel } from '../ui';

type Props = {
  onOpen: (section: SectionId) => void;
  can: (permission: string) => boolean;
};

export function Dashboard({ onOpen, can }: Props) {
  const summary = useApi<DashboardData>('dashboard');
  const reports = useApi<ListResponse<ReportItem>>('reports?status=pending&limit=6');
  const audit = useApi<ListResponse<AuditItem>>('audit?limit=6');

  const data = summary.data;
  return (
    <div className="pageStack">
      <section className="lede">
        <p className="kicker">Antrean hari ini</p>
        {summary.loading && <Loading label="Menghitung antrean..." />}
        {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
        {data && (
          <>
            <p className="ledeSentence">
              <strong>{data.pendingReports}</strong> laporan menunggu tinjauan,
              <strong> {data.suspendedUsers}</strong> akun dibatasi,
              <strong> {data.adminActions24h}</strong> tindakan admin tercatat dalam 24 jam terakhir.
            </p>
            <p className="ledeMeta">
              {data.activeUsers} akun aktif · {data.communities} komunitas · {data.posts} post terbit · {data.subscriptions} langganan aktif · {formatBytes(data.mediaBytes)} media album
            </p>
            <div className="ledeActions">
              <button type="button" className="button primary" onClick={() => onOpen('laporan')}>
                Buka antrean laporan
              </button>
              {can('users.read') && (
                <button type="button" className="button" onClick={() => onOpen('pengguna')}>
                  Cari akun
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <div className="twoColumn">
        <Panel
          title="Laporan menunggu"
          aside={<button type="button" className="linkButton" onClick={() => onOpen('laporan')}>Semua laporan</button>}
        >
          {reports.loading && <Loading label="Memuat laporan..." />}
          {reports.error && <ErrorState error={reports.error} onRetry={reports.reload} />}
          {reports.data?.items.length === 0 && (
            <EmptyState title="Tidak ada laporan menunggu. Antrean bersih sampai laporan baru masuk." />
          )}
          <ul className="stackList">
            {reports.data?.items.map((report) => (
              <li key={report.id}>
                <div>
                  <p className="listTitle">{report.targetType} · {report.reason}</p>
                  <p className="listMeta">Pelapor {report.reporter} · {formatDate(report.createdAt)}</p>
                </div>
                <button type="button" className="linkButton" onClick={() => onOpen('laporan')}>Tinjau</button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Jejak admin terakhir"
          aside={can('audit.read') ? <button type="button" className="linkButton" onClick={() => onOpen('audit')}>Buka audit</button> : undefined}
        >
          {audit.loading && <Loading label="Memuat jejak admin..." />}
          {audit.error && <ErrorState error={audit.error} onRetry={audit.reload} />}
          {audit.data?.items.length === 0 && <EmptyState title="Belum ada tindakan admin tercatat." />}
          <ul className="stackList">
            {audit.data?.items.map((entry) => (
              <li key={entry.id}>
                <div>
                  <p className="listTitle">{entry.action}</p>
                  <p className="listMeta">{entry.actor} · {formatDate(entry.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
