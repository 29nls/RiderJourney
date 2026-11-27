# RiderJourney

Aplikasi touring motor: pencatatan perjalanan, konvoi dengan lokasi langsung, chat, laporan bahaya, garasi kendaraan, dan konsol admin.

Repository ini berisi tiga aplikasi dan dokumentasi produknya:

| Path | Isi | Stack |
|---|---|---|
| `backend/` | API, realtime, migrasi, job operasional | NestJS 11, TypeScript, PostgreSQL + PostGIS, Redis (opsional) |
| `android/` | Aplikasi rider | Kotlin, Jetpack Compose, Hilt, Room, MapLibre |
| `admin/` | Konsol operasi dan moderasi | Next.js 16, React 19 |
| `docs/` | Kontrak, arsitektur, keamanan, rencana test, kesiapan produksi | Markdown |
| `ops/` | Runbook deployment, insiden, rollback | Markdown |

`AGENTS.md`, `BRAIN.md`, `bin/`, `skills/`, dan `docs/PHASE_REPORTS/` adalah tooling dan catatan kerja proyek; bukan bagian dari aplikasi yang dikirim.

## Menjalankan

Backend (Node.js 22+, TypeScript):

```bash
cd backend
npm ci
npm run typecheck
npm test          # build ke dist/ lalu jalankan node --test "dist/test/*.test.js"
npm run build
npm start         # butuh DATABASE_URL, AUTH_JWT_SECRET, PLATE_ENCRYPTION_KEY
```

Tes backend memakai PGlite + PostGIS di memori, jadi tidak perlu PostgreSQL untuk `npm test`.

Admin:

```bash
cd admin
npm ci
npm run build
npm run dev       # http://127.0.0.1:3000
```

Android (JDK 21 dan Android SDK):

```bash
cd android
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

Build Android memerlukan `JAVA_HOME` ke JDK 21; Gradle 8.13 menolak JDK 25.

## Penyimpanan media

Media memakai bucket S3 privat dengan presigned SigV4. Variabel yang dibutuhkan:

```
MEDIA_S3_ENDPOINT=https://s3.example.com   # kosongkan untuk AWS default
MEDIA_S3_BUCKET=riderjourney-media
MEDIA_S3_REGION=us-east-1
MEDIA_S3_ACCESS_KEY=...
MEDIA_S3_SECRET_KEY=...
MEDIA_S3_FORCE_PATH_STYLE=true             # MinIO/S3-compatible; false untuk virtual-hosted AWS
MEDIA_UPLOAD_TTL_SECONDS=300
MEDIA_DELETION_MAX_ATTEMPTS=5
MEDIA_DELETION_BACKOFF_SECONDS=30
MEDIA_DELETION_POLL_SECONDS=60
MEDIA_DELETION_BATCH_SIZE=20
MEDIA_UPLOAD_CLEANUP_INTERVAL_SECONDS=300
MEDIA_QUOTA_BYTES_DEFAULT=209715200
MEDIA_SCANNER=clamav                      # 'none' (default) keeps media unscanned
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=30000
MEDIA_SCAN_MAX_ATTEMPTS=3
MEDIA_SCAN_POLL_SECONDS=120
MEDIA_SCAN_BATCH_SIZE=5
MEDIA_SCAN_RETRY_SECONDS=300
```

Bucket harus privat. Dua worker berjalan otomatis saat API start dan hanya bila
`MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY`, dan `MEDIA_S3_SECRET_KEY` terisi:

- **Pembersihan upload** (`MEDIA_UPLOAD_CLEANUP_INTERVAL_SECONDS`) meng-expire
  intent `pending` yang lewat jendela unggah, memeriksa objeknya dengan `HEAD`,
  dan meng-enqueue penghapusan objek orphan dalam transaksi yang sama.
- **Penghapusan objek** (`MEDIA_DELETION_POLL_SECONDS`, batch
  `MEDIA_DELETION_BATCH_SIZE`) memakai `FOR UPDATE SKIP LOCKED`, sehingga aman
  dijalankan pada beberapa instance backend. Job yang gagal di-retry dengan
  backoff eksponensial lalu menjadi dead-letter setelah
  `MEDIA_DELETION_MAX_ATTEMPTS`.

Untuk inspeksi manual: `npm run media:purge` (status) atau
`npm run media:purge -- --run`. Laporan status memuat `pending`, `processing`,
`done`, dan `failed` (dead-letter).

Kuota penyimpanan per pengguna disimpan di `storage_quotas`; `usedBytes`
diturunkan dari media berstatus `ready` **dan** `deleting` (byte yang masih ada
di bucket), sedangkan upload yang belum selesai hanya menahan `reservedBytes`.
Media baru berhenti dihitung setelah worker memverifikasi objeknya hilang.
Klien melihat semua angka itu lewat `GET /v1/media/quota`.

Media yang masih dipakai post, album, trip, poster, hazard, avatar, atau
kendaraan tidak dapat dihapus: `DELETE /v1/media/:id` menjawab
`409 MEDIA_IN_USE` beserta daftar referensinya. Health worker storage
(pending, dead-letter, umur job tertua, hasil scan) tersedia untuk admin di
`GET /v1/admin/media/workers`.

Untuk menjalankan uji integrasi storage di lokal, nyalakan server S3-compatible sungguhan (lihat `PHASE_6_1_REPORT.md`; MinIO open-source tidak lagi didistribusikan), lalu:

```bash
cd backend
MEDIA_S3_INTEGRATION=1 MEDIA_S3_ENDPOINT=http://127.0.0.1:8333 MEDIA_S3_BUCKET=rj-media-it MEDIA_S3_ACCESS_KEY=... MEDIA_S3_SECRET_KEY=... npm run test:media
```

## Konfigurasi

Semua konfigurasi backend dibaca dari environment, tidak ada secret di repository. Variabel yang wajib untuk menjalankan API: `DATABASE_URL`, `AUTH_JWT_SECRET`, `PLATE_ENCRYPTION_KEY` (32 byte base64). Fitur opsional tetap mati sampai dikonfigurasi: `BILLING_ENABLED`, `PAID_FEATURES_ENABLED`, `MEDIA_S3_*`, `REDIS_URL`, `LIVEKIT_*`.

Nilainya tidak boleh di-commit. Gunakan secret manager atau `.env` lokal yang tidak di-track.

## Status

Fase 0 sampai 5 memiliki laporan historis di root (`PHASE_2_REPORT.md`, `PHASE_4_REPORT.md`, `PHASE_5_REPORT.md`) dan `docs/PHASE_REPORTS/`. Kondisi aktual, termasuk fase 6, dirangkum di `PHASE_6_REPORT.md`; status per requirement ada di `docs/REQUIREMENTS_MATRIX.md`.

Ringkas:

- Backend: auth, profil, privasi, garasi, peta/rute, trip, konvoi, realtime, chat, bahaya, media, sosial, komunitas, billing (mati secara default), redeem, admin RBAC, retensi.
- Android: auth, profil, garasi, peta/rute, perekaman trip, konvoi + lokasi langsung, chat konvoi, laporan bahaya.
- Android sudah memiliki unggah media (avatar profil dan foto kendaraan) dengan
  SHA-256 streaming, retry WorkManager, dan state di Room.
- Android belum memiliki: layar consent/privasi, penghapusan akun, dan tempat favorit.
- Media pipeline sudah diuji terhadap SeaweedFS 4.55 di CI, tetapi belum terhadap
  AWS nyata; lihat `PHASE_6_2_REPORT.md` bagian production blockers.

Jangan mengaktifkan `BILLING_ENABLED` atau `PAID_FEATURES_ENABLED` tanpa checklist di `docs/PRODUCTION_READINESS.md`.

Phase 6.4 menambahkan pemulihan penghapusan (reconcile + pembatalan + retry dead
letter), moderasi konten manual yang terpisah dari pemindaian malware, alerting
operasional berbasis tabel, dan integrasi ClamAV nyata di CI. Lihat
`docs/MEDIA_OPERATIONS_RUNBOOK.md`, `docs/MEDIA_MODERATION_POLICY.md`, dan
`docs/SCANNER_INTEGRATION.md`. Ringkasan hasil: `PHASE_6_4_REPORT.md`.

Phase 6.5 (verifikasi) menutup sebagian blocker: SeaweedFS 4.55 dan ClamAV 1.4.7
diuji nyata secara lokal (11/11 dan 10/10 lulus), backend suite 86/0/17,
Android 22/22 unit + 28 warning lint. GitHub Actions, emulator, PostgreSQL/PostGIS
nyata, dan AWS S3 tetap BLOCKED. Ringkasan: `PHASE_6_5_REPORT.md`.
