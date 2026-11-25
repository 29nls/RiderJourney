# PHASE 5 REPORT: Subscription, Rewards Administration, Admin Console, Security, dan Production Readiness

Tanggal: 24 November 2026. Status: **backend dan build admin selesai untuk lingkup yang dapat diverifikasi di workspace**, dengan BLOCKER eksternal yang dicatat di bagian 8. Tidak ada commit atau push.

## 1. Ringkasan hasil verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `cd backend && npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `cd backend && npm test` | **29 test, 29 pass, 0 fail, exit 0** |
| Test baru Phase 5 | **6 test** di `phase5.test.ts` |
| `node backend/tools/junk-check.mjs` | 0 baris mencurigakan pada 200 berkas |
| Migrasi | `0001` sampai `0007`, termasuk 7 berkas di setiap assertion |
| OpenAPI | diregenerasi, **134 path** |
| `cd admin && npm run build` | sukses, Next.js 16.4.6 |
| `GET /login` pada dev server admin | HTTP 200, form email dan kata sandi dirender |
| Google Play nyata | **tidak diuji**, BLOCKED |
| RTDN Pub/Sub nyata | **tidak diuji**, BLOCKED |
| Load test staging | **tidak dijalankan**, harness tersedia |
| Browser admin klik-through | **tidak dijalankan** |
| Android | **tidak diubah** pada fase ini |

## 2. Lingkup yang diimplementasikan

| # | Requirement | Implementasi | Bukti |
|---|---|---|---|
| 1 | Google Play Billing dan verifikasi purchase di backend | `GooglePlayVerifier` memanggil Android Publisher `purchases.subscriptionsv2` dengan service account JWT atau access token. `PURCHASE_VERIFIER` dapat diganti fake pada test. Endpoint verify, restore, dan notifikasi tersedia. | `src/billing/*`, `phase5.test.ts` |
| 2 | Status subscription server-side | Tabel `subscriptions` menyimpan plan, produk, base plan, status, auto-renew, expiry, grace, dan waktu verifikasi. Renewal dan refund dikoreksi lewat rekonsiliasi provider. Cancel tetap punya akses sampai expiry. `paused`/`on_hold` tidak memberi entitlement. | `billing.service.ts`, `plan.service.ts` |
| 3 | Feature limits dari server | `PlanService` menghitung entitlement dari plan, subscription, grant, dan override. Kapasitas konvoi, kuota album, batas kendaraan, dan template poster memakai nilai server. Tidak ada harga atau limit dari klien. | `src/entitlements/*`, `convoys`, `albums`, `vehicles` |
| 4 | Redeem code | HMAC dengan pepper, prefix, kuota, expiry, status, satu kode sekali per akun, idempotency key, row lock, ledger poin immutable, grant langganan/template. Plaintext hanya sekali. | `src/redeem/*`, migrasi `0007` |
| 5 | Admin web Next.js | Section pengguna, laporan, moderasi post/komunitas, langganan, redeem, konfigurasi, audit, dan ringkasan antrean. Aksi memakai form alasan dan step-up. | `admin/*` |
| 6 | RBAC, MFA, audit | Empat peran, permission map server-side, TOTP murni Node crypto, step-up JWT audience admin, audit before/after dengan alasan dan request id. | `src/admin/*` |
| 7 | Privacy, export, deletion, retention | Job export dengan payload dan expiry, unduhan terautentikasi, permintaan hapus dengan grace, pembatalan, penyamaran PII, penghapusan konten, job retensi. | `src/ops/*`, endpoint `/v1/privacy/*` |
| 8 | Rate limit, secret, backup, redaksi, monitoring | Throttler global dan limit endpoint sensitif; secret Phase 5 di environment; script backup/restore; redaksi log; query dan target alert di runbook. | `app.module.ts`, `common/redact.ts`, `ops/*`, `docs/RUNBOOK.md` |
| 9 | Load test | Harness API, PostGIS, media intent, convoy, WebSocket, dan fanout lokasi. Test fungsional 30 anggota lulus. | `tools/load-test.mjs`, `phase2.test.ts` |
| 10 | Release dan rollback | CI backend/admin, runbook deploy, incident/rollback, readiness checklist. | `.github/workflows/ci.yml`, `docs/PRODUCTION_READINESS.md`, `docs/INCIDENT_ROLLBACK.md` |

## 3. Endpoint baru

Pengguna:

- `GET /v1/subscription`
- `GET /v1/billing/catalog`
- `POST /v1/billing/verify`
- `POST /v1/billing/restore`
- `POST /v1/billing/notifications` (webhook dengan secret)
- `POST /v1/redeem`
- `GET /v1/me/redemptions`
- `POST /v1/privacy/export`, `GET /v1/privacy/export`, `GET /v1/privacy/export/{id}`
- `POST /v1/privacy/deletion`, `GET /v1/privacy/deletion`, `DELETE /v1/privacy/deletion/{id}`

Admin:

- `GET /v1/admin/me`
- `POST /v1/admin/mfa/enroll`, `POST /v1/admin/mfa/confirm`, `POST /v1/admin/mfa/step-up`
- `GET /v1/admin/dashboard`
- `GET /v1/admin/users`, `GET /v1/admin/users/{id}`, `PATCH /v1/admin/users/{id}/status`
- `GET /v1/admin/reports`, `PATCH /v1/admin/reports/{id}`
- `GET /v1/admin/posts`, `PATCH /v1/admin/posts/{id}`
- `GET /v1/admin/communities`, `PATCH /v1/admin/communities/{id}`
- `GET /v1/admin/subscriptions`, `POST /v1/admin/subscriptions/grant`
- `GET /v1/admin/redeem`, `POST /v1/admin/redeem`, `POST /v1/admin/redeem/{id}/disable`
- `GET /v1/admin/config`, `PUT /v1/admin/config`
- `GET /v1/admin/audit`
- `GET /v1/admin/jobs`, `POST /v1/admin/jobs/retention`, `POST /v1/admin/jobs/billing-reconcile`

## 4. Data dan migrasi

`migrations/0007_phase5.sql` menambah:

- `plans` dengan seed free, pro, pro_plus. Harga tidak disimpan; semua paket berbayar `billing_enabled=false`.
- `billing_products`, `subscriptions`, `billing_purchases`, `billing_notifications`, `billing_events`.
- `user_grants`, `redeem_codes`, `redeem_redemptions`.
- `admin_users`, `admin_audit_logs`, `admin_config` dengan seed `features`, `app_version`, `retention`.
- `data_export_jobs`, `data_deletion_requests`, `job_runs`.
- Kolom moderasi komunitas dan laporan, serta `user_entitlements.extra`.
- Constraint `point_ledger` diperluas untuk `redeem_bonus` dan reference `redeem`.

Token pembelian tidak disimpan sebagai plaintext. Hash dipakai untuk lookup; ciphertext hanya untuk rekonsiliasi. Ledger poin tidak diubah atau dihapus oleh alur redeem.

## 5. Invarian yang diuji

- Verifikasi pembelian memberi plan Pro dari server; replay token yang sama oleh akun lain ditolak `PURCHASE_ALREADY_BOUND`.
- Replay token oleh akun yang sama mengembalikan `duplicate: true` tanpa baris ganda.
- Notifikasi billing dengan secret salah ditolak 401; `messageId` yang sama tidak diproses dua kali.
- Akun free hanya dapat membuat 3 kendaraan; kendaraan keempat ditolak `VEHICLE_LIMIT_REACHED`.
- Support dapat membaca dashboard tetapi tidak dapat mengubah status pengguna; step-up wajib untuk aksi sensitif.
- Kode redeem dengan kuota 1 hanya memberi poin sekali; retry idempotency mengembalikan hasil lama; akun lain mendapat `REDEEM_QUOTA_EXHAUSTED`.
- Ledger hanya berisi satu baris `redeem_bonus` sebesar 100; audit `redeem.create` menyimpan alasan.
- Export menghasilkan payload profil; setelah `execute_after` lewat, job retensi menyamarkan email/username dan menandai akun `deleted`; access token lama ditolak.
- Kill switch admin mematikan verify dan mengembalikan entitlement ke free tanpa menghapus baris langganan.
- Migrasi berurutan pada PGlite + PostGIS, termasuk constraint dan seed.

## 6. Admin web

- Next.js App Router, React 19, tanpa framework UI tambahan.
- Login memakai route handler server-side; access dan refresh token di cookie `HttpOnly`. Browser tidak pernah menerima URL backend.
- Proxy `/api/admin/*` meneruskan access token, step-up token, dan request id; refresh otomatis sekali.
- Ringkasan menampilkan antrean laporan nyata dan jejak admin, bukan angka palsu.
- Setiap tabel memakai kolom yang relevan dengan keputusan operator, bukan kolom template.
- Empty, loading, dan error state menyebut sebab dan tindakan berikutnya.
- Mobile memakai rail yang berubah menjadi navigasi horizontal, tabel dapat digulir di dalam wadah, dan target sentuh minimal 42-44 px.
- UI diberi label **draft without direction** karena repo tidak memiliki `DESIGN.md` atau brand guide. Dials: ENERGY 1 / RHYTHM 1 / MOTION 1. Ini bukan deliverable visual final.
- Build lulus. Login page disajikan HTTP 200 dan form dirender. Alur login, MFA, dan aksi admin dengan backend nyata belum diuji klik-through.

## 7. Perbaikan dan berkas utama

Perbaikan di luar modul baru:

- Enam assertion migrasi lama diperbarui dari 6 menjadi 7 berkas, termasuk `phase4.social.test.ts` dan `phase4.replay.test.ts`.
- `PlanService` menggantikan pembacaan langsung `user_entitlements.convoy_capacity` pada `EntitlementService`.
- `AlbumsService` tidak lagi memberi kuota dari `ALBUM_QUOTA_BYTES_DEFAULT` saat membuat album baru.
- `VehiclesService.create` menegakkan batas kendaraan di dalam transaksi.
- `ProblemFilter` memakai redaksi untuk pesan dan stack error.
- Status `paused` dan `on_hold` tidak lagi dianggap entitled.

Berkas utama:

- `backend/migrations/0007_phase5.sql`
- `backend/src/entitlements/*`
- `backend/src/billing/*`
- `backend/src/redeem/*`
- `backend/src/admin/*`
- `backend/src/ops/*`
- `backend/src/common/redact.ts`
- `backend/tools/load-test.mjs`
- `admin/*`
- `ops/backup.sh`, `ops/restore.sh`
- `.github/workflows/ci.yml`
- `docs/PRODUCTION_READINESS.md`, `docs/INCIDENT_ROLLBACK.md`, `docs/RUNBOOK.md`

## 8. BLOCKER eksplisit

| ID | Blocker | Dampak | Yang dibutuhkan |
|---|---|---|---|
| B1 | Tidak ada akses Play Console, produk subscription aktif, service account, dan license tester | Verifikasi Google Play nyata, renewal, refund, grace, dan restore tidak dapat diuji | Akses Play Console, package name final, service account dengan Android Publisher, akun uji |
| B2 | Tidak ada gateway OIDC untuk Pub/Sub | RTDN produksi tidak aman dengan shared secret header saja | Cloud Run/Worker/reverse proxy yang memvalidasi OIDC lalu menyuntikkan secret |
| B3 | Tidak ada staging dengan PostgreSQL, Redis, dan object storage | Load test, backup/restore, dan uji end-to-end tidak dapat dijalankan | Environment staging dan kredensial terpisah dari produksi |
| B4 | Tidak ada secret manager produksi | Rotasi dan isolasi secret belum terbukti | Secret manager, kebijakan akses, prosedur rotasi |
| B5 | Tidak ada alerting/monitoring produksi | Insiden billing atau job gagal tidak otomatis memberi sinyal | APM/log sink, dashboard, aturan alert |
| B6 | Tidak ada keystore Android, Play App Signing, Crashlytics, dan kebijakan versi di klien | Rilis Android belum dapat ditandatangani atau dipantau | Keystore, akses Play, DSN crash, implementasi version check |
| B7 | Admin belum diuji di browser dengan backend nyata dan belum punya arah desain | Risiko regresi UI dan belum layak disebut final visual | Staging admin, uji dua peran, `DESIGN.md` |
| B8 | Terms, Privacy Policy, kebijakan retensi, dan refund belum final | Fitur berbayar tidak boleh diaktifkan | Review legal dan keputusan pemilik produk |
| B9 | CSP admin masih `'unsafe-inline'` untuk script | Perlindungan XSS belum maksimal | Nonce middleware atau edge proxy |
| B10 | Retensi dan rekonsiliasi butuh cron platform | Job tidak berjalan sendiri | Scheduler produksi dan monitoring job |

## 9. Yang sengaja tidak dikerjakan

- Android tidak diubah. Tidak ada layar pembelian, restore, status paket, redeem, atau version gate di aplikasi.
- Tidak ada deployment ke Play, hosting admin, atau environment cloud.
- Tidak ada uji beban yang dijalankan, hanya harness dan test fungsional 30 WebSocket.
- Tidak ada backup/restore nyata.
- Tidak ada alerting, APM, atau crash reporting yang terpasang.
- Tidak ada commit atau push.

## 10. Gate berikutnya

Jangan menyalakan `BILLING_ENABLED` atau `PAID_FEATURES_ENABLED` sampai B1, B2, B3, B4, B5, B8, dan B10 selesai. Checklist lengkap ada di `docs/PRODUCTION_READINESS.md` bagian 10. Urutan yang disarankan:

1. Siapkan staging dan secret manager.
2. Selesaikan gateway RTDN dan uji notifikasi.
3. Uji Play license tester end-to-end.
4. Jalankan load test dan backup/restore.
5. Pasang alerting.
6. Finalkan legal dan kebijakan retensi.
7. Uji admin dengan dua peran di staging.
8. Baru aktifkan switch di produksi secara bertahap.
