# PHASE 1 REPORT — MVP Touring Inti (P0)

Tanggal laporan: 24 November 2026. Fase 2 tidak dikerjakan pada eksekusi ini.

Lingkup eksekusi: validasi gerbang Phase 0, audit Phase 1 yang sudah ada, lalu penyelesaian gap P0 yang masih terbuka — statistik trip, rekalkulasi rute, avatar profil, dan perilaku lokasi pengguna pada peta. Implementasi Phase 2–5 yang sudah ada tidak dihapus dan tidak dibangun ulang.

## 1. Ringkasan

Backend NestJS + PostgreSQL/PostGIS, migration versioned, autentikasi Bearer, profil/privasi, garasi kendaraan dengan plat terenkripsi, adapter peta/routing/geocoding, preview dan rekalkulasi rute, perekaman trip personal dengan filter GPS dan agregasi, serta aplikasi Android Kotlin/Compose/Hilt dengan Room, WorkManager, dan foreground service lokasi sudah berjalan.

Hasil verifikasi aktual pada eksekusi ini:

- Backend: `cd backend && npm test` → **36 test, 36 pass, 0 fail, exit 0**.
- Android: `./gradlew :app:testDebugUnitTest :app:assembleDebug` → **BUILD SUCCESSFUL**, **14 unit test, 0 gagal**; APK debug dihasilkan.
- Android lint: `./gradlew :app:lintDebug` → **BUILD SUCCESSFUL**, **32 warning, 0 error**.
- OpenAPI dari DTO: `docs/openapi.json`, **151 path**, termasuk `POST /v1/routes/{id}/recalculate`.
- Migration `0001`–`0008` dijalankan berurutan pada PGlite + PostGIS (`postgis_version()` 3.x) di dalam test.
- Tracking background, permission dialog, process death, dan UI perangkat **belum diuji** karena tidak ada perangkat/emulator; tidak diklaim lulus.

Gerbang Phase 0 tidak sepenuhnya PASS: fondasi backend/auth/database/Android ada, tetapi provider peta/routing/geocoding produksi, perangkat Android, staging PostgreSQL/Redis/object storage, dan persetujuan formal masih BLOCKED. Karena tidak ada blocker fundamental pada fondasi, pekerjaan Phase 1 dilanjutkan dan blocker tersebut dicatat di bagian 10.

## 2. Fitur yang selesai

### 2.1 Backend

| Area | Implementasi | Bukti |
|---|---|---|
| Fondasi | NestJS 11 ESM, TypeScript, env tervalidasi, problem-details, request ID, structured log, CORS, rate limit, health live/ready | `backend/src/app.module.ts`, `app.setup.ts`, `common/*` |
| Database | PostgreSQL/PostGIS, migration versioned `0001`–`0008`, tabel identitas, kendaraan, rute, trip, trip_points | `backend/migrations/*` |
| Auth | Register/login, bcrypt 12, JWT akses 15 menit, refresh opaque di-hash + rotasi transaksional, logout/revoke, reset password, verifikasi email, guard Bearer | `backend/src/auth/*` |
| Profil/privasi | `GET/PATCH /v1/me`, settings privasi, consent, `avatarUrl` http/https tervalidasi, string kosong menghapus avatar | `backend/src/users/*` |
| Garasi | CRUD kendaraan, kendaraan utama, soft delete, plat AES-256-GCM, `includePlate` hanya pemilik, batas paket | `backend/src/vehicles/*` |
| Tempat/rute | Adapter routing + geocoding; tanpa konfigurasi → 503 eksplisit; preview multi-waypoint maksimal 7; alternatif; origin/destination tersimpan | `backend/src/places/*`, `routes/*` |
| Rekalkulasi rute | `POST /v1/routes/{id}/recalculate` memakai origin/destination/waypoint tersimpan, memanggil provider, membuat route baru; hanya pemilik atau leader konvoi aktif | `routes.service.ts`, `routes.controller.ts`; diuji |
| Trip | Start/pause/resume/finish, sesi aktif, batch titik maksimal 500, filter akurasi >100 m, spike >55,6 m/s, gap >60 detik, quality `ok/low_accuracy/spike/gap` | `backend/src/trips/*` |
| Statistik trip | `movingS`, `maxSpeedKph`, `startLocation`, `endLocation`, jarak, durasi, kecepatan rata-rata, `pointCount`, `dataQuality` | `0008_phase1.sql`, `trips.service.ts`; diuji |
| Observability | Request ID, log JSON per request, health, OpenAPI generated | middleware, `/health/*`, `docs/openapi.json` |

### 2.2 Android

| Area | Implementasi |
|---|---|
| Fondasi | Kotlin, Compose Material 3, Hilt, Retrofit/OkHttp + kotlinx.serialization, Room, WorkManager, minSdk 26, target/compileSdk 36 |
| Auth | Login/register/reset, token EncryptedSharedPreferences, refresh otomatis, logout, state loading/error |
| Profil/privasi | Nama, bio, kota, visibilitas, visibilitas riwayat, default berbagi lokasi, avatar dari URL (pratinjau gambar, validasi backend http/https, hapus foto) |
| Garasi | Daftar/tambah/ubah/hapus, kendaraan utama, plat privat lewat aksi “Lihat plat” |
| Peta | MapLibre; state konfigurasi eksplisit bila `RJ_MAP_STYLE_URL` kosong; tombol “Lokasi saya” dengan izin runtime, marker posisi pengguna, kamera ke posisi, kontrol zoom; atribusi dari env |
| Rute | Pencarian tempat, asal/tujuan, waypoint maksimal 7, preview, polyline rute terpilih pada peta, jarak/ETA/provider/disclaimer, hitung ulang rute, error/empty state |
| Trip | Mulai/jeda/lanjutkan/selesai, FGS lokasi + notifikasi, filter GPS lokal, antrean Room, flush batch, WorkManager, pemulihan sesi aktif, ringkasan (termasuk waktu bergerak, kecepatan maksimum, lokasi mulai/selesai) dan riwayat |
| Permission | Foreground location sebelum start; background location lewat pengaturan Android 11+; notifikasi Android 13+; penolakan membatalkan start dan tidak membuat data palsu |

### 2.3 Dokumentasi

- `docs/API_CONTRACT.md`: 151 path, kontrak rekalkulasi rute, field statistik trip.
- `docs/DATA_MODEL.md`: kolom trip baru, quality `spike`, origin/destination rute.
- `docs/REQUIREMENTS_MATRIX.md`: status RID-01, MAP-01, TRP-05 diperbarui.
- `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md`: angka test/path terbaru.
- `docs/openapi.json`: diregenerasi.
- Laporan ini.

## 3. Fitur yang belum selesai

| Fitur | Status | Alasan / batasan |
|---|---|---|
| Unggah foto profil dan foto kendaraan | Belum | Endpoint media ada, tetapi verifikasi object storage belum end-to-end; avatar saat ini memakai URL tervalidasi, bukan unggahan aplikasi |
| Favorit tempat | Belum | Di luar gap P0 yang dieksekusi; MAP-05 tetap Belum |
| Pengurutan ulang waypoint dan pemilih titik langsung dari peta | Belum | MAP-03 baru mendukung tambah/hapus dan pilih dari hasil pencarian |
| Indikator akurasi dan waktu pembaruan posisi live | Belum | MAP-01 baru menampilkan posisi terakhir dan tombol perbarui |
| Detail peta rute per trip pada riwayat | Belum | TRP-05 memuat statistik dan koordinat mulai/selesai, belum polyline per trip |
| Voice guidance, chat, hazard, konvoi UI penuh | Di luar scope eksekusi | Sudah ada di Phase 2–5 dan tidak diubah |

## 4. File yang dibuat/diubah pada eksekusi ini

Backend:

- `backend/migrations/0008_phase1.sql` (baru)
- `backend/src/trips/trips.service.ts`
- `backend/src/routes/routes.service.ts`, `backend/src/routes/routes.controller.ts`
- `backend/src/users/users.dto.ts`, `backend/src/users/users.service.ts`
- `backend/src/test/api.test.ts`, `phase2.test.ts`, `phase4.test.ts`, `phase4.social.test.ts`, `phase4.replay.test.ts`

Android:

- `android/app/src/main/java/id/riderjourney/app/ui/components/CurrentLocation.kt` (baru)
- `.../ui/components/RiderMap.kt`, `.../ui/HomeScreen.kt`, `.../ui/RouteScreen.kt`, `.../ui/RouteViewModel.kt`, `.../ui/ProfileScreen.kt`, `.../ui/TripsScreen.kt`
- `.../data/api/Models.kt`, `.../data/api/RiderJourneyApi.kt`, `.../data/MapRepository.kt`

Dokumentasi: `docs/API_CONTRACT.md`, `docs/DATA_MODEL.md`, `docs/REQUIREMENTS_MATRIX.md`, `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md`, `docs/openapi.json`, laporan ini.

## 5. Database migration

| File | Isi |
|---|---|
| `0001_init.sql` | users, user_settings, user_consents, refresh_tokens, one_time_tokens, vehicles, routes, trips, trip_points; PostGIS |
| `0002`–`0007` | Fase 2–5 (konvoi, realtime, sosial, komunitas, billing, admin) — tidak diubah |
| `0008_phase1.sql` | `trips.moving_seconds`, `trips.max_speed_kph`, `trips.start_point`, `trips.end_point`; `routes.origin`, `routes.destination`, `routes.updated_at` |

Catatan:

- `trips.start_point`/`end_point` adalah `geography(Point,4326)` dan diproyeksikan ke `lat`/`lng` di API; tidak ada WKB yang bocor ke klien.
- `routes.origin`/`destination` nullable untuk kompatibilitas route lama; rekalkulasi memakai `ST_StartPoint`/`ST_EndPoint` bila kolom kosong.
- Migration dijalankan otomatis oleh test pada PGlite + PostGIS. Produksi: `cd backend && npm run migration:run` setelah `npm run build`.

## 6. Environment variables

Backend (wajib/terdokumentasi):

- `DATABASE_URL` — PostgreSQL + PostGIS.
- `AUTH_JWT_SECRET` — minimal 32 karakter.
- `PLATE_ENCRYPTION_KEY` — 32 byte base64 (AES-256-GCM).
- `ROUTING_BASE_URL` — kosong berarti `PROVIDER_NOT_CONFIGURED` 503.
- `GEOCODING_BASE_URL` — kosong berarti pencarian tempat 503, bukan hasil palsu.
- Redis, media/S3, LiveKit, billing, dan admin memakai variabel yang sudah ada dari fase sebelumnya.

Android (build-time):

- `RJ_API_BASE_URL` — default `http://10.0.2.2:3000`.
- `RJ_MAP_STYLE_URL` — kosong menampilkan kartu “Peta belum dikonfigurasi”.
- `RJ_MAP_ATTRIBUTION` — teks atribusi provider.

Tidak ada secret yang ditambahkan ke repository; semua nilai sensitif tetap environment/secret operator.

## 7. API endpoints (ringkas)

- Auth: `POST /v1/auth/register|login|refresh|logout|email/verify|password/reset/request|password/reset/confirm`, `GET /v1/auth/session`.
- Profil: `GET/PATCH /v1/me`, `GET/PATCH /v1/me/settings`, `POST /v1/me/consents`.
- Kendaraan: `GET/POST /v1/vehicles`, `GET/PATCH/DELETE /v1/vehicles/{id}`, `POST /v1/vehicles/{id}/primary`.
- Tempat/rute: `GET /v1/places/search`, `POST /v1/routes/preview`, `GET /v1/routes/{id}`, `POST /v1/routes/{id}/recalculate`.
- Trip: `GET/POST /v1/trips`, `GET /v1/trips/active`, `GET /v1/trips/{id}`, `POST /v1/trips/{id}/pause|resume|finish|points`, `GET /v1/trips/{id}/points`.
- Health: `GET /health/live`, `GET /health/ready`.

Semua endpoint privat memakai Bearer token dan mengambil `userId` dari token, bukan dari body/query. OpenAPI lengkap: `docs/openapi.json` (151 path).

## 8. Test results aktual

### 8.1 Backend

Perintah: `cd backend && npm test` (build TypeScript lalu `node --test dist/test`).

Hasil: **tests 36, pass 36, fail 0, cancelled 0, skipped 0, exit 0** (durasi ±94 detik).

Test Phase 1 yang relevan:

1. `health and migration report PostgreSQL with PostGIS` — migrasi `0001`–`0008`, tabel inti, PostGIS.
2. `registration, duplicate rejection, session validation, and cross-user isolation`.
3. `login, refresh rotation, logout, and password reset` — replay refresh lama 401.
4. `profile and privacy settings update` — termasuk avatar `https` diterima, skema non-http (`javascript:`) ditolak 422, dan string kosong menghapus avatar.
5. `vehicle CRUD, primary vehicle, and plate privacy` — plat tidak tampil pada list/detail pengguna lain.
6. `place search and route provider states` — provider sukses (2 alternatif), kosong, error 503, waypoint 8 → 422, koordinat invalid → 422, **rekalkulasi rute menghasilkan id baru dan pengguna lain mendapat 404**.
7. `trip state machine, GPS noise, recovery, and cross-user isolation` — quality `spike/low_accuracy/gap`, duplikat seq, pause menolak titik, resume/finish, recovery.
8. `trip summary reports moving duration, maximum speed, and endpoints` — `movingS=30`, `maxSpeedKph=72`, start/end location sesuai titik `ok`, jarak 300–400 m.

Test fase lain (konvoi, realtime, sosial, komunitas, billing, admin, privacy) tetap berjalan dan lulus.

### 8.2 Android

Perintah: `cd android && JAVA_HOME="$PWD/.tooling/jdk-21.0.13.1+2" ./gradlew :app:testDebugUnitTest :app:assembleDebug`.

Hasil: **BUILD SUCCESSFUL**, **14 testcase, 0 failure**. APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

Unit test: `GpsFilterTest` (8) dan `TripStateMachineTest` (6). Tidak ada UI/instrumented test karena tidak ada emulator/perangkat terverifikasi.

### 8.3 Lint dan OpenAPI

- `./gradlew :app:lintDebug` → BUILD SUCCESSFUL, **32 warning, 0 error** (warning deprecation MapLibre dan sejenisnya; tidak ada error).
- `AUTH_JWT_SECRET=... PLATE_ENCRYPTION_KEY=... npm run openapi` → `{"ok":true,...,"paths":151}`; `POST /v1/routes/{id}/recalculate` ada di spec.

### 8.4 Matriks pengujian wajib

| Skenario | Status | Bukti / batasan |
|---|---|---|
| Register/login/logout/invalid token/unauthorized | PASS (backend) | Test auth; 401 tanpa token, refresh replay 401 |
| Profil: read/update/cross-user | PASS (backend) | Test profil; isolasi resource |
| Avatar URL valid/invalid | PASS (backend validation) | Validasi `IsUrl` http/https; unggahan media belum ada |
| Vehicle CRUD/ownership/privacy/validation | PASS (backend) | Test kendaraan + plat |
| Routing sukses/gagal/invalid/no route | PASS (backend, provider stub) | 201/503/422/`providerStatus=empty`; provider produksi BLOCKED |
| Rekalkulasi rute + otorisasi | PASS (backend, provider stub) | Id baru, pengguna lain 404 |
| Trip start/pause/resume/finish/recovery/history | PASS (backend) + unit Android | State machine, recovery sesi aktif |
| GPS permission denied | BELUM DIUJI DI PERANGKAT | UI membatalkan start; tidak ada instrumented test |
| Low accuracy/spike/gap | PASS (backend + unit) | Quality tersimpan, tidak dihitung jarak |
| GPS unavailable | BELUM DIUJI | Butuh perangkat; belum ada state “GPS mati” eksplisit |
| Background tracking/process death | BELUM DIUJI DI PERANGKAT | FGS, Room, START_STICKY ada; tidak diklaim lulus |
| Network interruption | SEBAGIAN | Batch idempotent + WorkManager; toggle jaringan nyata belum diuji |
| Build Android/backend | PASS | lihat 8.1–8.3 |

## 9. Build results

| Perintah | Hasil |
|---|---|
| `cd backend && npm test` (termasuk `tsc`) | PASS, 36/36, exit 0 |
| `./gradlew :app:testDebugUnitTest :app:assembleDebug` | PASS, BUILD SUCCESSFUL, 14 unit test |
| `./gradlew :app:lintDebug` | PASS, 32 warning / 0 error |
| `npm run openapi` | PASS, 151 path |

## 10. Known issues dan blocker

| # | Isu | Dampak | Tindakan |
|---|---|---|---|
| B-01 | Tidak ada perangkat/emulator Android terverifikasi | Permission, FGS, background, process death, UI tidak dapat diuji end-to-end | Sediakan perangkat/emulator sebelum klaim MVP gate |
| B-02 | Provider peta/routing/geocoding produksi belum dikonfigurasi | Peta dasar kosong; preview/rekalkulasi 503 pada konfigurasi default | Isi `ROUTING_BASE_URL`, `GEOCODING_BASE_URL`, `RJ_MAP_STYLE_URL` + lisensi |
| B-03 | Tidak ada SMTP/email provider | Verifikasi email/reset password produksi tidak mengirim email | Konfigurasi provider email; token dev hanya untuk test |
| B-04 | PostgreSQL/Redis/object storage staging belum diprovision | Backend hanya diuji PGlite; race, retensi, media nyata belum diverifikasi | Sediakan staging dan jalankan migration |
| B-05 | Unggah avatar/foto kendaraan belum tersedia | RID-01/VEH-01 baru sebagian (URL avatar, belum unggah) | Selesaikan verifikasi object storage lebih dulu |
| B-06 | UI Compose belum diuji instrumented | Crash runtime tidak tertangkap unit test | Tambah Compose UI test setelah emulator tersedia |
| B-07 | Statistik bergantung pada kualitas GPS perangkat | `maxSpeedKph` dapat noisy bila sensor kendaraan buruk; filter hanya membuang titik `ok` dengan `speedMps` valid | Validasi lapangan pada perangkat nyata |

## 11. Security findings

- Otorisasi resource memakai `userId` dari token; `user_id` dari klien tidak pernah dipercaya. Rekalkulasi rute memeriksa pemilik atau leader konvoi aktif dan mengembalikan 404 untuk pihak lain.
- Nomor polisi terenkripsi AES-256-GCM; tidak muncul di list/feed/peta dan hanya pemilik dengan `includePlate=true` yang dapat membacanya.
- `avatarUrl` sekarang divalidasi hanya `http`/`https` (bukan skema arbitrer) dan dibatasi 500 karakter; string kosong menghapus avatar. Klien Android memuat gambar dengan timeout dan menampilkan kegagalan, bukan menyembunyikannya.
- Lokasi pengguna hanya dibaca setelah izin presisi diberikan; penolakan menampilkan pesan dan tidak mengirim/menampilkan posisi palsu. Peta menampilkan state konfigurasi eksplisit bila style kosong.
- Provider yang belum dikonfigurasi mengembalikan 503 `PROVIDER_NOT_CONFIGURED`; tidak ada jarak/ETA/rute statis yang dipalsukan.
- Tidak ada secret baru di repository. Token refresh disimpan sebagai hash dan dirotasi dalam transaksi dengan `FOR UPDATE`.
- Temuan terbuka: rate limit global ada, tetapi belum ada uji beban; audit akses admin dan rotasi kunci enkripsi belum diuji di staging.

## 12. Acceptance checklist Phase 1

| Kriteria | Status | Bukti |
|---|---|---|
| Phase 0 divalidasi sebelum fitur | PASS (dengan blocker tercatat) | Fondasi ada; provider/device/staging BLOCKED |
| Android foundation (Kotlin/Compose/M3/Hilt/Room/WorkManager) | PASS | Build + 14 unit test |
| Auth lengkap + verifikasi token backend | PASS (backend), UI tersedia | Test auth, guard Bearer |
| Profil + privacy settings + avatar | PASS (backend), SEBAGIAN (UI/unggah media) | `PATCH /v1/me`, layar profil + URL avatar |
| Garasi + kendaraan utama + plat privat | PASS | CRUD + enkripsi + test isolasi |
| Peta + current location + zoom + config error | SEBAGIAN | MapLibre, izin runtime, marker, kamera, zoom; uji perangkat & provider belum |
| Routing + waypoint + preview + alternatif + rekalkulasi | PASS (backend), SEBAGIAN (UI) | Provider stub; polyline dan tombol hitung ulang di UI |
| Trip recording + FGS + Room + recovery + statistik | SEBAGIAN | Logika dan build lulus; perangkat belum diuji; statistik diuji backend |
| Backend API + DB + migration + validasi + otorisasi | PASS | 36 test, 8 migration, 151 path |
| Testing dijalankan dan dilaporkan apa adanya | PASS | Bagian 8, termasuk yang belum diuji |
| Tidak masuk Phase 2 / tidak commit | PASS | Tidak ada perubahan Phase 2, tidak ada commit/push |

Kesimpulan: **Phase 1 belum production-ready** dan gate perangkat/provider tetap BLOCKED, tetapi seluruh gap P0 yang dapat diverifikasi di workspace ini sudah diimplementasikan dan diuji pada tingkat backend/unit/build.

## 13. Perintah reproduksi

Backend:

```bash
cd backend
npm install
npm test
AUTH_JWT_SECRET="test-secret-with-at-least-32-characters" \
PLATE_ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
npm run openapi
```

Android (Windows, JDK 21):

```bash
cd android
export JAVA_HOME="$(pwd)/.tooling/jdk-21.0.13.1+2"
./gradlew :app:testDebugUnitTest :app:assembleDebug
./gradlew :app:lintDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
