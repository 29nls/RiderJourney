# AUDIT REPORT PHASE 5 + COMMUNITY API

Tanggal audit: 24 November 2026
Lingkup: backend Phase 5, API komunitas, admin Next.js, dan aplikasi Android yang ada di workspace.
Sifat audit: independen, read-only pada awalnya; perbaikan hanya untuk temuan yang jelas dan masih dalam fase yang sudah disetujui.
Status akhir: **BELUM PRODUCTION READY**. Masih ada temuan High yang terbuka dan acceptance gate perangkat/staging belum dijalankan.

## 1. Ringkasan eksekutif

Audit menemukan dua defect Critical pada jalur P0 yang tidak terlihat dari test suite lama:

1. Modul `ChatModule`, `HazardsModule`, dan `VoiceModule` ada di source, tetapi tidak diimpor ke `AppModule`. Endpoint chat, hazard, dan voice tidak ter-mount, tidak masuk OpenAPI, dan tidak memiliki test.
2. Setelah modul hazard di-mount, query `nearby` ternyata selalu gagal karena daftar kolom dan `FROM` digabung dengan urutan yang salah, sehingga `GET /v1/hazards/nearby` mengembalikan 500.

Keduanya sudah diperbaiki dan dilindungi oleh regression test baru. Setelah perbaikan, backend lulus **35/35 test** dan OpenAPI memuat **150 path**.

Temuan High yang masih terbuka:

- Layar Android untuk COM-01 (chat), SAF-01..03 (hazard), ACC-04 (hapus akun), ACC-05 (consent), RID-01/VEH-01 (media), dan MAP-05 (favorit) belum ada.
- Pipeline media belum layak produksi: signing upload bukan AWS SigV4, penyelesaian upload mempercayai ukuran/header dari klien, dan signed GET hanya mengembalikan metadata, bukan byte atau redirect ke storage.
- Penghapusan akun dan purge sosial menghapus metadata media, tetapi tidak menghapus objek di object storage.
- Rotasi refresh token sudah dibuat atomik, tetapi race nyata belum diuji karena PGlite hanya satu koneksi.
- Concurrency recorder GPS sudah diperbaiki di kode, tetapi belum diuji pada perangkat atau dengan banyak callback paralel.
- Stale realtime setelah disconnect sudah diperbaiki di kode, tetapi belum ada test disconnect khusus dan belum diuji dengan Redis nyata.
- Verifikasi perangkat, Redis/PostgreSQL/S3 nyata, Play Billing, dan admin click-through masih BLOCKED.

Kesimpulan: perbaikan audit menutup dua jalur P0 yang mati dan beberapa race yang jelas. Namun produk belum boleh disebut production-ready karena gap klien P0, pipeline media, penghapusan byte media, dan verifikasi staging/perangkat masih terbuka.

## 2. Metode dan baseline

Yang diperiksa:

- Dokumen: `PRD_RiderJourney.md`, `docs/REQUIREMENTS_MATRIX.md`, `docs/PHASE_5_REPORT.md`, `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md`, `docs/API_CONTRACT.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/openapi.json`, `README.md`.
- Backend: auth, users, vehicles, places, routes, trips, convoys, realtime, chat, hazards, voice, media, social, community, posts, albums, replay, posters, rewards, billing, redeem, ops, admin, migrations, dan test.
- Android: `AppRoot`, auth, home, garage, route, trips, convoy, profile, recorder, tracking service, manifest, unit test.
- Admin: struktur route, build, dan ketergantungan pada API; tidak ada click-through dengan backend nyata.

Baseline yang dijalankan:

| Pemeriksaan | Hasil |
|---|---|
| `cd backend && npm test` | **35 test, 35 lulus, 0 gagal** setelah perbaikan |
| `cd admin && npm run build` | lulus, Next.js 16.4.6 |
| `cd backend && npm audit --omit=dev` | 0 vulnerability |
| `cd admin && npm audit --omit=dev` | 0 vulnerability |
| Android `:app:testDebugUnitTest :app:assembleDebug` dengan JDK 21 | BUILD SUCCESSFUL, 14 unit test |
| Android `lintDebug` dengan JDK 21 | BUILD SUCCESSFUL, 32 warning, 0 error |
| OpenAPI setelah perbaikan | **150 path** |
| `cd backend && node tools/junk-check.mjs` | 0 baris mencurigakan pada 205 berkas |

Catatan: JDK 25 sistem gagal di `JavaVersion.parse`; JDK 21 project-local berhasil. Ini masalah tooling, bukan kode aplikasi.

## 3. Perubahan yang diterapkan

Perubahan berikut adalah bug fix dan regression test, bukan fitur baru.

| File | Perubahan | Alasan |
|---|---|---|
| `backend/src/app.module.ts` | Impor `ChatModule`, `HazardsModule`, `VoiceModule` | Endpoint P0 sebelumnya tidak ter-mount |
| `backend/src/chat/chat.controller.ts` | Hapus route blokir ganda `users/:id/block` | Route bertabrakan dengan `SocialController`; hanya satu semantik blokir yang boleh ada |
| `backend/src/chat/chat.service.ts` | Hapus method blokir yang tidak lagi dipakai | Menghindari dua implementasi blokir dengan perilaku berbeda |
| `backend/src/hazards/hazards.service.ts` | Pisahkan daftar kolom dari `FROM`, susun query `nearby` dengan benar | `GET /v1/hazards/nearby` selalu 500 |
| `backend/src/hazards/hazards.types.ts` | Alias filter aktif dengan `h.` | `status` ambigu antara `hazard_reports` dan `users` |
| `backend/src/auth/token.service.ts` | Rotasi refresh dalam transaksi dan `SELECT ... FOR UPDATE` | Dua refresh paralel dapat sama-sama lolos |
| `backend/src/convoys/convoys.service.ts` | Kunci row konvoi, hitung occupancy di dalam transaksi, cek `If-Match` di dalam transaksi | Dua approval paralel dapat melewati kapasitas |
| `backend/src/realtime/realtime.gateway.ts` | Hapus filter yang hanya memproses user dengan socket aktif | User yang disconnect tidak pernah menerima event stale |
| `android/.../TripRecorder.kt` | Mutex untuk alokasi `seq`, simpan fix terakhir di memori | Callback lokasi paralel dapat bentrok unique `(tripId, seq)` dan filter kehilangan pembanding setelah flush |
| `android/.../TripTrackingService.kt` | Validasi sesi `active` sebelum meminta GPS | Restart sticky dapat menyalakan FGS/GPS untuk sesi paused |
| `backend/src/test/api.test.ts` | Test wiring chat/hazard/voice | Mencegah modul hilang dari `AppModule` lagi |
| `docs/API_CONTRACT.md` | Perbaiki path/field media dan status OpenAPI | Dokumen berbeda dari implementasi |
| `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md` | Perbarui angka test/OpenAPI terbaru | Angka lama tidak lagi mencerminkan baseline |

## 4. Temuan berdasarkan severity

Legenda status:

- **Fixed**: sudah diperbaiki di audit ini, dengan verifikasi yang tercantum.
- **Open**: belum diperbaiki.
- **Blocked**: tidak dapat diverifikasi atau diperbaiki tanpa environment yang tidak tersedia.

### 4.1 Critical

| ID | Status | Area | Temuan |
|---|---|---|---|
| C-01 | Fixed | Backend wiring | Modul chat, hazard, dan voice tidak diimpor ke `AppModule`; seluruh endpoint P0 tidak ter-mount dan tidak ada di OpenAPI |
| C-02 | Fixed | Backend geospatial | `GET /v1/hazards/nearby` selalu 500 karena query menggabungkan `FROM` dan daftar kolom dengan urutan salah, serta filter `status` ambigu |

#### C-01 - Modul P0 tidak ter-mount

Bukti sebelum perbaikan:

- `backend/src/app.module.ts` hanya mengimpor `RealtimeModule` lalu `MediaModule`; tidak ada `ChatModule`, `HazardsModule`, atau `VoiceModule`.
- `backend/src/chat/chat.module.ts`, `backend/src/hazards/hazards.module.ts`, dan `backend/src/voice/voice.module.ts` ada dan mendeklarasikan controller.
- `docs/openapi.json` tidak memuat `/v1/hazards/*`, `/v1/convoys/{id}/messages`, atau `/v1/convoys/{id}/voice/*`.
- Tidak ada test yang menyebut `ChatModule`, `HazardsModule`, atau `VoiceModule`.

Reproduksi sebelum perbaikan:

```bash
curl -i -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/hazards/nearby?lat=-6.2&lng=106.8"
# HTTP 404 route-level, bukan domain error
```

Dampak: COM-01 dan SAF-01..03 adalah requirement P0. Backend yang "ada" tidak dapat dipanggil klien, dan OpenAPI menyesatkan tim klien.

Perbaikan: impor ketiga modul di `app.module.ts`; hapus route blokir ganda dari `ChatController` agar `POST/DELETE /v1/users/:id/block` hanya ditangani `SocialController`.

Verifikasi setelah perbaikan:

- `GET /v1/hazards/nearby` mengembalikan 200.
- `GET /v1/convoys/<uuid>/messages` mengembalikan 404 domain `CONVOY_NOT_FOUND`, bukan 404 route.
- `POST /v1/convoys/<uuid>/voice/token` mengembalikan 404 domain `CONVOY_NOT_FOUND`.
- OpenAPI memuat path chat, hazard, voice, dan blokir sosial.

#### C-02 - Query hazard `nearby` selalu gagal

Bukti sebelum perbaikan:

- `backend/src/hazards/hazards.service.ts` menyusun query dengan `${VIEW_SELECT}, ST_Distance(...) AS distance_m`, sementara `VIEW_SELECT` sudah berisi `FROM hazard_reports h JOIN users u ...`. Hasilnya `FROM ... JOIN ..., ST_Distance(...)` bukan SELECT list.
- `backend/src/hazards/hazards.types.ts` memakai `status = 'active'` tanpa alias; `users` juga memiliki kolom `status`, sehingga query kedua dapat menghasilkan `column reference "status" is ambiguous`.
- Log runtime: `syntax error at or near "::"` pada `GET /v1/hazards/nearby`, HTTP 500 `INTERNAL_ERROR`.

Reproduksi sebelum perbaikan:

```bash
curl -i -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/hazards/nearby?lat=-6.2&lng=106.8"
# HTTP 500 INTERNAL_ERROR
```

Dampak: fitur keselamatan P0 tidak dapat dibaca sama sekali. Tidak ada hazard yang bisa ditemukan, meskipun pembuatan hazard secara teori tersedia.

Perbaikan: pisahkan `HAZARD_COLUMNS` dari `VIEW_SELECT`; query `nearby` sekarang `SELECT ${HAZARD_COLUMNS}, ST_Distance(...) ... FROM ...`; filter memakai `h.status`, `h.moderation_status`, `h.expires_at`.

Verifikasi: regression test baru memanggil endpoint dan mengharapkan 200 dengan `items: []`; test lulus.

### 4.2 High

| ID | Status | Area | Temuan |
|---|---|---|---|
| H-01 | Open | Product/Android | Layar P0 chat, hazard, hapus akun, consent, media profil/kendaraan, dan favorit belum ada |
| H-02 | Open, Blocked | Media | Signing upload bukan AWS SigV4; `complete` mempercayai ukuran/header klien; `access` hanya metadata |
| H-03 | Open, Blocked | Privacy | Penghapusan akun/purge sosial tidak menghapus byte objek media |
| H-04 | Fixed, test gap | Auth | Rotasi refresh token race; sudah dikunci, tetapi race nyata belum diuji |
| H-05 | Fixed, test gap | Android GPS | `TripRecorder.record` dapat berjalan paralel dan bentrok `seq`; filter kehilangan pembanding setelah flush |
| H-06 | Fixed, test gap | Realtime | User yang disconnect tidak menerima event stale |
| H-07 | Blocked | Verification | FGS, background location, process death, permission, Redis/S3/Play, dan admin click-through belum diuji |

#### H-01 - Gap klien P0

Bukti:

- `android/app/src/main/java/id/riderjourney/app/ui/AppRoot.kt` hanya memetakan tab `home`, `garage`, `route`, `trips`, `convoy`, dan `profile`.
- `docs/REQUIREMENTS_MATRIX.md` mencatat ACC-04 belum, ACC-05 hanya backend, RID-01/VEH-01 sebagian tanpa media, MAP-05 belum, COM-01 ditunda, dan SAF-01..03 ditunda.
- Tidak ada screen chat, hazard, consent, account deletion, avatar/vehicle photo, atau favorites di `android/app/src/main/java/id/riderjourney/app/ui/`.

Reproduksi: buka aplikasi, masuk, dan periksa navigation bar. Hanya enam tab yang tersedia; tidak ada jalur UI ke fitur P0 tersebut.

Dampak: acceptance criteria P0/MVP belum terpenuhi meskipun sebagian endpoint backend sudah ada. Ini bukan dead button, tetapi fitur yang belum dapat digunakan pengguna.

Remediation: implementasikan layar dan alur sesuai requirement, lalu uji pada perangkat. Backend chat/hazard/voice kini sudah ter-mount, jadi pekerjaan klien tidak lagi terhalang wiring.

#### H-02 - Pipeline media belum end-to-end

Bukti:

- `backend/src/media/media.service.ts` `sign()` membangun query `AWS4-HMAC-SHA256`, tetapi menghitung signature dengan `createHmac(...).update(unsigned)` pada URL mentah, bukan canonical request SigV4. Bucket S3 nyata akan menolak request ini.
- `complete()` memakai `byteLength` dari body klien dan hanya memeriksa 1 KB head yang dikirim klien (`MediaController.complete`), bukan `HEAD` object di storage.
- `MediaAccessController.access()` memanggil `verifySignedAccess()` dan mengembalikan JSON metadata; tidak mengalirkan byte dan tidak redirect ke signed storage URL.
- `docs/PHASE_5_REPORT.md` sendiri mencatat signed GET masih metadata dan memerlukan proxy/SigV4 produksi.

Reproduksi: konfigurasikan bucket S3, buat upload intent, lalu PUT ke `uploadUrl`; signature tidak cocok dengan SigV4. Setelah itu `GET /v1/media/{id}/access` mengembalikan JSON, bukan gambar.

Dampak: upload/display media tidak dapat dipakai di produksi. Test yang ada memakai storage palsu, sehingga tidak menangkap masalah ini.

Remediation: gunakan presigned URL SigV4 dari SDK storage; verifikasi object dengan `HEAD` (Content-Length, Content-Type, ETag/checksum); endpoint akses harus redirect 302 ke signed GET atau stream byte; hapus objek saat metadata dihapus.

#### H-03 - Byte media tidak dihapus saat akun dihapus

Bukti:

- `backend/src/ops/privacy.service.ts` menjalankan `DELETE FROM media_assets WHERE owner_id = $1`, tanpa operasi storage.
- `backend/src/social/social.service.ts` `purgeSocialData()` mengumpulkan `objectKeys` dan mengembalikannya, tetapi tidak ada job yang memakainya untuk menghapus objek.
- `backend/src/albums/albums.service.ts` juga mengembalikan `objectKeys` tanpa penghapusan storage.

Dampak: setelah akun dihapus, byte foto/video tetap ada di bucket. Ini melanggar janji penghapusan dan meninggalkan data pribadi yang dapat diakses jika URL/signature lama bocor.

Reproduksi: unggah media, hapus akun, jalankan `POST /v1/admin/jobs/retention`, lalu periksa bucket. Row database hilang; objek tetap ada.

Remediation: outbox/queue penghapusan objek dengan retry dan audit; jangan hanya mengandalkan lifecycle bucket; uji dengan S3/MinIO nyata.

#### H-04 - Rotasi refresh token race

Bukti sebelum perbaikan: `backend/src/auth/token.service.ts` `rotate()` membaca row, memanggil `issue()`, lalu melakukan `UPDATE ... revoked_at` tanpa lock atau transaksi. Dua request paralel dengan token lama dapat sama-sama membaca `revoked_at = null` dan sama-sama mendapatkan token baru.

Perbaikan: `rotate()` sekarang berada dalam `db.transaction`, memakai `SELECT ... FOR UPDATE`, membuat token baru lewat `issueOn(tx, ...)`, dan hanya satu transaksi yang berhasil melakukan `UPDATE ... WHERE revoked_at IS NULL RETURNING id`.

Verifikasi: test rotasi dan replay lulus. **Belum diuji** dengan dua koneksi PostgreSQL nyata; PGlite tidak mereproduksi row lock paralel.

Remediation lanjutan: tambah test integrasi dua koneksi nyata, dan pertimbangkan reuse detection yang mencabut seluruh keluarga token.

#### H-05 - Concurrency recorder GPS Android

Bukti sebelum perbaikan:

- `TripTrackingService.LocationCallback` melakukan `scope.launch { recorder.record(trip, fix) }` untuk setiap lokasi.
- `TripRecorder.record()` membaca `session.lastSeq`, menghitung `lastSeq + 1`, lalu insert dan update tanpa serialisasi. Dua callback dapat memakai `seq` yang sama dan melanggar unique `(trip_id, seq)`.
- `previous` diambil dari `pending_points`; setelah `flush()` menghapus queue, filter spike kehilangan titik pembanding.

Perbaikan: `TripRecorder` memakai `Mutex` untuk `record`/`attach`/`clearLocal`, menyimpan fix terakhir yang diterima di `lastAccepted`, dan memakai fix itu sebagai fallback saat queue kosong.

Verifikasi: Android build dan 14 unit test lulus. **Belum ada test konkurensi** dan belum diuji pada perangkat.

Remediation: tambah test berulang dengan banyak `record` paralel; pertimbangkan antrean single-consumer di service daripada `scope.launch` per fix.

#### H-06 - Stale realtime tidak dikirim setelah disconnect

Bukti sebelum perbaikan: `backend/src/realtime/realtime.gateway.ts` `checkStale()` membuat set user yang masih memiliki socket dan melakukan `if (!active.has(position.userId)) continue;`. User yang baru disconnect justru dilewati, sehingga anggota lain tidak menerima `convoy.location.stale`.

Perbaikan: filter tersebut dihapus; posisi yang melewati `staleAfterSeconds` sekarang dipublikasikan ke room, termasuk untuk user yang tidak lagi memiliki socket.

Verifikasi: TypeScript build dan test suite lulus. **Belum ada test disconnect khusus** dan Redis nyata belum diuji.

Remediation: tambah test WebSocket dua klien: A disconnect, B menerima stale tepat satu kali; uji juga reconnect dan stale reset.

#### H-07 - Verifikasi perangkat dan staging belum dilakukan

Status BLOCKED karena workspace tidak memiliki:

- perangkat/emulator Android untuk FGS, background location, process death, dialog permission, offline UI;
- PostgreSQL/PostGIS dan Redis staging nyata untuk race, load, reconnect, dan multi-instance;
- object storage S3/MinIO nyata;
- Play Console, service account, dan license tester;
- browser admin yang terhubung ke backend nyata untuk click-through dua peran.

Dampak: klaim production readiness tidak dapat dibuat. Ini bukan temuan kode, tetapi gate acceptance yang belum lulus.

### 4.3 Medium

| ID | Status | Area | Temuan |
|---|---|---|---|
| M-01 | Open | Auth | `confirmPasswordReset` memeriksa `used_at` di luar transaksi; dua konfirmasi paralel dapat sama-sama lolos |
| M-02 | Fixed | Convoy | Approval kapasitas sebelumnya memakai `convoy.active_count` di luar transaksi; sudah dikunci |
| M-03 | Open | Chat safety | Blokir hanya menyaring `blocker_id = viewer`; pesan dari akun yang memblokir viewer tetap terlihat dan pengirim yang diblokir masih dapat mengirim |
| M-04 | Open | Validation | Banyak `@Param('id')` tidak memakai `ParseUUIDPipe`; ID non-UUID dapat menjadi error database 500 |
| M-05 | Open | Pagination | Cursor daftar trip hanya `started_at <`; `trip_points` memberi `nextCursor` saat `rows.length === limit` walau tidak ada halaman berikutnya |
| M-06 | Open | Admin | `setUserStatus` memakai ternary `users.suspend : users.suspend`; permission `users.ban` tidak pernah dipakai |
| M-07 | Fixed | Docs | `API_CONTRACT` memakai path/field media yang berbeda dari implementasi |
| M-08 | Open | Docs | `README.md` root berisi dokumentasi toolkit `brain.md`, bukan RiderJourney |
| M-09 | Open | Auth abuse | Rate limit login hanya global per IP; tidak ada lockout/limit per akun |
| M-10 | Open | Voice | `leave` tidak mencabut token voice; token tetap berlaku sampai TTL |

#### M-01 - Password reset replay race

Bukti: `backend/src/auth/auth.service.ts` `confirmPasswordReset()` membaca `used_at`, melakukan `bcrypt.hash`, lalu membuka transaksi untuk update. Dua request dengan token yang sama dapat melewati pemeriksaan sebelum salah satu menulis `used_at`.

Reproduksi (butuh dua koneksi): kirim dua `POST /v1/auth/password/reset/confirm` paralel dengan token yang sama dan password berbeda. Keduanya dapat mengembalikan 204; password akhir bergantung pada urutan commit.

Remediation: `SELECT ... FOR UPDATE` di dalam transaksi, atau `UPDATE one_time_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING user_id` sebagai klaim atomik sebelum mengubah password; test dengan PostgreSQL nyata.

#### M-02 - Approval kapasitas convoy

Bukti sebelum perbaikan: `ConvoysService.approve()` memakai `convoy.active_count` yang dibaca sebelum transaksi; transaksi hanya mengunci row member, bukan row convoy. Dua approval paralel dapat melihat occupancy yang sama dan melewati `capacity`.

Perbaikan: transaksi sekarang mengunci `convoys` dengan `FOR UPDATE`, memeriksa `If-Match` terhadap versi yang dikunci, menghitung ulang `count(*) FILTER status = 'active'`, lalu mengunci row member dan memperbarui status.

Verifikasi: test approval yang ada lulus. Belum ada test dua transaksi paralel pada PostgreSQL nyata.

#### M-03 - Blokir chat tidak simetris

Bukti: `backend/src/chat/chat.service.ts` query daftar pesan hanya memakai:

```sql
NOT EXISTS (
  SELECT 1 FROM user_blocks b
  WHERE b.blocker_id = $2 AND b.blocked_id = m.sender_id
)
```

`$2` adalah viewer. Jika A memblokir B, saat B melihat daftar, tidak ada row `blocker_id = B`, sehingga pesan A tetap muncul. `send()` juga tidak memeriksa blokir, sehingga A tetap dapat mengirim ke B.

Reproduksi: A memblokir B melalui `POST /v1/users/{B}/block`; B memanggil `GET /v1/convoys/{id}/messages`; pesan A masih ada. A memanggil `POST /v1/convoys/{id}/messages`; pesan tetap diterima.

Remediation: filter dua arah (`(b.blocker_id = viewer AND b.blocked_id = sender) OR (b.blocker_id = sender AND b.blocked_id = viewer)`), dan tolak `send()` jika ada blokir di either direction; uji dengan dua akun.

#### M-04 - Tidak ada validasi UUID pada parameter

Bukti: controller memakai `@Param('id') id: string` tanpa `ParseUUIDPipe` di banyak modul (contoh: `backend/src/trips/trips.controller.ts`, `backend/src/convoys/convoys.controller.ts`, `backend/src/media/media.controller.ts`). Query PostgreSQL kemudian menerima string non-UUID.

Reproduksi: `GET /v1/trips/not-a-uuid` berpotensi menghasilkan 500 `INTERNAL_ERROR` dari PostgreSQL, bukan 400/404 domain.

Remediation: tambahkan `ParseUUIDPipe` pada semua parameter UUID, atau pipe global khusus; tambah test invalid ID.

#### M-05 - Pagination tidak stabil

Bukti:

- `backend/src/trips/trips.service.ts` `list()` memakai `AND started_at < $3` dan cursor hanya timestamp. Dua trip dengan `started_at` yang sama dapat terlewat atau berulang.
- `points()` mengembalikan `nextCursor` saat `rows.length === limit`; jika tepat limit dan tidak ada baris berikutnya, klien melakukan satu request tambahan yang kosong.

Remediation: cursor komposit `(started_at, id)` dan query `LIMIT limit + 1`; untuk points, fetch `limit + 1` dan hanya set cursor bila ada sisa.

#### M-06 - Permission `users.ban` mati

Bukti: `backend/src/admin/admin.service.ts` baris 165 memakai `dto.status === 'suspended' ? 'users.suspend' : 'users.suspend'`. DTO status hanya `active|suspended`, sehingga cabang `users.ban` tidak pernah dipakai.

Dampak: policy admin membingungkan dan permission `users.ban` tidak berfungsi. Tidak ada eskalasi langsung karena status ban tidak tersedia di DTO, tetapi ini dead policy.

Remediation: tambahkan status `banned` dan audit action yang sesuai, atau hapus permission `users.ban` dari policy dan dokumentasi.

#### M-07 - Kontrak media tidak sesuai

Bukti: `docs/API_CONTRACT.md` menyebut `/v1/media/upload-intents`, field `mimeType`, dan `/v1/media/{id}/complete`. Implementasi memakai:

- `POST /v1/media/uploads` dengan `{purpose, contentType, sizeBytes, clientMediaId, checksumSha256?}`.
- `POST /v1/media/uploads/{id}/complete` multipart dengan `sizeBytes`, `originalName?`, dan file head.
- `GET /v1/media/{id}/url` dan `GET /v1/media/{id}/access`.
- Tidak ada `DELETE /v1/media/{id}` di controller.

Perbaikan: tabel kontrak diperbarui ke path/field aktual dan endpoint hapus ditandai belum ada.

#### M-08 - README root salah proyek

Bukti: `README.md` root menampilkan logo dan dokumentasi `brain.md`, bukan RiderJourney. Ini membingungkan kontributor dan auditor baru.

Remediation: ganti dengan README RiderJourney yang merangkum backend/admin/android, perintah build/test, environment, dan status fase. Jangan hapus `BRAIN.md`; itu dokumentasi toolkit terpisah.

#### M-09 - Login rate limit per akun

Bukti: `backend/src/app.module.ts` memasang `ThrottlerModule` global 120 request per 60 detik per IP. `AuthService.login` tidak memiliki counter per email/akun. Penyerang dengan banyak IP dapat mencoba password tanpa lockout akun.

Remediation: tambah counter per akun dengan backoff, audit login gagal, dan notifikasi pemilik; pertahankan rate limit IP.

#### M-10 - Voice leave tidak mencabut akses

Bukti: `backend/src/voice/voice.controller.ts` menyediakan `leave`, tetapi token LiveKit yang sudah diterbitkan tetap valid sampai TTL. Jika token bocor, keluar dari room tidak langsung mencabutnya.

Remediation: gunakan TTL pendek, revoke room participant melalui LiveKit API saat leave, dan uji token setelah leave.

### 4.4 Low

| ID | Status | Area | Temuan |
|---|---|---|---|
| L-01 | Open | Tooling | JDK 25 sistem gagal di Kotlin `JavaVersion.parse`; JDK 21 project-local diperlukan |
| L-02 | Open | Android lint | 32 warning, 0 error; sebagian besar update dependency/orientation, bukan blocker |
| L-03 | Open | Test | Tidak ada Android instrumented/UI test; tidak ada admin test; tidak ada Play Billing nyata |
| L-04 | Blocked | Test | PGlite satu koneksi, sehingga race DB, row lock, dan load tidak benar-benar teruji |
| L-05 | Open | CI | CI hanya backend/admin; Android build/test tidak berada di pipeline |
| L-06 | Open | Docs | Angka historis Phase 1/2/5 di `TEST_PLAN` dan laporan fase tidak boleh diubah; hanya baseline terbaru yang diperbarui |
| L-07 | Open | Hazard | `report()` tidak memeriksa keberadaan hazard sebelum insert content report; target UUID acak dapat mengotori report |
| L-08 | Open | Media | `complete()` menandai `rejected` pada kegagalan pertama; retry file yang terpotong memerlukan intent baru |

## 5. Kesesuaian PRD dan requirement ID

### 5.1 P0/MVP

| Requirement | Status aktual | Bukti |
|---|---|---|
| ACC-01 | Sebagian | Register/login/verifikasi token ada; pengiriman email produksi belum |
| ACC-02 | Lulus | Refresh rotation, logout revoke, EncryptedSharedPreferences |
| ACC-03 | Sebagian | Username unik/format; filter profaniti belum |
| ACC-04 | Belum | Backend deletion ada; layar konfirmasi/penghapusan Android belum |
| ACC-05 | Sebagian | Endpoint consent ada; layar consent Android belum |
| RID-01 | Sebagian | Profil teks ada; avatar/media belum |
| RID-02 | Lulus | Visibilitas profil/riwayat/default lokasi |
| VEH-01 | Sebagian | CRUD kendaraan; foto belum |
| VEH-03 | Lulus | Plat AES-256-GCM, hanya pemilik dengan `includePlate` |
| MAP-01 | Sebagian | MapLibre; indikator akurasi/waktu live belum |
| MAP-02 | Sebagian | Search + empty/error; jarak hasil belum |
| MAP-03 | Sebagian | Waypoint tambah/hapus, batas 7; reorder/pilih dari peta belum |
| MAP-04 | Lulus | Preview, alternatif, 503 provider |
| MAP-05 | Belum | Favorit belum |
| TRP-01 | Lulus | Sesi trip dan state machine |
| TRP-02 | Sebagian | FGS + notifikasi + stop; belum diuji perangkat |
| TRP-03 | Lulus | Filter GPS klien/server dan kualitas |
| TRP-04 | Sebagian | State machine + Room; process death belum diuji |
| TRP-05 | Sebagian | Ringkasan/riwayat; peta detail belum |
| CNV-01..06 | Sebagian | Backend dan test realtime ada; klien dan perangkat belum |
| COM-01 | Belum di klien | Backend chat baru ter-mount; tidak ada layar chat Android |
| SAF-01..03 | Belum di klien | Backend hazard baru ter-mount dan diperbaiki; tidak ada layar hazard Android |

### 5.2 Phase 2 sampai Phase 5

- Phase 2 convoy backend dan realtime memiliki cakupan test yang baik, tetapi UI perangkat dan Redis multi-instance belum diuji.
- Phase 3 chat/hazard/voice memiliki implementasi backend, tetapi sebelumnya tidak ter-mount; sekarang sudah, dengan regression test wiring.
- Phase 4 media/social/album/replay/poster memiliki alur API dan moderasi, tetapi pipeline storage nyata belum selesai.
- Phase 5 admin, billing, redeem, privacy, retention, dan config memiliki test backend; admin UI belum diuji dengan backend nyata.
- API komunitas memiliki test create/join/role/audience/album, tetapi tidak ada test UI admin/Android.

## 6. Broken flow, dead control, placeholder, dan mock

- Tidak ditemukan `TODO`, `FIXME`, `mock`, atau placeholder kritis di `backend/src` dan `android/app/src/main/java` pada pencarian audit.
- Navigation Android memetakan setiap tab ke composable yang ada; tidak ada tab yang mengarah ke layar kosong.
- Gap utama bukan dead button, melainkan fitur P0 yang belum memiliki layar (H-01).
- Test media memakai storage palsu; ini bukan mock di production, tetapi membuat pipeline S3 tidak terverifikasi (H-02).
- Route admin dan endpoint backend yang belum memiliki UI tidak boleh dianggap selesai secara produk.

## 7. Android lifecycle, permission, FGS, GPS, dan baterai

Yang sudah benar:

- `TripTrackingService` memakai foreground service dengan tipe lokasi, notifikasi ongoing, dan aksi berhenti.
- Permission `ACCESS_FINE_LOCATION` diperiksa sebelum request; `ACCESS_BACKGROUND_LOCATION` hanya dideklarasikan untuk API 29+ dengan guard versi.
- Interval 5 detik dan `minUpdateDistanceMeters 3f` membatasi update; tidak ada wake lock manual.
- `onDestroy` menghapus location updates dan membatalkan scope.
- Recorder menyimpan titik ke Room dan sync worker, sehingga koneksi putus tidak langsung kehilangan data.

Yang diperbaiki:

- `TripRecorder` diserialisasi dengan `Mutex`; fix terakhir disimpan di memori agar filter spike tetap bekerja setelah `flush`.
- `startUpdates()` sekarang memeriksa sesi `active` sebelum meminta GPS; sesi paused tidak lagi menyalakan FGS/GPS setelah restart.

Yang belum terverifikasi:

- process death dan pemulihan FGS;
- perilaku Doze, OEM battery optimization, dan restart setelah reboot;
- dialog permission bertahap, penolakan permanen, dan kembali dari Settings;
- GPS mati, akurasi buruk, tunnel, dan perpindahan jaringan;
- konsumsi baterai nyata.

## 8. Backend validation, authorization, IDOR, privilege escalation, race, idempotency, rate limit, dan pagination

Yang sudah baik:

- Identitas diambil dari token, bukan body; banyak resource memakai `owner_id`/membership check.
- Kendaraan dan plat tidak bocor lintas pengguna; test cross-user ada.
- Konvoi memiliki membership check, role check, `If-Match`, audit, dan event.
- Chat memakai `client_message_id` unik dan replay idempoten.
- Reaction/comment/redeem/billing memiliki idempotency test.
- Media access memeriksa owner, audience post, album, dan shared trip.
- Admin memakai RBAC, MFA/step-up, audit actor/target/alasan/before-after/request ID.

Temuan yang diperbaiki: refresh rotation, approval kapasitas, stale realtime, hazard query, wiring modul.

Temuan terbuka: password reset race, blokir chat asimetris, UUID validation, pagination tie-breaker, login rate limit per akun, voice leave revocation.

## 9. Location privacy, media privacy, secret, logging, retention, deletion

- Lokasi konvoi hanya untuk member aktif; posisi dihapus saat leave/complete (sesuai implementasi dan test fase 2).
- Stale/offline adalah requirement CNV-04; bug stale sudah diperbaiki, tetapi belum diuji disconnect nyata.
- Media access memakai signature dan pengecekan visibilitas; namun byte media belum dialirkan dan signing upload belum SigV4.
- `LoggingMiddleware` mencatat method/path/status/duration/requestId, bukan body atau token. Tidak ditemukan logging plat/password/token di source yang diperiksa.
- Secret produksi belum tersedia; konfigurasi memakai env dan tidak ada hardcoded secret yang ditemukan.
- Retention/export/deletion berjalan di backend, tetapi penghapusan byte storage belum ada.
- `social.purge` dan `albums.delete` mengembalikan `objectKeys` tanpa consumer storage; ini H-03.

## 10. Database, index, migrasi, geospatial, N+1, consistency

- Migrasi `0001` sampai `0007` berurutan dan lulus pada PGlite + PostGIS.
- Index yang diperiksa mencakup unique email/username, refresh token user, vehicle owner/primary, route geometry GiST, trip user/open, trip points `(trip_id, seq)` dan GiST, convoy member/status, message page, content report target, media owner/client, hazard GiST/active, community member/event, post timeline/author/community, comment page, dan subscription/audit.
- Query hazard menggunakan `ST_DWithin` dan GiST; setelah perbaikan query valid.
- Tidak ditemukan N+1 yang jelas pada modul yang diperiksa; beberapa query komunitas memakai loop kecil untuk seed permission, bukan loop per row data.
- PGlite hanya satu koneksi, sehingga konsistensi transaksi paralel, row lock, dan deadlock belum teruji. Ini blocker verifikasi, bukan klaim lulus.
- Migrasi memakai `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` pada beberapa perubahan, tetapi tidak ada tool rollback; production migration harus diuji pada PostgreSQL nyata dengan backup.

## 11. WebSocket access, reconnect, duplicate/out-of-order, TTL, stale

Yang sudah baik:

- Upgrade memeriksa path `/v1/realtime`, origin, dan ticket sekali pakai; ticket diambil dari store.
- Membership/role diperiksa sebelum room join; outsider tidak dapat menyamar.
- Presence dan posisi disimpan di store; event room dipublikasikan melalui hub.
- Chat memiliki idempotency `client_message_id`.
- `checkStale` sekarang mengirim stale untuk user yang disconnect.

Yang belum terverifikasi:

- reconnect setelah Redis restart atau network flap;
- urutan event posisi vs snapshot, dan penanganan event duplikat di klien;
- TTL ticket/presence/position pada Redis nyata;
- multi-instance fanout;
- stale tepat satu kali dan reset setelah posisi baru.

## 12. UX states

Bukti kode menunjukkan beberapa state sudah ada:

- Auth: loading, error, mode login/register/reset.
- Home/trips/convoy: loading, empty, error, retry, status koneksi.
- Permission dan GPS: ada penanganan izin dan error lokasi.
- Admin: loading/error pada halaman yang diperiksa.

Belum terverifikasi:

- offline/degraded end-to-end;
- stale data dan retry setelah reconnect;
- denied permission permanen;
- empty state untuk chat/hazard/favorit yang belum memiliki layar;
- aksesibilitas, kontras, dan keyboard pada admin/Android.

Karena layar P0 belum ada, UX state untuk fitur tersebut belum dapat dinilai.

## 13. Test dan coverage

| Lapisan | Yang ada | Yang kosong |
|---|---|---|
| Backend unit/integration | 35 test, termasuk auth, vehicle, route, trip, convoy/realtime, community, social, album, media metadata, billing, admin, privacy | chat/hazard/voice baru memiliki smoke wiring; tidak ada create/confirm/report chat/hazard, tidak ada voice token/leave, tidak ada race dua koneksi |
| Android unit | 14 test: GpsFilter 8, TripStateMachine 6 | tidak ada test recorder concurrency, service lifecycle, permission, UI, process death |
| Android instrumented/UI | tidak ada | FGS, background location, permission dialog, offline, recovery |
| Admin | build lulus | tidak ada unit/E2E/click-through dengan backend nyata |
| Security | `npm audit` 0, RBAC/step-up/IDOR test | tidak ada SAST/DAST, dependency scanning CI, atau test rate limit per akun |
| Storage/Redis/Play | tidak ada | S3/MinIO, Redis, LiveKit, Play Billing nyata |
| Load/performance | tidak ada | load test, battery, reconnect storm, large pagination |

Angka yang tidak boleh diklaim: cakupan persentase, jumlah user, latency produksi, atau hasil load test. Tidak ada pengukuran tersebut dalam audit ini.

## 14. Build, lint, typecheck, dependency

| Perintah | Hasil | Catatan |
|---|---|---|
| `backend npm test` | 35/35 lulus | build TypeScript + seluruh `dist/test` |
| `admin npm run build` | lulus | Next.js 16.4.6; tidak dijalankan ulang setelah perubahan backend karena tidak ada dependency lintas |
| `android ./gradlew :app:testDebugUnitTest :app:assembleDebug` | BUILD SUCCESSFUL | JDK 21 project-local, setelah perubahan Kotlin |
| `android ./gradlew :app:lintDebug` | BUILD SUCCESSFUL, 32 warning, 0 error | dijalankan ulang setelah perubahan Kotlin terakhir |
| `backend npm audit --omit=dev` | 0 vulnerability | sebelum perubahan; tidak ada dependency baru |
| `admin npm audit --omit=dev` | 0 vulnerability | sebelum perubahan |
| OpenAPI | 150 path | dihasilkan dari `AppModule` setelah perbaikan |

Tidak dijalankan: Docker build, PostgreSQL/PostGIS nyata, Redis, S3/MinIO, LiveKit, Play Billing, Android instrumented test, admin E2E, load test, backup/restore.

## 15. Remediation plan terurut berdasarkan risiko

### P0 - sebelum klaim MVP atau produksi

1. **Selesaikan media end-to-end**: SigV4 presigned upload, HEAD object pada complete, signed GET yang redirect/stream byte, dan worker penghapusan objek. Uji dengan S3/MinIO nyata. Ini menutup H-02 dan H-03.
2. **Implementasikan layar P0 Android**: chat, hazard, consent, hapus akun, avatar/foto kendaraan, favorit. Sambungkan ke endpoint yang sekarang sudah ter-mount. Uji pada perangkat. Ini menutup H-01.
3. **Tutup race auth**: password reset atomik dan test dua koneksi; rate limit login per akun. Ini menutup M-01 dan M-09.
4. **Uji gate perangkat/staging**: FGS, background location, process death, permission, offline, Redis reconnect, S3, Play Billing, admin click-through. Ini menutup H-07.

### P1 - sebelum beta publik

5. **Perbaiki blokir chat dua arah** dan tolak pengiriman dari akun yang diblokir. Ini menutup M-03.
6. **Tambahkan `ParseUUIDPipe`** pada semua parameter UUID dan test invalid ID. Ini menutup M-04.
7. **Perbaiki pagination** trip dan points dengan cursor komposit dan `limit + 1`. Ini menutup M-05.
8. **Perbaiki voice leave** agar token/partisipan dicabut. Ini menutup M-10.
9. **Rapikan policy admin** `users.ban` dan status ban. Ini menutup M-06.
10. **Ganti README root** dengan dokumentasi RiderJourney. Ini menutup M-08.

### P2 - kualitas dan operasi

11. Tambahkan test chat/hazard/voice yang lengkap, bukan hanya wiring.
12. Tambahkan Android instrumented/UI test dan CI Android.
13. Tambahkan Redis/PostgreSQL/S3 staging, load test, backup/restore, dan monitoring.
14. Tambahkan audit kebocoran secret dan logging produksi.
15. Uji aksesibilitas, kontras, dan keyboard pada admin/Android.

## 16. Status production readiness

**TIDAK production-ready.**

Alasan:

- Dua Critical sudah ditutup, tetapi H-01, H-02, H-03, dan H-07 masih terbuka.
- Acceptance gate perangkat, storage nyata, Redis nyata, Play Billing, dan admin click-through belum dijalankan.
- Test suite backend lulus, tetapi tidak membuktikan pipeline media, race multi-koneksi, atau lifecycle Android.

Yang boleh diklaim setelah audit ini:

- Endpoint chat, hazard, dan voice ter-mount dan muncul di OpenAPI.
- `node tools/junk-check.mjs` melaporkan 0 baris mencurigakan pada 205 berkas.
- `GET /v1/hazards/nearby` tidak lagi 500 pada test.
- Refresh rotation dan approval kapasitas memakai lock transaksi.
- Stale realtime tidak lagi melewatkan user yang disconnect.
- Recorder GPS Android diserialisasi dan sesi paused tidak menyalakan GPS setelah restart.
- Backend 35/35 test, Android build/test lulus dengan JDK 21.

Yang tidak boleh diklaim:

- Media upload/display siap produksi.
- Penghapusan akun menghapus seluruh byte media.
- Aplikasi siap produksi atau MVP acceptance sudah lulus.
- Race condition sudah teruji pada PostgreSQL/Redis nyata.
- Admin dan aplikasi Android sudah di-click-through.

## 17. Lampiran: perintah reproduksi utama

```bash
# Backend
cd backend
npm test
npm run openapi

# Android (JDK 21 project-local)
cd android
JAVA_HOME="$PWD/.tooling/jdk-21.0.13.1+2" \
  ./gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon
JAVA_HOME="$PWD/.tooling/jdk-21.0.13.1+2" \
  ./gradlew :app:lintDebug --no-daemon

# Dependency
cd backend && npm audit --omit=dev
cd admin && npm audit --omit=dev
```

Reproduksi hazard setelah perbaikan:

```bash
curl -i -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/hazards/nearby?lat=-6.2&lng=106.8"
# harus 200 dan { "items": [] } bila belum ada hazard
```

Reproduksi wiring chat/voice setelah perbaikan:

```bash
curl -i -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/convoys/0192f3a0-0000-7000-8000-000000000000/messages"
# harus 404 domain CONVOY_NOT_FOUND, bukan 404 route
```

## 18. Catatan audit

- Tidak ada commit atau push yang dilakukan.
- Perbaikan hanya menyentuh bug yang jelas dan regression test; tidak ada fitur baru.
- Temuan yang memerlukan S3, Redis, PostgreSQL nyata, perangkat, atau Play Console ditandai Blocked, bukan dianggap lulus.
- Laporan ini tidak menggantikan penetration test, load test, atau uji perangkat.
