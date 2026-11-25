# RiderJourney Operations Runbook

Untuk operator backend, admin, dan rilis. Semua perintah dijalankan dari root repo kecuali disebutkan lain.

## 1. Prasyarat

- Node.js 22 atau lebih baru.
- PostgreSQL dengan PostGIS untuk produksi.
- Redis untuk realtime multi-proses di produksi.
- Object storage S3-compatible untuk media.
- Secret manager untuk `AUTH_JWT_SECRET`, `PLATE_ENCRYPTION_KEY`, `CONTACT_ENCRYPTION_KEY`, kredensial Google, dan pepper redeem.
- `pg_dump` dan `pg_restore` di host operasi.

Jangan menyimpan secret di git, bundle admin, atau log. File `.env` hanya untuk lokal dan tidak boleh masuk image.

## 2. Deploy backend

```bash
cd backend
npm ci
npm run build
NODE_ENV=production npm run migration:run
NODE_ENV=production npm start
```

Urutan aman: backup, migration, smoke test, lalu naikkan traffic. Migrasi Phase 5 hanya menambah tabel/kolom dan seed; tidak menghapus data lama.

Smoke test minimal:

```bash
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
```

`health/ready` harus melaporkan PostGIS. Bila gagal, jangan lanjutkan rollout.

## 3. Bootstrap admin pertama

1. Daftarkan akun biasa lewat aplikasi atau `POST /v1/auth/register`.
2. Verifikasi email.
3. Jadikan admin:

```bash
cd backend
npm run admin:bootstrap -- grant owner@example.com superadmin
```

4. Login ke konsol admin, daftarkan authenticator, konfirmasi kode.
5. Buat admin lain dengan peran lebih kecil. Jangan memakai satu superadmin untuk operasi harian.

Bila akun admin hilang akses, superadmin lain harus mendaftarkan ulang MFA. Tidak ada endpoint bypass MFA.

## 4. Menjalankan konsol admin

```bash
cd admin
npm ci
npm run build
RIDERJOURNEY_API_URL=https://api.example.com PORT=3001 npm start
```

- Admin harus di belakang TLS.
- `RIDERJOURNEY_API_URL` hanya dibaca server Next.js.
- Cookie sesi `HttpOnly`, `SameSite=Lax`, `Secure` di produksi.
- Pasang rate limit dan WAF di edge. Login tetap dibatasi backend, tetapi backend melihat IP server admin, bukan IP operator.
- Pastikan domain admin tidak diindeks. Metadata sudah `noindex`.

## 5. Menjalankan job retensi

Retensi menangani export kedaluwarsa, job export queued, penghapusan akun yang jatuh tempo, notifikasi billing lama, event billing lama, dan grant kedaluwarsa.

Manual:

```bash
cd backend
npm run retention:run
```

Cron harian (contoh Linux):

```cron
15 3 * * * cd /srv/riderjourney/backend && NODE_ENV=production npm run retention:run >> /var/log/riderjourney-retention.log 2>&1
```

Periksa `job_runs` setelah run pertama. Bila `status=failed`, baca `detail.error`, perbaiki, lalu jalankan ulang. Job idempoten untuk kebanyakan operasi, tetapi export yang sudah selesai tidak dibuat ulang.

## 6. Rekonsiliasi billing

Rekonsiliasi memeriksa langganan yang hampir kedaluwarsa atau belum diverifikasi dalam 24 jam.

```bash
cd backend
npm run billing:reconcile
```

Jadwalkan setiap 6 jam setelah billing aktif. Tanpa kredensial provider, perintah akan gagal dan tidak boleh dianggap sukses.

Jangan menjalankan rekonsiliasi bersamaan dengan deploy yang mengubah pemetaan produk. Selesaikan pemetaan dulu.

## 7. Mengaktifkan Google Play Billing

Jangan lakukan sebelum checklist di `docs/PRODUCTION_READINESS.md` bagian 10 terpenuhi.

1. Buat subscription di Play Console dan catat product id serta base plan id.
2. Buat service account, aktifkan Android Publisher API, dan beri akses ke Play Console.
3. Isi secret deployment:
   - `GOOGLE_PLAY_PACKAGE_NAME`
   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
   - `BILLING_NOTIFICATION_SECRET`
   - `REDEEM_CODE_PEPPER`
4. Petakan produk ke paket. Contoh, ganti nilai dengan yang nyata:

```sql
INSERT INTO billing_products (product_id, base_plan_id, plan_code, active)
VALUES ('riderjourney_pro_monthly', 'pro-monthly', 'pro', true)
ON CONFLICT (product_id, base_plan_id)
DO UPDATE SET plan_code = EXCLUDED.plan_code, active = true, updated_at = now();

UPDATE plans SET play_product_id = 'riderjourney_pro_monthly' WHERE code = 'pro';
```

5. Uji dengan license tester di staging. Jangan menyalakan switch produksi.
6. Uji verify, restore, renewal, cancel, grace, hold, refund, dan notifikasi duplikat.
7. Set `BILLING_ENABLED=true` dan `PAID_FEATURES_ENABLED=true` di staging, deploy.
8. Set `admin_config.features` lewat konsol admin. Kedua switch harus true.
9. Ulangi di produksi setelah legal menyetujui.

Bila ragu, biarkan switch false. Fitur gratis tetap berjalan.

## 8. RTDN Google Play

Baseline backend menerima push di:

```
POST /v1/billing/notifications
Header: X-Billing-Secret: <BILLING_NOTIFICATION_SECRET>
Header: Content-Type: application/json
```

Pub/Sub tidak mengirim header kustom secara native. Pasang gateway (Cloud Run, Worker, atau reverse proxy) yang:

1. memvalidasi OIDC token Pub/Sub terhadap audience yang disepakati,
2. menolak request di luar subscription tersebut,
3. menyuntikkan `X-Billing-Secret`,
4. meneruskan body tanpa mengubahnya,
5. tidak mencatat header atau body mentah.

Endpoint idempoten berdasarkan `messageId`. Notifikasi duplikat tidak menambah entitlement. Bila gateway belum ada, jangan aktifkan RTDN.

## 9. Backup dan restore

Backup:

```bash
cd /srv/riderjourney
DATABASE_URL=postgres://... BACKUP_DIR=/secure/backups ops/backup.sh
```

Simpan dump dan checksum di storage terenkripsi dengan retensi minimal 30 hari. Object storage media harus memakai versioning atau lifecycle terpisah; dump database tidak menyalin byte media.

Restore ke database baru:

```bash
RESTORE_DATABASE_URL=postgres://... BACKUP_FILE=/secure/backups/riderjourney-....dump \
RESTORE_CONFIRM=RESTORE ops/restore.sh
```

Setelah restore:

1. `npm run migration:status`.
2. `curl /health/ready`.
3. Jalankan `npm run retention:run` untuk akun yang sudah dijadwalkan dihapus.
4. Rekonsiliasi billing.
5. Uji login, entitlement, dan satu laporan admin.

Jangan restore di atas database aktif. Hentikan writer dan arahkan aplikasi ke database baru setelah verifikasi.

## 10. Monitoring dan alert

Metrik yang harus ada di dashboard:

| Sinyal | Sumber | Alert awal |
|---|---|---|
| 5xx API | log/reverse proxy | > 1% selama 5 menit |
| Latensi p95 API | log/APM | > 800 ms selama 10 menit |
| Billing verify gagal | log + `billing_events` | > 5 kegagalan dalam 15 menit |
| Notifikasi billing error | `billing_notifications.error` | ada error baru |
| Langganan hampir habis | `subscriptions.expires_at` | < 24 jam tanpa renewal |
| Job retensi gagal | `job_runs.status` | satu kegagalan |
| Laporan menunggu | `content_reports.status` | > 50 atau > 24 jam |
| Redeem gagal | log | lonjakan 4xx |
| WebSocket putus | log realtime | > 5% reconnect gagal |
| Kapasitas DB | PostgreSQL | > 80% disk |

Query operasional:

```sql
SELECT status, count(*) FROM job_runs GROUP BY status;
SELECT count(*) FROM content_reports WHERE status = 'pending';
SELECT count(*) FROM billing_notifications WHERE processed_at IS NULL;
SELECT count(*) FROM subscriptions WHERE status = 'in_grace';
SELECT id, message, created_at FROM billing_notifications WHERE error IS NOT NULL ORDER BY received_at DESC LIMIT 20;
SELECT id, status, detail, started_at FROM job_runs ORDER BY started_at DESC LIMIT 20;
```

Log memakai `requestId`. Jangan menambahkan body, token, koordinat, atau isi pesan ke log.

## 11. Load test staging

```bash
cd backend
LOAD_TEST_BASE_URL=https://staging.example.com \
LOAD_TEST_CONFIRM=RUN \
LOAD_TEST_USERS=10 \
LOAD_TEST_DURATION_SECONDS=30 \
node tools/load-test.mjs
```

Harness membuat akun, kendaraan, konvoi, tiket WebSocket, dan posisi. Jalankan hanya di staging. Media intent dilewati bila storage staging belum dikonfigurasi. Catat tanggal, commit, ukuran instance, p50/p95, error rate, dan jumlah koneksi.

## 12. Deployment admin dan rollback

- Simpan build sebelumnya.
- Deploy admin setelah backend kompatibel.
- Uji login, MFA, satu aksi read, satu aksi step-up.
- Bila gagal, kembalikan build sebelumnya. Cookie tetap valid bila `AUTH_JWT_SECRET` tidak berubah.
- Jangan menonaktifkan CSP atau header keamanan untuk mempercepat perbaikan.

## 13. Limitasi yang masih terbuka

- Belum ada scheduler bawaan. Cron harus disediakan platform.
- Belum ada alerting terpasang; tabel di atas adalah target konfigurasi.
- Belum ada OIDC gateway RTDN.
- Belum ada signing Android atau upload Play dari CI.
- Admin belum memiliki audit UI untuk data export dan deletion request pengguna. Job dapat dipantau lewat database dan endpoint pengguna.
- CSP admin masih memakai `'unsafe-inline'` untuk script.
