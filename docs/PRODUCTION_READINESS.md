# Production Readiness Checklist

Tanggal: 24 November 2026. Lingkup: backend Phase 5, konsol admin Next.js, dan operasi yang tersedia di workspace ini. Tidak ada commit atau push.

Status: **BELUM SIAP PRODUKSI**. Backend lulus 36 test dan admin lulus build, tetapi verifikasi Google Play nyata, legal, staging, load test, backup/restore, signing Android, dan monitoring produksi masih BLOCKED. Temuan rinci ada di `docs/AUDIT_REPORT_PHASE_5.md`.

## Legend

- **LULUS**: dijalankan dan diverifikasi pada workspace ini.
- **SEBAGIAN**: kode tersedia, tetapi hanya diuji dengan provider palsu atau database lokal.
- **BLOCKED**: butuh akses, akun, atau keputusan di luar workspace.
- **BELUM**: belum dikerjakan.

## 1. Build dan migrasi

- [x] **LULUS** `cd backend && npx tsc -p tsconfig.json --noEmit` exit 0.
- [x] **LULUS** `cd backend && npm test` 36 test lulus, 0 gagal.
- [x] **LULUS** Migrasi `0001` sampai `0008` berurutan pada PGlite + PostGIS.
- [x] **LULUS** `cd admin && npm run build` sukses (Next.js 16.4.6).
- [x] **LULUS** `node backend/tools/junk-check.mjs` 0 baris mencurigakan pada 205 berkas.
- [x] **LULUS** OpenAPI diregenerasi, 151 path.
- [ ] **BLOCKED** Uji pada PostgreSQL 16/17 + PostGIS 3.x nyata. Workspace hanya memakai PGlite.
- [ ] **BLOCKED** Uji container/image build. Docker tidak tersedia.

## 2. Google Play Billing dan langganan

- [x] **LULUS** Harga tidak disimpan di backend. `plans` hanya menyimpan product id, limits, dan features.
- [x] **LULUS** Default `BILLING_ENABLED=false`, `PAID_FEATURES_ENABLED=false`, dan seed paket berbayar `billing_enabled=false`.
- [x] **LULUS** Verifikasi server memakai Android Publisher `subscriptionsv2`; token tidak pernah dipercaya dari state klien.
- [x] **LULUS** Anti-replay: hash token unik, token terikat satu akun, linked purchase token diperiksa.
- [x] **LULUS** Status aktif, grace, canceled, paused, on_hold, expired, pending disimpan dan entitlement dihitung ulang tiap request.
- [x] **LULUS** Renewal, restore, dan rekonsiliasi memakai verifikasi provider; raw token disimpan terenkripsi untuk rekonsiliasi.
- [x] **LULUS** RTDN idempoten berdasarkan `messageId`, dengan autentikasi secret.
- [ ] **BLOCKED** Verifikasi Google Play nyata. Butuh Play Console, package name final, produk/base plan aktif, service account dengan akses Android Publisher, dan akun uji license tester.
- [ ] **BLOCKED** RTDN nyata. Butuh Pub/Sub topic, push subscription, URL HTTPS staging, dan kebijakan OIDC gateway.
- [ ] **BLOCKED** Uji refund, chargeback, grace period, dan account hold dari provider nyata.
- [ ] **BLOCKED** Keputusan harga, trial, dan pajak. Harga hanya ditampilkan Play; backend tidak boleh mengarang nominal.

## 3. Entitlement dan batas fitur

- [x] **LULUS** Kapasitas konvoi dibaca dari plan server dan dibatasi `CONVOY_CAPACITY_MAX`.
- [x] **LULUS** Kuota album baru memakai plan, bukan `ALBUM_QUOTA_BYTES_DEFAULT`.
- [x] **LULUS** Jumlah kendaraan ditegakkan di transaksi; kelebihan menghasilkan `VEHICLE_LIMIT_REACHED`.
- [x] **LULUS** Grant template poster digabung ke entitlement, bukan dipercaya dari klien.
- [x] **LULUS** Kill switch admin membuat akun kembali ke paket free walaupun baris langganan masih ada.
- [ ] **BELUM** Android belum membaca `GET /v1/subscription` untuk menampilkan paket dan batas. Klien lama belum memakai entitlement baru.
- [ ] **BLOCKED** Harga dan penawaran final belum disetujui produk/legal.

## 4. Redeem dan ledger

- [x] **LULUS** Kode disimpan sebagai HMAC dengan pepper, plaintext hanya dikembalikan sekali.
- [x] **LULUS** Kuota, expiry, dan status aktif diperiksa di dalam transaksi dengan row lock.
- [x] **LULUS** Satu kode hanya sekali per akun; idempotency key unik per akun.
- [x] **LULUS** Poin masuk ke `point_ledger` immutable dengan referensi redeem.
- [x] **LULUS** Admin dapat membuat, melihat, dan menonaktifkan kode dengan audit before/after dan alasan.
- [ ] **BELUM** UI redeem di Android belum ada.
- [ ] **BLOCKED** Kebijakan pajak/nilai poin dan syarat promo belum ditinjau legal.

## 5. Admin dan RBAC

- [x] **LULUS** Empat peran server-side: support, moderator, admin, superadmin.
- [x] **LULUS** Permission map diperiksa di service, bukan hanya di UI.
- [x] **LULUS** MFA TOTP, enrollment, konfirmasi, dan step-up JWT ber-audience admin.
- [x] **LULUS** Step-up wajib pada perubahan pengguna, laporan, post, komunitas, grant langganan, redeem, konfigurasi, dan job.
- [x] **LULUS** Audit menyimpan aktor, aksi, target, alasan, before, after, dan request id.
- [x] **LULUS** Bootstrap admin lewat CLI setelah akun terdaftar.
- [x] **LULUS** Admin web memiliki section pengguna, laporan, moderasi, langganan, redeem, konfigurasi, dan audit.
- [ ] **SEBAGIAN** Build admin lulus, login page dan shell dapat disajikan, tetapi klik-through browser dan uji dua peran end-to-end belum dijalankan.
- [ ] **BLOCKED** Hosting admin produksi, domain, TLS, SSO perusahaan, dan rate limit di edge belum ada.
- [ ] **BLOCKED** Review desain. Repo tidak punya `DESIGN.md`; UI diberi label draft without direction.

## 6. Privacy dan retensi

- [x] **LULUS** User dapat meminta data export, mengunduh sekali setelah job selesai, dan melihat masa berlaku.
- [x] **LULUS** Penghapusan akun memakai konfirmasi `HAPUS AKUN`, grace period, pembatalan, dan pencabutan refresh token.
- [x] **LULUS** Job retensi menghapus payload export kedaluwarsa, notifikasi billing lama, event billing lama, dan grant kedaluwarsa.
- [x] **LULUS** Akun dihapus secara pseudonim: PII dihapus, konten dan komunitas miliknya dihapus, catatan billing/audit yang wajib disimpan dipertahankan.
- [ ] **BLOCKED** Review legal atas retensi billing, audit, dan pengecualian penghapusan.
- [ ] **BLOCKED** Privacy Policy dan Terms of Service final.
- [ ] **BLOCKED** Bukti backup tidak menghidupkan kembali akun yang sudah dihapus. Butuh uji restore nyata.

## 7. Keamanan dan operasi

- [x] **LULUS** Rate limit global 120/menit dan limit khusus login, redeem, MFA, serta endpoint sensitif lain.
- [x] **LULUS** Log request tidak memuat body, query, token, atau koordinat. Error log memakai redaksi untuk token, secret, dan password.
- [x] **LULUS** Secret Phase 5 dibaca dari environment dan tidak masuk bundle admin.
- [x] **LULUS** Script backup/restore dan CI backend/admin tersedia.
- [ ] **BLOCKED** Secret manager produksi dan rotasi berkala belum dikonfigurasi.
- [ ] **BLOCKED** Alerting dan monitoring belum terhubung. Tidak ada Sentry, Prometheus, atau log sink produksi.
- [ ] **BLOCKED** Backup dan restore belum dieksekusi; butuh PostgreSQL dan object storage nyata.
- [ ] **BLOCKED** CSP admin masih memakai `'unsafe-inline'` untuk script. Perlu nonce atau edge proxy sebelum produksi.
- [ ] **BLOCKED** Uji penetrasi dan review dependency belum dijalankan.

## 8. Performance

- [x] **LULUS** Ada harness `backend/tools/load-test.mjs` untuk API, PostGIS, media intent, konvoi, WebSocket, dan fanout lokasi.
- [x] **LULUS** Test fungsional PRD 30 anggota WebSocket lulus.
- [ ] **BLOCKED** Load test staging belum dijalankan. Tidak ada staging, Redis, atau database produksi.
- [ ] **BLOCKED** Target p95, error rate, dan kapasitas instance belum diukur.

## 9. Release, signing, dan rollback

- [x] **LULUS** CI backend/admin ditambahkan di `.github/workflows/ci.yml`; belum dijalankan di GitHub.
- [x] **LULUS** Runbook deploy, incident, dan rollback tersedia.
- [ ] **BLOCKED** Keystore Android, Play App Signing, dan jalur signing belum ada.
- [ ] **BLOCKED** Crash monitoring Android belum terpasang.
- [ ] **BLOCKED** Kebijakan versi minimum belum ditegakkan di Android. Endpoint config tersedia, klien belum membacanya.
- [ ] **BLOCKED** Staged rollout Play dan rollback build belum diuji.

## 10. Gate sebelum mengaktifkan fitur berbayar

Semua harus benar sebelum `BILLING_ENABLED` dan `PAID_FEATURES_ENABLED` menjadi true:

1. Terms, Privacy Policy, kebijakan refund, dan kontak dukungan disetujui legal.
2. Produk subscription dan base plan aktif di Play Console, termasuk license tester.
3. Service account dan akses Android Publisher diverifikasi di staging.
4. RTDN dan rekonsiliasi terbukti menangani renewal, cancel, grace, hold, refund.
5. Load test staging lulus dengan batas error yang disepakati.
6. Backup/restore dan penghapusan akun diuji pada salinan produksi.
7. Alerting untuk error billing, antrean laporan, dan job gagal aktif.
8. Admin produksi memakai TLS, MFA, rate limit edge, dan secret manager.
9. Android membaca entitlement dari server dan tidak menyimpan harga atau plan.
10. Rencana rollback dan komunikasi pelanggan disetujui.

Sampai semua terpenuhi, biarkan kedua switch false.

## 11. Phase 6 — hasil audit integrasi (26 November 2026)

Status keseluruhan tidak berubah: **BELUM SIAP PRODUKSI**.

Bukti yang dijalankan ulang pada Phase 6:

- [x] **LULUS** `cd backend && npm run typecheck` exit 0.
- [x] **LULUS** `cd backend && npm test` **40 test lulus, 0 gagal** (37 lama + 3 regresi Phase 6).
- [x] **LULUS** `cd admin && npm run build` exit 0.
- [x] **LULUS** `cd android && ./gradlew testDebugUnitTest` **16 test lulus, 0 gagal** (JDK 21).
- [x] **LULUS** `cd android && ./gradlew assembleDebug` menghasilkan `app-debug.apk`.
- [x] **LULUS** `npm audit --omit=dev` di backend dan admin: 0 kerentanan.
- [x] **LULUS** CI GitHub run #3 pada `main` hijau (backend dan admin).
- [x] **LULUS** CI GitHub run #4 pada `main` hijau untuk backend, admin, dan android (Java 21).

Perbaikan keamanan Phase 6:

- [x] **LULUS** Konfirmasi reset kata sandi mengonsumsi token di dalam `UPDATE ... WHERE used_at IS NULL RETURNING`, sehingga dua permintaan bersamaan tidak dapat sama-sama menang. Diuji.
- [x] **LULUS** Batas login per akun (`login_throttles`): 10 kegagalan dalam 15 menit mengunci 15 menit, dihitung per email, bukan per IP. Diuji.
- [x] **LULUS** Parameter UUID divalidasi sebagai 400 `INVALID_ID`, bukan 500 dari cast PostgreSQL. Diuji pada chat dan bahaya.

Temuan baru yang **belum** diperbaiki (jangan dianggap selesai):

- [ ] **P0** Presigned upload di `media.service.ts` menandatangani string dengan HMAC sederhana, bukan SigV4 kanonikal. URL yang dihasilkan tidak akan diterima S3/MinIO sungguhan. Tidak diuji terhadap storage nyata.
- [ ] **P0** `POST /v1/media/uploads/{id}/complete` mempercayai `sizeBytes` dari klien; tidak ada `HEAD` objek, tidak ada verifikasi ukuran/MIME/checksum dari storage, dan baris `size_bytes` diturunkan dari nilai klien.
- [ ] **P0** Penghapusan akun belum terbukti menghapus byte objek di storage; tidak ada worker outbox penghapusan objek yang diuji.
- [ ] **BLOCKED** Uji end-to-end media dengan MinIO/S3: tidak ada endpoint, kredensial, atau container.
- [ ] **BLOCKED** Uji perangkat Android: tidak ada emulator/perangkat yang menjalankan build ini; FGS, izin lokasi, process death, dan offline belum diuji.
- [ ] **BLOCKED** Redis nyata, LiveKit, staging, dan Play Billing tetap seperti sebelumnya.

## 12. Phase 6.1 — media pipeline (26 November 2026)

Status keseluruhan tetap **BELUM SIAP PRODUKSI**, tetapi P0 media yang terbuka pada Phase 6 sudah ditutup pada level kode dan diuji terhadap server S3-compatible sungguhan.

Yang berubah:

- [x] **LULUS** Presigned PUT memakai AWS SDK v3 dengan SigV4 kanonikal, bukan HMAC buatan sendiri. Diuji dengan server S3 nyata: signature valid, signature diubah → `403`, `content-type` berbeda → `403`.
- [x] **LULUS** Key objek dibuat server (`media/{ownerId}/{mediaId}.{ext}`); tidak ada input klien di path.
- [x] **LULUS** `complete` tidak lagi menerima `sizeBytes`/file dari klien. `HEAD` memverifikasi keberadaan, panjang, dan tipe; SHA-256 dihitung server dari stream; magic bytes diperiksa. Ukuran salah, tipe salah, checksum salah, dan objek hilang semuanya ditolak `409`.
- [x] **LULUS** Penyelesaian idempoten (`ready` kedua → `duplicate: true`) dan tidak dapat berpindah status dari `rejected`/`deleted`.
- [x] **LULUS** Outbox `media_deletion_outbox` + worker `SKIP LOCKED`; penghapusan diverifikasi dengan `HEAD`, objek yang sudah hilang dianggap sukses, kegagalan transien di-retry dengan backoff, baris gagal menjadi `failed`.
- [x] **LULUS** Penghapusan akun dan purge sosial memasukkan key objek ke outbox dalam transaksi yang sama.
- [x] **LULUS** Uji integrasi storage: 11 kasus pada server S3-compatible nyata.
- [x] **LULUS** `npm test` tetap 40 lulus, 0 gagal (11 uji integrasi di-skip tanpa storage).
- [x] **LULUS** `npm run build` admin tidak terpengaruh kontrak backend.

Yang **belum** selesai:

- [ ] **BLOCKED** Verifikasi terhadap AWS S3 produksi (bucket policy, Block Public Access, IAM least-privilege, TLS, biaya). Hanya S3-compatible (SeaweedFS) yang diuji.
- [ ] **BLOCKED** MinIO sebagai target uji: server open-source MinIO sudah diarsipkan dan tidak lagi didistribusikan (`dl.min.io` → HTTP 410, repositori Docker Hub hilang).
- [ ] Belum ada lifecycle untuk intent `pending` yang ditinggalkan (objek yatim) atau pemindaian malware.
- [ ] Android belum memiliki layar unggah media; kontrak baru belum dipakai klien mana pun.

## 13. Phase 6.2 — storage lifecycle dan Android media (27 November 2026)

Legend: PASS = diverifikasi dengan bukti yang dijalankan; BLOCKED = butuh
environment/kredensial/provider yang tidak tersedia; FAIL = gagal.

| Butir | Status | Bukti / catatan |
| --- | --- | --- |
| Pembersihan intent kedaluwarsa | PASS | `cleanupExpired()` + 3 test (`phase6_2.test.ts`) |
| Orphan object dibersihkan | PASS | HEAD → CAS → outbox dalam satu transaksi |
| Race complete vs expiration | PASS | test khusus; hasil selalu penolakan tunggal |
| Race complete vs deletion | PASS | objek hilang → `409 MEDIA_OBJECT_MISSING` |
| Worker periodik | PASS | `startScheduled()` dari `main.ts`, test scheduler |
| Multi-instance aman | PASS | `SKIP LOCKED` + test dua worker |
| Dead-letter dapat dimonitor | PASS | `status().failed` + test batas percobaan |
| Kuota konsisten | PASS | CAS reservasi + `reconcile`, test 6 intent paralel |
| Otorisasi unduh | PASS | capability URL terikat id+expiry, test lintas media |
| Migrasi 0011 | PASS | dijalankan `runMigrations` pada setiap suite |
| Android: upload intent/PUT/complete | PASS | `MediaRepository` + kontrak backend |
| Android: header presigned | PASS | `MediaUploadRequest` hanya 2 header, unit test |
| Android: SHA-256 streaming | PASS | `MediaChecksum`, vektor `abc` + payload > buffer |
| Android: state Room + WorkManager | PASS | `MediaUploadDao`, `MediaUploadWorker` |
| Android lint + unit test + debug build | PASS | Gradle `lintDebug testDebugUnitTest assembleDebug` |
| Storage integration (SeaweedFS 4.55) | PASS (CI) | job `media-integration`, bukan dijalankan lokal |
| AWS S3/IAM/STS nyata | BLOCKED | tidak ada kredensial AWS di environment ini |
| Antivirus/CSAM/moderation provider | BLOCKED | belum ada provider; media tetap `unscanned` |
| Instrumented test Android (emulator) | BLOCKED | tidak ada emulator/perangkat |

Environment yang dibutuhkan untuk build Android lokal: JDK 21 (AGP 8.11 menolak
JDK 25). CI memakai `temurin 21`. Di mesin ini JDK 21 dipasang di
`android/.tooling/` (gitignored) karena hanya JDK 8 dan 25 yang tersedia.

## 14. Phase 6.3 — penghapusan, observability, dan scanning (27 November 2026)

| Butir | Status | Bukti |
| --- | --- | --- |
| Endpoint `DELETE /v1/media/:id` | PASS | `media.controller.ts` + 4 test |
| Penegakan kepemilikan | PASS | non-owner → `404`, anonim → `401` |
| Deteksi referensi | PASS | 8 tabel + album, `409 MEDIA_IN_USE` |
| Penggantian avatar aman | PASS | transaksi + `detachAndRelease` + test |
| Penggantian foto kendaraan aman | PASS | test `vehicle` + detach |
| Outbox transaksional | PASS | CAS + insert satu transaksi |
| Verifikasi penghapusan objek | PASS | `HEAD` setelah `delete` |
| Double deletion idempoten | PASS | test khusus |
| Kuota dilepas setelah objek hilang | PASS | `usedBytes` termasuk `deleting` |
| Endpoint admin health | PASS | `/v1/admin/media/workers` |
| Endpoint dilindungi admin | PASS | `AdminGuard`; user biasa 401/403 |
| Dead-letter & antrean terlihat | PASS | `health()` |
| Scanner adapter nyata | PASS | `ClamAvMediaScanner` (protokol INSTREAM) |
| Uji terhadap clamd nyata | BLOCKED | tidak ada Docker/daemon ClamAV di mesin ini |
| Scanner gagal ≠ clean | PASS | test `scan_failed` + attempt limit |
| Karantina | PASS | `quarantined` tidak dapat diakses publik |
| Media publik fail-closed | PASS | non-owner butuh `scan_status = 'clean'` |
| Provider content moderation | BLOCKED | belum ada provider/kredensial |
| Android: hapus/ganti avatar | PASS | PATCH `avatarMediaId` + release server-side |
| Android: hapus/ganti foto kendaraan | PASS | PATCH `photoMediaId` + release |
| Android: kuota tampil | PASS | `refreshQuota()` + ProfileScreen |
| Android: video upload | BLOCKED | belum ada layar composer posting/album di Android |
| Device/emulator test | BLOCKED | tidak ada emulator/perangkat |
| GitHub Actions hijau | BLOCKED | workflow belum dijalankan pada perubahan ini |

Environment scanning: `MEDIA_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`
(default 3310), `CLAMAV_TIMEOUT_MS`, `MEDIA_SCAN_MAX_ATTEMPTS`,
`MEDIA_SCAN_POLL_SECONDS`, `MEDIA_SCAN_BATCH_SIZE`, `MEDIA_SCAN_RETRY_SECONDS`.
Tanpa `MEDIA_SCANNER=clamav` dan host yang dapat dijangkau, media tetap
`unscanned` dan tidak pernah disajikan ke pengguna lain.

## 15. Phase 6.4 — reliability dan verifikasi (27 November 2026)

| Area | Status | Bukti |
| --- | --- | --- |
| Pemulihan baris `deleting` macet | PASS | `phase6_4.test.ts` (requeue vs `deleted`, kuota tetap ditahan) |
| Lease & retry worker penghapusan | PASS | `phase6_4.test.ts`, `phase6_3.test.ts` |
| Pembatalan sebelum klaim | PASS | `phase6_4.test.ts` (200 → `ready`, job ditarik) |
| Pembatalan setelah klaim / selesai | PASS | `409` dengan kode berbeda |
| Dead-letter: daftar, retry, audit | PASS | `phase6_4.test.ts` |
| Moderasi terpisah dari scanning | PASS | `phase6_4.test.ts` (`scan_status` tidak berubah) |
| Kebijakan visibilitas ganda | PASS | `phase6_4.test.ts` (clean tapi belum ditinjau → 404) |
| Admin queue + preview aman + riwayat | PASS | build admin, review manual belum dilakukan |
| Alert dedup, cooldown, recovery | PASS | `phase6_4.test.ts` |
| Pengiriman notifikasi eksternal | BLOCKED | tidak ada provider/kredensial; `available() === false` |
| ClamAV daemon nyata (1.4.7, Windows) | PASS (lokal) | 10/10 test `clamav.integration.test.ts` lulus; EICAR terdeteksi, karantina, retry, lease recovery |
| SeaweedFS 4.55 (lokal) | PASS (lokal) | 11/11 test `media.integration.test.ts` lulus; SigV4, HEAD, SHA-256, GET, delete, retry |
| ClamAV daemon nyata (CI image 1.4.2) | BLOCKED | workflow ditulis, belum dieksekusi; versi berbeda dari lokal |
| SeaweedFS di CI | BLOCKED | workflow ditulis, belum dieksekusi |
| AWS S3 produksi | BLOCKED | tidak diuji, tidak diklaim |
| Device/emulator Android | BLOCKED | tidak ada emulator; instrumented test disiapkan |
| Video upload Android | BLOCKED | belum ada layar composer; backend siap |
| AWS S3 produksi | BLOCKED | tidak diuji, tidak diklaim |

Yang **tidak** boleh diklaim dari fase ini: pemindaian malware terbukti bekerja
di mesin pengembang, notifikasi benar-benar terkirim, moderasi otomatis aktif,
atau kesiapan produksi AWS.

## 13. Phase 6.5.2 — verifikasi perangkat Android (28 November 2026)

- [x] **LULUS** Emulator API 34 dan API 36 boot di CI (`sys.boot_completed=1`)
  dan menjalankan 26 instrumented test, semuanya lulus di kedua API.
  Run `46097769865` (run #23), commit `eb8ee59`.
- [x] **LULUS** Gate hasil test berbasis manifest: report kosong, test hilang,
  skip, gagal, atau manifest yang tidak cocok dengan sumber membuat job merah.
- [ ] **BELUM** Matriks status scan (unscanned/clean/quarantined/pending/
  approved/rejected) untuk penonton selain pemilik: job E2E belum menjalankan
  ClamAV, dan pemilik selalu bisa membaca medianya sendiri.
- [ ] **BELUM** Process death, WorkManager recovery, gangguan jaringan, dan
  kuota habis di perangkat.
- [ ] **BLOCKED** FGS/lokasi latar belakang di perangkat, Play Billing,
  staging, dan AWS nyata — tidak berubah dari Phase 6.1–6.5.1.

Status keseluruhan tetap **BELUM SIAP PRODUKSI**. Detail: `PHASE_6_5_2_REPORT.md`.
