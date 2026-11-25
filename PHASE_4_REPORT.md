# PHASE 4 REPORT — Trip Replay, Feed, Album, Poster & Engagement

Tanggal: 25 November 2026. Status: **dilaporkan selesai untuk lingkup backend Phase 4 yang diminta**, dengan batasan yang dicatat eksplisit di bagian 7. Tidak ada commit atau push.

## 1. Ringkasan hasil verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `cd backend && npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `cd backend && npm test` (build + seluruh test) | **23 test, 23 pass, 0 fail, exit 0** |
| Test baru Phase 4 | **12 test** (5 sosial/album + 7 media/replay/poster/engagement/notifikasi/deletion) |
| `node tools/junk-check.mjs` | 0 baris mencurigakan pada 168 berkas |
| Migrasi | `0001`…`0006` berurutan pada PGlite + PostGIS 3.x |
| OpenAPI | `docs/openapi.json` diregenerasi, **100 path** |
| Android | **Tidak dibangun/diuji** pada fase ini |
| FCM nyata | **Tidak diuji** — tanpa `FCM_SERVER_KEY` jalur push melaporkan nonaktif |
| Bucket S3 nyata | **Tidak diuji** — alur upload dan signed access diuji dengan kredensial palsu |

## 2. Lingkup yang diimplementasikan

| # | Requirement | Implementasi | Bukti |
|---|---|---|---|
| 1 | Trip detail/replay lebih kaya | `GET /v1/trips/{id}/replay` membangun segmen dari `trip_points` di server: spike dan fix akurasi rendah dibuang dari garis, lubang sinyal menjadi `gapBeforeS`, statistik dihitung ulang dan disimpan ke `trips.summary`. Timeline untuk scrubbing, marker foto pada jarak tertentu, komentar dan reaksi trip. `PATCH /v1/trips/{id}/share` mengatur siapa yang boleh melihat replay. | `src/replay/replay.service.ts`, `phase4.replay.test.ts` |
| 2 | Feed/post teks, foto, video, trip recap + audience | `POST /v1/posts`, `GET /v1/feed`, `GET /v1/posts/{id}`, `DELETE /v1/posts/{id}`. Empat jenis post, empat audience, lampiran media tervalidasi, lokasi opsional, rate limit per jam. | `src/posts/posts.service.ts` |
| 3 | Komentar, reaksi, follow, mention, hashtag, save, report/block/mute | Reaksi dan komentar idempoten dengan `clientId`; keyset pagination komentar; follow/request/accept; mention dan hashtag diekstrak server; save/unsave; report idempoten; block dua arah; mute khusus feed. | `src/posts/*`, `src/social/*` |
| 4 | Album pribadi/komunitas | Album dengan visibilitas, kuota, `SELECT ... FOR UPDATE` saat menambah media, metadata (caption, takenAt, dimensi, durasi), moderasi (`pending/approved/rejected`), permission matrix komunitas, retry upload lewat `clientMediaId`, dan pengembalian kuota saat media dihapus. | `src/albums/*` |
| 5 | Poster trip | Tiga template original (`first_light`, `peloton_lines`, `night_odometer`) dirender server menjadi SVG; tidak ada HTML pengguna. `POST /v1/posters/{id}/export` mencatat ekspor idempoten dan memberi path unduhan untuk disimpan ke galeri oleh klien. | `src/posters/*` |
| 6 | Story/status | **Tidak dibuat.** Prioritas produk dan kebijakan retensi belum disetujui, sesuai syarat di PRD. | — |
| 7 | Points, badge, leaderboard | Ledger dengan alasan yang dibatasi CHECK database; badge katalog aman; evaluasi badge dari checklist/komentar/laporan; leaderboard hanya akun opt-in dan hanya menjumlahkan ledger. Tidak ada jalur poin untuk kecepatan, jarak, atau ponsel saat berkendara. | `src/rewards/*`, `migrations/0004`, `0006` |
| 8 | Notifikasi in-app + FCM + preferensi | Daftar/baca notifikasi, preferensi per kategori, registrasi perangkat idempoten per install, token FCM terenkripsi, pengiriman best-effort bila key tersedia. | `src/notifications/*` |

## 3. Endpoint baru

- **Sosial**: `GET/PATCH /v1/me/rider-profile`, `GET /v1/users/{id}`, `POST/DELETE /v1/users/{id}/follow`, `GET /v1/me/follow-requests`, `POST /v1/me/follow-requests/{requesterId}/accept|decline`, `POST/DELETE /v1/users/{id}/block`, `GET /v1/me/blocked`, `POST/DELETE /v1/users/{id}/mute`, `POST /v1/reports`, `DELETE /v1/me/social-data`.
- **Post**: `GET /v1/feed`, `POST/GET/DELETE /v1/posts`, `POST/DELETE /v1/posts/{id}/reactions`, `POST/DELETE /v1/posts/{id}/save`, `GET/POST /v1/posts/{id}/comments`, `DELETE /v1/comments/{id}`, `POST/DELETE /v1/comments/{id}/reactions`, `GET /v1/users/{id}/posts`, `GET /v1/hashtags/{tag}/posts`, `GET /v1/me/saves`.
- **Album**: `POST/GET /v1/albums`, `GET/DELETE /v1/albums/{id}`, `POST /v1/albums/{id}/media`, `PATCH/DELETE /v1/albums/{id}/media/{mediaId}`, `POST /v1/albums/{id}/media/{mediaId}/review`, `GET /v1/communities/{communityId}/albums`.
- **Media**: `GET /v1/media/{id}/url` (signed grant), `GET /v1/media/{id}/access` (publik, signature = capability).
- **Replay**: `GET /v1/trips/{id}/replay`, `GET/POST /v1/trips/{id}/photos`, `PATCH /v1/trips/{id}/share`.
- **Poster**: `POST/GET /v1/trips/{tripId}/posters`, `GET /v1/posters/{id}`, `GET /v1/posters/{id}/render.svg`, `POST /v1/posters/{id}/export`.
- **Engagement**: `GET /v1/me/points`, `POST /v1/me/safety-checklist`, `GET /v1/me/badges`, `POST /v1/me/badges/evaluate`, `GET /v1/leaderboard`.
- **Notifikasi**: `GET /v1/notifications`, `POST /v1/notifications/{id}/read`, `POST /v1/notifications/read-all`, `GET/PATCH /v1/me/notification-preferences`, `POST/DELETE /v1/me/push-devices`.

## 4. Data dan migrasi

- `0004_phase4.sql`: tabel sosial, reaksi/komentar, album, trip segment/photo/comment/reaction, hashtag/mention, notifikasi, push device, point ledger, badge, poster, feed cursor, dan view `leaderboard_entries`.
- `0005_community.sql`: policy join, matriks izin per peran, satu owner aktif, perluasan event/RSVP.
- `0006_phase4_social.sql`: memperluas `content_reports` Phase 3 (target dan alasan sosial), menambah dukungan video pada `media_assets`, soft delete album, kolom ekspor poster, identitas install + token terenkripsi pada `push_devices`, dan seed lima badge.
- Object storage tetap hanya menyimpan byte; database menyimpan `object_key`, ukuran, tipe, dan metadata. Tidak ada blob di database.

## 5. Invarian yang diuji

- **Audience & cross-user**: post private hanya penulis; followers butuh follow diterima; community butuh anggota aktif; album private 404 untuk pengguna lain; media private 404; replay trip bukan milik/shared 404.
- **Signed URL**: pemilik mendapat grant; pengguna tanpa akses 404; signature yang diubah 401 `SIGNED_URL_INVALID`; grant kedaluwarsa 401 `SIGNED_URL_EXPIRED`.
- **Upload**: ukuran melebihi batas 422; tipe tidak cocok purpose 422; magic bytes salah 409 dan aset menjadi `rejected`; intent dengan `clientMediaId` sama mengembalikan baris yang sama.
- **Feed/komentar**: keyset page tanpa duplikat; cursor berakhir `null`; komentar terhapus tidak dihitung.
- **Idempotensi**: reaksi/komentar/report/upload/poster mengembalikan `duplicate: true` tanpa baris ganda.
- **Block/report**: block menyembunyikan konten dua arah dan menghapus follow; report ganda tidak membuat baris baru; target tidak ada 404.
- **Trip replay**: satu gap, satu spike, satu low-accuracy; jarak yang dilaporkan < 5 km meski ada titik spike sejauh ~100 km; hanya 5 titik diterima; dua segmen tersimpan.
- **Engagement**: checklist dua kali sehari hanya memberi poin sekali; insert alasan `speeding` ditolak constraint; leaderboard kosong sebelum opt-in dan memuat 15 poin setelah opt-in.
- **Notifikasi**: preferensi `follow`/`comment` menekan baris in-app; read-all menurunkan unread ke 0; registrasi ulang install yang sama mempertahankan id perangkat.
- **Deletion**: penghapusan sosial menghapus post/album/media/trip photo/notifikasi/poin, mengembalikan object key, dan mempertahankan akun; panggilan kedua 409.

## 6. Perbaikan di luar modul baru

- `TripsService.addPoints` sebelumnya memakai titik `ok` terakhir untuk mendeteksi gap. Setelah satu gap, semua titik berikutnya ikut menjadi gap. Sekarang gap dibandingkan dengan titik terakhir yang diterima (kualitas apa pun), sedangkan jarak/spike tetap memakai titik `ok` terakhir. Perilaku test Phase 1 tidak berubah.
- Assertion jumlah migrasi di `api.test.ts` dan `phase2.test.ts` diperbarui dari 4 menjadi 6 berkas.

## 7. Batasan dan pekerjaan yang belum dilakukan

1. **Android belum disentuh.** Tidak ada layar feed, album, replay player, poster preview, atau penyimpanan ke galeri. Klien lama tidak akan memakai endpoint baru sampai diintegrasikan.
2. **Story/status tidak dibuat** karena belum ada keputusan prioritas produk dan retention policy.
3. **API komunitas belum ada.** Fase 4 menegakkan izin komunitas terhadap baris `communities`/`community_members` yang sudah ada; pembuatan dan pengelolaan komunitas adalah permukaan Fase 3 yang belum tersedia di build ini. Test menyiapkan komunitas langsung di database.
4. **Signed GET mengembalikan metadata + grant**, bukan byte dari bucket. Produksi perlu menerjemahkan grant menjadi SigV4 asli atau proxy Worker. Kredensial storage tetap tidak pernah dikirim ke klien.
5. **FCM belum diuji dengan kredensial nyata.** Tanpa `FCM_SERVER_KEY`, notifikasi in-app tetap dibuat dan perangkat terdaftar, tetapi pengiriman push dilaporkan `pushConfigured: false`.
6. **Render poster adalah SVG**, bukan PNG raster. Ekspor mencatat niat dan menyediakan path unduhan; penulisan ke galeri adalah tanggung jawab klien.
7. **Tidak ada uji beban sosial**, uji moderasi end-to-end dengan panel admin, atau uji bucket S3 nyata.
8. **Moderasi konten** menyediakan state dan permission, tetapi belum ada antrean admin/otomatis untuk menindak laporan.

## 8. Berkas utama

Baru: `backend/src/social/*`, `backend/src/posts/*`, `backend/src/albums/*`, `backend/src/replay/*`, `backend/src/posters/*`, `backend/src/rewards/*`, `backend/src/notifications/*`, `backend/migrations/0006_phase4_social.sql`, `backend/src/test/phase4.social.test.ts`, `backend/src/test/phase4.replay.test.ts`, `backend/src/test/phase4.helpers.ts`, `docs/openapi.json` (regenerasi), `PHASE_4_REPORT.md`.

Diubah: `backend/src/app.module.ts` (wiring Media/Notifications/Social/Posts/Albums/Replay/Posters/Rewards), `backend/src/config/env.ts`, `backend/src/media/media.controller.ts` (signed grant), `backend/src/media/media.dto.ts`, `backend/src/media/media.service.ts`, `backend/src/trips/trips.service.ts`, `backend/src/test/api.test.ts`, `backend/src/test/phase2.test.ts`, `backend/src/test/phase4.test.ts`, `docs/SECURITY_AND_PRIVACY.md`, `docs/TEST_PLAN.md`, `backend/.env.example`.

## 9. Perintah yang dijalankan

```
cd backend
npx tsc -p tsconfig.json --noEmit
npm test
node --test dist/test/phase4.social.test.js
node --test dist/test/phase4.replay.test.js
node tools/junk-check.mjs
AUTH_JWT_SECRET=... npm run openapi
```
