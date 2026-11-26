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

## Konfigurasi

Semua konfigurasi backend dibaca dari environment, tidak ada secret di repository. Variabel yang wajib untuk menjalankan API: `DATABASE_URL`, `AUTH_JWT_SECRET`, `PLATE_ENCRYPTION_KEY` (32 byte base64). Fitur opsional tetap mati sampai dikonfigurasi: `BILLING_ENABLED`, `PAID_FEATURES_ENABLED`, `MEDIA_S3_*`, `REDIS_URL`, `LIVEKIT_*`.

Nilainya tidak boleh di-commit. Gunakan secret manager atau `.env` lokal yang tidak di-track.

## Status

Fase 0 sampai 5 memiliki laporan historis di root (`PHASE_2_REPORT.md`, `PHASE_4_REPORT.md`, `PHASE_5_REPORT.md`) dan `docs/PHASE_REPORTS/`. Kondisi aktual, termasuk fase 6, dirangkum di `PHASE_6_REPORT.md`; status per requirement ada di `docs/REQUIREMENTS_MATRIX.md`.

Ringkas:

- Backend: auth, profil, privasi, garasi, peta/rute, trip, konvoi, realtime, chat, bahaya, media, sosial, komunitas, billing (mati secara default), redeem, admin RBAC, retensi.
- Android: auth, profil, garasi, peta/rute, perekaman trip, konvoi + lokasi langsung, chat konvoi, laporan bahaya.
- Android belum memiliki: layar consent/privasi, penghapusan akun, unggah media, dan tempat favorit.
- Media pipeline backend belum terverifikasi terhadap object storage nyata; lihat known limitations di laporan fase 6.

Jangan mengaktifkan `BILLING_ENABLED` atau `PAID_FEATURES_ENABLED` tanpa checklist di `docs/PRODUCTION_READINESS.md`.
