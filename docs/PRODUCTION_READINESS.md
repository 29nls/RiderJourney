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
