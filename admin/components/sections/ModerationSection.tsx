'use client';

import { FormEvent, useState } from 'react';
import { api, formatDate, query, shortId } from '@/lib/client';
import type { CommunityItem, ListResponse, PostItem, RunAction } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { ActionForm, EmptyState, ErrorState, Field, Loading, StatusPill, TableWrap } from '../ui';
import { MediaModerationPanel } from './MediaModerationPanel';

type Props = {
  runAction: RunAction;
  can: (permission: string) => boolean;
};

export function ModerationSection({ runAction, can }: Props) {
  const [tab, setTab] = useState<'posts' | 'communities' | 'media'>('posts');
  const [status, setStatus] = useState('');
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityItem | null>(null);
  const [action, setAction] = useState('hide');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const posts = useApi<ListResponse<PostItem>>(`posts${query({ status, limit: 50 })}`);
  const communities = useApi<ListResponse<CommunityItem>>(`communities${query({ status, limit: 50 })}`);

  function changeTab(next: 'posts' | 'communities' | 'media') {
    setTab(next);
    setStatus('');
    setSelectedPost(null);
    setSelectedCommunity(null);
  }

  async function submitPost(event: FormEvent) {
    event.preventDefault();
    if (!selectedPost) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) => api(`posts/${selectedPost.id}`, {
        method: 'PATCH',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ action, reason }),
      }),
      'Status post diperbarui.',
    );
    setBusy(false);
    if (result) {
      setSelectedPost(null);
      setReason('');
      posts.reload();
    }
  }

  async function submitCommunity(event: FormEvent) {
    event.preventDefault();
    if (!selectedCommunity) return;
    setBusy(true);
    const result = await runAction(
      (stepUp) => api(`communities/${selectedCommunity.id}`, {
        method: 'PATCH',
        headers: { 'X-Step-Up-Token': stepUp },
        body: JSON.stringify({ action, reason }),
      }),
      'Status komunitas diperbarui.',
    );
    setBusy(false);
    if (result) {
      setSelectedCommunity(null);
      setReason('');
      communities.reload();
    }
  }

  return (
    <div className="pageStack">
      <div className="tabBar" role="tablist" aria-label="Jenis konten">
        <button type="button" role="tab" aria-selected={tab === 'posts'} className={tab === 'posts' ? 'tab active' : 'tab'} onClick={() => changeTab('posts')}>
          Post
        </button>
        <button type="button" role="tab" aria-selected={tab === 'communities'} className={tab === 'communities' ? 'tab active' : 'tab'} onClick={() => changeTab('communities')}>
          Komunitas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'media'} className={tab === 'media' ? 'tab active' : 'tab'} onClick={() => changeTab('media')}>
          Media
        </button>
      </div>

      {tab === 'media' && <MediaModerationPanel runAction={runAction} can={can} />}

      {tab !== 'media' && (
      <div className="filterBar">
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Semua status</option>
            {tab === 'posts' ? (
              <>
                <option value="published">Terbit</option>
                <option value="hidden">Disembunyikan</option>
                <option value="removed">Dihapus</option>
              </>
            ) : (
              <>
                <option value="visible">Terlihat</option>
                <option value="hidden">Disembunyikan</option>
                <option value="removed">Dihapus</option>
              </>
            )}
          </select>
        </Field>
      </div>
      )}

      {tab === 'posts' && (
        <>
          {posts.loading && <Loading label="Memuat post..." />}
          {posts.error && <ErrorState error={posts.error} onRetry={posts.reload} />}
          {posts.data?.items.length === 0 && <EmptyState title="Tidak ada post pada filter ini." />}
          {posts.data && posts.data.items.length > 0 && (
            <TableWrap>
              <table>
                <caption className="srOnly">Daftar post untuk moderasi</caption>
                <thead>
                  <tr>
                    <th scope="col">Post</th>
                    <th scope="col">Penulis</th>
                    <th scope="col">Audiens</th>
                    <th scope="col">Status</th>
                    <th scope="col">Dibuat</th>
                    <th scope="col"><span className="srOnly">Tindakan</span></th>
                  </tr>
                </thead>
                <tbody>
                  {posts.data.items.map((post) => (
                    <tr key={post.id} className={selectedPost?.id === post.id ? 'selectedRow' : undefined}>
                      <td>
                        <strong>{post.caption?.slice(0, 70) || `Post ${post.kind}`}</strong>
                        <span className="cellSub">{shortId(post.id)}</span>
                      </td>
                      <td>{post.author}</td>
                      <td>{post.audience}</td>
                      <td><StatusPill value={post.status} /></td>
                      <td>{formatDate(post.createdAt)}</td>
                      <td>
                        <button type="button" className="linkButton" onClick={() => {
                          setSelectedPost(post);
                          setAction(post.status === 'published' ? 'hide' : 'restore');
                          setReason('');
                        }}>
                          Moderasi
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {selectedPost && (
            <section className="detailPanel">
              <div className="detailHead">
                <div>
                  <p className="kicker">Post {shortId(selectedPost.id)}</p>
                  <h2>{selectedPost.caption?.slice(0, 100) || selectedPost.kind}</h2>
                  <p className="listMeta">Penulis {selectedPost.author} · status {selectedPost.status}</p>
                </div>
                <button type="button" className="linkButton" onClick={() => setSelectedPost(null)}>Tutup</button>
              </div>
              {can('posts.moderate') ? (
                <ActionForm title="Tindakan moderasi" onCancel={() => setSelectedPost(null)}>
                  <form className="stack" onSubmit={submitPost}>
                    <Field label="Tindakan">
                      <select value={action} onChange={(event) => setAction(event.target.value)}>
                        <option value="hide">Sembunyikan</option>
                        <option value="restore">Pulihkan</option>
                        <option value="remove">Hapus dari tampilan</option>
                      </select>
                    </Field>
                    <Field label="Alasan" hint="Wajib dan tersimpan di audit log.">
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
                    </Field>
                    <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
                      {busy ? 'Menyimpan...' : 'Simpan tindakan'}
                    </button>
                  </form>
                </ActionForm>
              ) : <p className="notice">Peran Anda tidak memiliki izin moderasi post.</p>}
            </section>
          )}
        </>
      )}

      {tab === 'communities' && (
        <>
          {communities.loading && <Loading label="Memuat komunitas..." />}
          {communities.error && <ErrorState error={communities.error} onRetry={communities.reload} />}
          {communities.data?.items.length === 0 && <EmptyState title="Tidak ada komunitas pada filter ini." />}
          {communities.data && communities.data.items.length > 0 && (
            <TableWrap>
              <table>
                <caption className="srOnly">Daftar komunitas untuk moderasi</caption>
                <thead>
                  <tr>
                    <th scope="col">Komunitas</th>
                    <th scope="col">Pemilik</th>
                    <th scope="col">Anggota</th>
                    <th scope="col">Visibilitas</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="srOnly">Tindakan</span></th>
                  </tr>
                </thead>
                <tbody>
                  {communities.data.items.map((community) => (
                    <tr key={community.id} className={selectedCommunity?.id === community.id ? 'selectedRow' : undefined}>
                      <td>
                        <strong>{community.name}</strong>
                        <span className="cellSub">/{community.slug}</span>
                      </td>
                      <td>{community.owner}</td>
                      <td>{community.members}</td>
                      <td>{community.visibility}</td>
                      <td><StatusPill value={community.moderationStatus} /></td>
                      <td>
                        <button type="button" className="linkButton" onClick={() => {
                          setSelectedCommunity(community);
                          setAction(community.moderationStatus === 'visible' ? 'hide' : 'restore');
                          setReason('');
                        }}>
                          Moderasi
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {selectedCommunity && (
            <section className="detailPanel">
              <div className="detailHead">
                <div>
                  <p className="kicker">Komunitas {selectedCommunity.slug}</p>
                  <h2>{selectedCommunity.name}</h2>
                  <p className="listMeta">Pemilik {selectedCommunity.owner} · {selectedCommunity.members} anggota</p>
                </div>
                <button type="button" className="linkButton" onClick={() => setSelectedCommunity(null)}>Tutup</button>
              </div>
              {can('communities.moderate') ? (
                <ActionForm title="Tindakan komunitas" onCancel={() => setSelectedCommunity(null)}>
                  <form className="stack" onSubmit={submitCommunity}>
                    <Field label="Tindakan">
                      <select value={action} onChange={(event) => setAction(event.target.value)}>
                        <option value="hide">Sembunyikan</option>
                        <option value="restore">Pulihkan</option>
                        <option value="remove">Hapus dari tampilan</option>
                      </select>
                    </Field>
                    <Field label="Alasan" hint="Wajib dan tersimpan di audit log.">
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} required rows={3} />
                    </Field>
                    <button type="submit" className="button primary" disabled={busy || reason.trim().length < 3}>
                      {busy ? 'Menyimpan...' : 'Simpan tindakan'}
                    </button>
                  </form>
                </ActionForm>
              ) : <p className="notice">Peran Anda tidak memiliki izin moderasi komunitas.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
