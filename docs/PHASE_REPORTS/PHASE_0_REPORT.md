# PHASE 0 REPORT — Discovery, Repository Audit, Product Breakdown, Architecture Foundation

Tanggal laporan: 24 November 2026. Fase berikutnya belum dimulai.

## 1. Ringkasan implementasi

Fase 0 mengaudit repository, membaca seluruh `PRD_RiderJourney.md` (903 baris), dan menghasilkan fondasi rancangan: ringkasan sistem, arsitektur, model data, kontrak REST, kontrak WebSocket, threat model, matriks izin Android, rencana test, roadmap bertahap, dan log keputusan.

Temuan utama: repository **bukan** aplikasi RiderJourney. Isinya toolkit `@mindmux/brain-md` v0.3.0 (Node CLI, skill brain, dokumentasi toolkit). Tidak ada kode Android, backend, admin, atau infrastruktur. Karena itu tidak ada implementasi lama yang dipertahankan atau dihapus. Fase 0 tidak menulis kode aplikasi; alasan dan konsekuensinya ada di `DECISIONS.md` D-011.

Fase 0 berhenti di sini sesuai instruksi. Fase 1 belum dimulai.

## 2. Fitur yang selesai dan belum selesai

| Status | Isi |
|---|---|
| Selesai | Audit repository; pembacaan PRD penuh; pemetaan aktor, kapabilitas, prioritas, dan fase; arsitektur modular monolith; skema data; kontrak API dan realtime; threat model; matriks izin; rencana test; roadmap dan slice Fase 1; log keputusan dan konflik |
| Belum selesai | Seluruh fitur produk (belum ada kode); OpenAPI formal; pemilihan provider peta; brand/domain/package final; kebijakan legal; CI/CD nyata; environment dev/staging/prod |
| Tidak dikerjakan (sesuai instruksi) | Fase 1 dan seterusnya |

Tidak ada fitur produk yang dapat diklaim selesai. Yang ada adalah rancangan yang dapat diimplementasikan dan diuji.

## 3. Arsitektur dan keputusan baru

- Modular monolith NestJS + PostgreSQL/PostGIS + Redis; worker terpisah; Android Kotlin/Compose/Hilt; admin Next.js (D-004, D-005, D-010).
- Posisi live hanya di Redis ber-TTL; tidak ada tabel posisi di PostgreSQL (D-008).
- Verifikasi identitas di backend; `sub` token sebagai satu-satunya identitas (D-006).
- PTT/voice masuk Fase 2 mengikuti PRD 15, bukan MVP (D-009).
- Stale 30 detik, TTL posisi 5 menit, invite 8 karakter ber-hash, retensi 30 hari, kuota media 10 MB/200 MB (D-015…D-018) — semuanya default konfigurasi, bukan komitmen.
- Konflik prompt vs PRD dicatat di `DECISIONS.md` bagian 4; tidak ada requirement PRD yang dibatalkan.
- OpenAPI ditunda ke awal Slice 1A agar dihasilkan dari DTO, bukan ditulis tangan (D-023).

## 4. File penting yang dibuat

| File | Isi |
|---|---|
| `docs/DECISIONS.md` | Audit, keputusan D-001…D-023, konflik, keputusan terbuka |
| `docs/SYSTEM_OVERVIEW.md` | Aktor, konteks, peta kapabilitas/fase, lingkungan, struktur repo |
| `docs/ARCHITECTURE.md` | Modul backend, pipeline, adapter, Redis, Android, worker, deployment, failure modes |
| `docs/DATA_MODEL.md` | Tabel, kolom, indeks, relasi, retensi, aturan integritas |
| `docs/API_CONTRACT.md` | Konvensi REST, error, endpoint Fase 1, otorisasi, rate limit |
| `docs/REALTIME_EVENTS.md` | Tiket, amplop, room, katalog event, posisi, reconnect, rate limit |
| `docs/SECURITY_AND_PRIVACY.md` | Aset, threat model, klasifikasi data, privasi lokasi, verifikasi |
| `docs/ANDROID_PERMISSIONS.md` | Matriks izin, alur permintaan, foreground service, kewajiban Play |
| `docs/TEST_PLAN.md` | Piramida, matriks requirement, skenario GPS/keamanan/beban, gerbang CI |
| `docs/ROADMAP.md` | Fase 0–4 dan tujuh slice Fase 1 |
| `docs/PHASE_REPORTS/PHASE_0_REPORT.md` | Laporan ini |

Tidak ada file lama yang diubah. `PRD_RiderJourney.md`, `README.md`, `package.json`, `brain/`, `skills/`, `_root/`, dan `_mem/` tidak disentuh.

## 5. Database migration

Belum ada migration karena belum ada database atau kode backend. Rencana nama migration Fase 1 ada di `DATA_MODEL.md`: `0001_core_identity`, `0002_vehicles`, `0003_places_routes`, `0004_trips`, `0005_convoys_chat`, `0006_hazards`, `0007_admin_config`.

Cara menjalankan (direncanakan, belum tersedia): `npm run migration:run` di `backend/` dengan `DATABASE_URL` menunjuk database development. Tidak ada perintah yang dijalankan pada Fase 0.

## 6. Environment variables baru

Belum ada `.env` atau kode yang membacanya. Nama variabel yang akan dibutuhkan (tanpa nilai):

| Variabel | Kegunaan |
|---|---|
| `NODE_ENV` | Mode runtime |
| `PORT` | Port API |
| `DATABASE_URL` | PostgreSQL + PostGIS |
| `REDIS_URL` | Redis |
| `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI` | Verifikasi token |
| `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_FILE` | Push |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage |
| `ROUTING_PROVIDER`, `ROUTING_BASE_URL`, `ROUTING_API_KEY` | Adapter routing |
| `GEOCODING_PROVIDER`, `GEOCODING_BASE_URL`, `GEOCODING_API_KEY` | Adapter geocoding |
| `WEATHER_PROVIDER`, `WEATHER_BASE_URL`, `WEATHER_API_KEY` | Adapter cuaca |
| `MAP_TILE_STYLE_URL`, `MAP_ATTRIBUTION` | Gaya peta |
| `INVITE_HMAC_PEPPER` | Hash kode undangan |
| `PLATE_ENCRYPTION_KEY`, `PLATE_KEY_VERSION` | Enkripsi plat |
| `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` | Billing |
| `RATE_LIMIT_*`, `STALE_AFTER_SECONDS`, `HAZARD_TTL_SECONDS` | Konfigurasi operasional |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Tracing |

Tidak ada nilai, kredensial, atau contoh secret yang valid di repository. `.env.example` belum dibuat karena belum ada kode; akan dibuat di Slice 1A dengan placeholder.

## 7. Perintah yang dijalankan dan hasil aktual

| Perintah | Hasil |
|---|---|
| `git rev-parse --is-inside-work-tree` | `fatal: not a git repository` — bukan repo git |
| `node -v` | v26.13.0 |
| `npm -v` | 11.20.0 |
| `java -version` | 1.8.0_513 — **tidak memenuhi** kebutuhan Gradle Android modern |
| `gradle -v` | tidak ditemukan |
| `docker --version` | tidak ditemukan |
| `psql --version` | tidak ditemukan |
| `python --version` | 3.15.2 |
| Pencarian `docs/**/*` | 0 file sebelum fase ini |
| Audit dokumen Fase 0 | lihat bagian 9; semua file ada dan lolos pemeriksaan teks |

Tidak ada `lint`, `typecheck`, `test`, atau `build` yang dijalankan karena tidak ada kode aplikasi. Tidak ada hasil test yang diklaim.

## 8. Risiko dan known issues

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R-01 | JDK 8 hanya tersedia | Android Gradle build tidak dapat dijalankan | Pasang JDK 17/21 sebelum Slice 1A; verifikasi `java -version` |
| R-02 | Android SDK tidak terdeteksi | Build APK dan UI test tidak dapat dijalankan | Pasang Android Studio/SDK dan terima lisensi |
| R-03 | Docker/PostgreSQL/Redis tidak tersedia | Integration test backend tidak dapat dijalankan lokal | Pasang Docker Desktop atau sediakan database uji |
| R-04 | Repository bukan git | Tidak ada riwayat, review, atau rollback | Inisialisasi git sebelum menulis kode |
| R-05 | Provider peta/routing/geocoding belum dipilih | Exit criteria Fase 0 belum terpenuhi; Slice 1C terblokir untuk rilis | Keputusan lisensi/biaya oleh pemilik produk (O-02) |
| R-06 | Brand/domain/package belum final | Build dapat memakai ID sementara yang sulit diganti setelah Play Console | Tetapkan sebelum pendaftaran aplikasi (O-01) |
| R-07 | Legal/retensi belum ditinjau | Beta berisiko tidak patuh | Tinjau `SECURITY_AND_PRIVACY.md` dan `DATA_MODEL.md` bagian 18 (O-07) |
| R-08 | Angka kapasitas 3/20/30 berasal dari indikasi APK | Salah dibaca sebagai spesifikasi resmi | Diperlakukan sebagai konfigurasi, bukan harga (PRD 5.5, 19.2) |
| R-09 | Repository ini adalah toolkit brain.md | Kebingungan struktur dengan produk | Semua kode produk akan berada di `android/`, `backend/`, `admin/`; toolkit tidak diubah |
| R-10 | OpenAPI belum ada | Kontrak belum dapat divalidasi mesin | Dihasilkan dari DTO di Slice 1A (D-023) |

## 9. Checklist acceptance

### 9.1 Exit criteria PRD 15 Fase 0

| Kriteria | Status | Bukti |
|---|---|---|
| Desain arsitektur disetujui | BLOCKED | `ARCHITECTURE.md` selesai; persetujuan formal pemilik produk belum ada |
| Backlog terpecah | PASS | `ROADMAP.md` bagian 3: tujuh slice dengan gerbang |
| Risiko privasi lokasi dianalisis | PASS | `SECURITY_AND_PRIVACY.md` bagian 7 dan threat model T-02, T-03, T-05 |
| Peta provider dipilih | BLOCKED | `DECISIONS.md` O-02; tidak ada provider yang dikarang |

### 9.2 Checklist PRD 18

| Butir | Status | Bukti |
|---|---|---|
| PRD disetujui sebagai baseline | BLOCKED | Menunggu pemilik produk |
| Brand dan aset tersedia | BLOCKED | O-01 |
| User flow dan wireframe P0 | FAIL | Belum dibuat; fase ini hanya information architecture di PRD 4 dan `SYSTEM_OVERVIEW.md` |
| ERD dan migration plan | PASS | `DATA_MODEL.md` |
| API contract OpenAPI | FAIL | Markdown contract ada; file OpenAPI belum (D-023) |
| Kontrak event WebSocket | PASS | `REALTIME_EVENTS.md` |
| Firebase/OIDC, FCM, peta, routing, geocoding, storage siap | BLOCKED | Belum ada environment atau kredensial |
| Kebijakan permission, privasi, retensi, hapus akun disetujui | BLOCKED | `ANDROID_PERMISSIONS.md` dan default retensi ada; persetujuan legal belum |
| Threat model dan security baseline | PASS | `SECURITY_AND_PRIVACY.md` |
| Test device matrix dan skenario lapangan | PASS | `TEST_PLAN.md` bagian 7; perangkat belum tersedia |
| CI/CD, staging, observability, backup/restore | BLOCKED | Belum ada infrastruktur |
| MVP backlog dipecah | PASS | `ROADMAP.md` bagian 3 |

### 9.3 Kualitas dokumen

| Pemeriksaan | Status | Bukti |
|---|---|---|
| Semua dokumen yang diminta ada | PASS | Audit file di bagian 4 |
| Rujukan requirement memakai ID yang ada di PRD | PASS | Diperiksa otomatis terhadap PRD |
| Tidak ada klaim test yang tidak dijalankan | PASS | Bagian 7 dan 9 menyatakan tidak ada test |
| Tidak ada secret | PASS | Tidak ada file `.env` atau kredensial |

## 10. Rekomendasi fase berikutnya

Mulai **Slice 1A — Walking skeleton** setelah prasyarat mesin dipenuhi: JDK 17/21, Android SDK, Docker atau database uji, dan inisialisasi git. Slice 1A mencakup backend health check, migrasi `0001_core_identity`, verifikasi token, `POST /v1/auth/session`, `GET /v1/me`, shell Android dengan Hilt + Compose, serta CI yang benar-benar dijalankan.

Provider peta tidak diperlukan untuk Slice 1A, sehingga pekerjaan dapat dimulai tanpa menunggu O-02, tetapi Slice 1C tidak boleh dinyatakan selesai sebelum provider diputuskan.

Fase 1 belum dimulai dan menunggu instruksi eksplisit.
