# PHASE 6 REPORT — Integration & P0 Gap Closure

Tanggal: 26 November 2026. Commit dasar: `c191c59` (setelah perbaikan CI). Lingkup: backend, Android, admin, CI, dokumentasi. Tidak ada deployment produksi, tidak ada perubahan `BILLING_ENABLED` atau `PAID_FEATURES_ENABLED`.

## 1. Executive summary

Phase 6 menutup tiga P0 keamanan di backend dengan regresi test, menambahkan dua fitur Android P0 yang sebelumnya tidak ada (chat konvoi dan laporan bahaya), memperbaiki bug CI yang membuat seluruh pipeline merah, dan menyelaraskan dokumentasi dengan kondisi sebenarnya.

Yang **tidak** selesai dan tidak boleh dianggap selesai:

- Media pipeline belum terverifikasi end-to-end. Audit menemukan bahwa presigned upload bukan SigV4 dan `complete` masih mempercayai ukuran dari klien. Ini P0 yang masih terbuka.
- Penghapusan byte objek storage belum terbukti.
- Tidak ada perangkat atau emulator: seluruh uji perilaku Android (FGS, background location, process death, offline) BLOCKED.
- Layar consent/privasi, penghapusan akun, unggah media, dan tempat favorit di Android belum ada.
- Redis, LiveKit, staging, dan Play Billing tetap BLOCKED.

## 2. Repository baseline

| Item | Nilai |
|---|---|
| Branch | `main`, sinkron dengan `origin/main` |
| Commit awal Phase 6 | `e5890ec` (lalu `c191c59` untuk perbaikan CI) |
| Backend | 156 file TypeScript, 9 migrasi (`0001`–`0009`) |
| Android | 45 file Kotlin (termasuk generated sebelum build), 3 layar uji unit |
| Admin | 15 file TSX |
| Test backend | 37 → **40** |
| Test Android | 14 → **16** |
| CI | GitHub Actions, run #3 hijau setelah perbaikan |

Working tree bersih pada awal audit selain satu entri `load-test.mjs` yang hanya berbeda line ending; dinormalisasi tanpa perubahan isi.

## 3. Audit findings

### 3.1 Bug CI (memperbaiki seluruh pipeline)

CI merah pada dua run pertama. Penyebab pastinya bukan build yang gagal: `tsc` berhasil menulis `dist/test/*.test.js`, tetapi `node --test dist/test` pada **Node 22** memperlakukan argumen direktori sebagai entry point modul, sehingga muncul `Cannot find module '.../dist/test'`. Node 26 (dipakai lokal) menerima direktori, sehingga bug ini tidak terlihat di mesin pengembang.

Direproduksi persis dengan Node 22.23.5 pada clone bersih: `Cannot find module ...dist\test`, kode keluar 1. Setelah diganti menjadi glob eksplisit, 37/37 lulus pada Node 22 dan Node 26.

Perbaikan: `backend/package.json` → `node --test "dist/test/*.test.js"`.

### 3.2 Keamanan backend

| Temuan | Tingkat | Status |
|---|---|---|
| Konfirmasi reset kata sandi memeriksa `used_at` di aplikasi lalu memperbarui di transaksi terpisah; dua permintaan bersamaan dapat sama-sama menang | P0 | **Diperbaiki** |
| Tidak ada batas login per akun; throttler hanya per IP, sehingga serangan terdistribusi ke satu akun atau credential stuffing lintas akun lolos | P0 | **Diperbaiki** |
| Parameter `:id` tidak divalidasi UUID; nilai non-UUID menjadi error cast PostgreSQL (500) | P1 | **Diperbaiki** |
| `email/verify` memakai pola baca-lalu-tulis yang sama dengan reset | P1 | **Diperbaiki** |
| Presigned upload bukan SigV4; HMAC atas string non-kanonikal | P0 | **Terbuka** |
| `complete` mempercayai `sizeBytes` klien; tidak ada HEAD objek, ukuran/MIME/checksum storage tidak diverifikasi | P0 | **Terbuka** |
| Penghapusan akun belum terbukti menghapus byte objek storage; tidak ada worker outbox yang diuji | P0 | **Terbuka** |
| Redis nyata belum diuji untuk rate limit dan presence | P1 | BLOCKED |

### 3.3 Android

Endpoint chat dan bahaya tidak ada di `RiderJourneyApi`. Tidak ada layar chat, bahaya, consent, penghapusan akun, media, maupun favorit. Enam tab lama: beranda, garasi, rute, trip, konvoi, profil.

### 3.4 Dokumentasi

- `README.md` di root adalah README toolkit `brain.md`, bukan produk RiderJourney.
- `docs/ROADMAP.md` menyatakan fase 1–4 "belum dimulai" padahal kode fase 1–5 ada.
- `docs/PRODUCTION_READINESS.md` masih menyebut 36 test.
- `docs/TEST_PLAN.md` berhenti di 36 test dan belum mencatat Phase 6.
- `docs/API_CONTRACT.md` belum memuat kode error baru.
- `docs/PHASE_REPORTS/` hanya berisi laporan fase 0 dan 1; laporan fase 2, 4, 5 ada di root. Ini dipertahankan sebagai arsip, tidak dipindahkan.

## 4. P0 issues fixed

1. **Reset kata sandi atomik.** Token dikonsumsi dalam satu pernyataan:
   `UPDATE one_time_tokens SET used_at = now() WHERE token_hash = $1 AND kind = 'password_reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`.
   Hanya pemenang yang melanjutkan; seluruh refresh token dicabut pada transaksi yang sama.
2. **Batas login per akun.** Tabel `login_throttles` (migrasi `0009_phase6.sql`) menyimpan hash email, jumlah gagal, awal jendela, dan waktu kunci. Penghitungan memakai satu `INSERT ... ON CONFLICT DO UPDATE` agar konkuren tidak saling menimpa. 10 kegagalan dalam 15 menit mengunci 15 menit; login sukses menghapus baris.
3. **Batas percobaan pada endpoint token.** `password/reset/confirm` dan `email/verify` mendapat throttle 10/menit.

## 5. P1 issues fixed

- Validasi UUID pada chat, bahaya, dan media melalui `UuidParamPipe` → `400 INVALID_ID`.
- `email/verify` kini mengonsumsi token secara atomik.
- `docs/ROADMAP.md`, `docs/REQUIREMENTS_MATRIX.md`, `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md`, `docs/API_CONTRACT.md`, dan `README.md` diperbarui.

Tidak diperbaiki karena di luar bukti yang tersedia: dua arah blokir (sudah ada dan diuji sebelumnya), pagination kursor komposit (sudah ada), konsistensi izin ban admin, pencabutan token LiveKit, dan masa berlaku akses voice.

## 6. Android implementation

Ditambahkan:

| Berkas | Isi |
|---|---|
| `data/api/ChatModels.kt` | DTO pesan, halaman, permintaan kirim |
| `data/api/HazardModels.kt` | DTO bahaya, daftar, buat, konfirmasi, laporan |
| `data/ChatHazardRepository.kt` | `ChatRepository`, `HazardRepository` |
| `ui/ChatViewModel.kt` | Muat halaman, pagination `before`, kirim optimistis, retry dengan `clientMessageId` yang sama, dedupe, penanganan `CHAT_BLOCKED` |
| `ui/ChatScreen.kt` | Daftar pesan, keadaan loading/empty/error, tombol muat lama, input, status kirim/gagal |
| `ui/HazardViewModel.kt` | Lokasi terakhir dengan pemeriksaan izin, muat sekitar, buat laporan, konfirmasi/tidak relevan |
| `ui/HazardScreen.kt` | Pemilihan kategori, catatan, daftar bahaya + jarak + hitungan konfirmasi |
| `ui/AppRoot.kt` | Tab `Chat` dan `Bahaya` |

Batasan yang disadari:

- Chat belum berlangganan event realtime; pesan baru dari anggota lain terlihat setelah memuat ulang. Backend sudah mempublikasikan event, klien belum mengonsumsinya.
- Foto bahaya belum dapat dipilih; hanya jenis, koordinat, dan catatan.
- Tidak ada uji perangkat. Yang terbukti hanya kompilasi, unit test, dan APK debug.

## 7. Backend implementation

- `migrations/0009_phase6.sql` — `login_throttles`.
- `auth/auth.service.ts` — lockout per akun, konsumsi token atomik untuk reset dan verifikasi email.
- `auth/auth.controller.ts` — throttle pada konfirmasi reset dan verifikasi email.
- `common/uuid.pipe.ts` — pipe UUID dengan bentuk problem-details proyek.
- `chat/chat.controller.ts`, `hazards/hazards.controller.ts`, `media/media.controller.ts` — memakai pipe tersebut.
- `test/phase6.test.ts` — 3 test regresi.
- Lima berkas test lama diperbarui karena daftar migrasi bertambah satu.

## 8. Media pipeline

Audit, bukan implementasi. Yang ada: intent upload dengan batas tipe/ukuran, penolakan tipe video/foto yang tidak cocok, idempotensi `clientMediaId`, signed GET dengan masa berlaku, dan pemeriksaan visibilitas lintas pengguna.

Yang tidak memenuhi persyaratan Phase 6:

- Signature upload bukan SigV4 kanonikal (tidak akan diterima S3/MinIO).
- Tidak ada verifikasi `HEAD` objek; ukuran akhir dan MIME berasal dari klien.
- Tidak ada verifikasi checksum terhadap objek yang tersimpan.
- Tidak ada worker penghapusan objek yang idempoten dan dapat di-retry.
- Tidak ada uji MinIO.

Karena itu status media pipeline adalah **BLOCKED**, bukan PASS. Menulis kode SigV4 tanpa storage nyata hanya akan menghasilkan klaim yang tidak dapat dibuktikan.

## 9. Security validation

Dijalankan: `npm run typecheck`, `npm test` (40/40), `npm audit --omit=dev` (0 kerentanan pada backend dan admin), dan test regresi Phase 6.

Tidak dijalankan: uji penetrasi, uji beban, uji otorisasi dua akun baru untuk seluruh endpoint (sebagian sudah ada di test lama), dan uji media terhadap storage.

## 10. Integration test results

| Perintah | Hasil |
|---|---|
| `cd backend && npm run typecheck` | exit 0 |
| `cd backend && npm test` | 40 lulus, 0 gagal |
| `node tools/junk-check.mjs` (dari `backend/`) | 0 baris mencurigakan |
| `cd admin && npm run build` | sukses |
| `npm audit --omit=dev` backend & admin | 0 kerentanan |
| GitHub Actions CI #3 (`main`, `c191c59`) | sukses (backend + admin) |
| GitHub Actions CI #4 (`main`, `0c6af38`) | sukses: backend, admin, dan android |

Job `android` pada CI #4 menjalankan `./gradlew --no-daemon testDebugUnitTest assembleDebug` dengan Java 21 dan lulus, sehingga build Android juga tervalidasi di GitHub, bukan hanya di mesin lokal.

## 11. Android device test results

**BLOCKED.** Tidak ada emulator berjalan dan tidak ada perangkat terhubung. Tidak ada `adb` pada PATH. Yang tersedia hanya Android SDK, Gradle wrapper, dan JDK 21 yang diunduh untuk sesi ini.

Reproduksi yang harus dilakukan pada perangkat:

1. Login, buat konvoi, buka tab Chat, kirim pesan dari dua akun.
2. Matikan jaringan saat mengirim, pastikan status `failed`, lalu nyalakan dan tekan "coba lagi" — pastikan tidak ada pesan ganda.
3. Buka tab Bahaya, tolak izin lokasi, pastikan aksi ditolak dengan alasan; beri izin lalu laporkan.
4. Konfirmasi "masih ada" dan "tidak relevan" dari akun lain.
5. Background/process death saat merekam trip dan saat konvoi berbagi lokasi.
6. Layar mati selama perekaman; cabut izin lokasi saat layanan berjalan.

Belum satu pun dari langkah di atas dijalankan.

## 12. Build results

| Target | Perintah | Hasil |
|---|---|---|
| Backend typecheck | `npm run typecheck` | exit 0 |
| Backend build+test | `npm test` | 40/40 |
| Admin | `npm run build` | sukses |
| Android unit test | `./gradlew testDebugUnitTest` (JDK 21) | 16/16 |
| Android APK | `./gradlew assembleDebug` | sukses, `app-debug.apk` 58 MB |

Catatan lingkungan: Gradle 8.13 menolak JDK 25 yang terpasang di mesin. Build hanya berhasil dengan JDK 21. Ini perlu dicatat di README (sudah) dan di CI (job memakai Java 21).

## 13. API changes

Tidak ada endpoint baru. Perubahan perilaku:

- `POST /v1/auth/login` → `429 LOGIN_LOCKED` + `retryAfterSeconds` setelah 10 kegagalan per akun.
- `POST /v1/auth/password/reset/confirm`, `POST /v1/auth/email/verify` → konsumsi token atomik.
- `400 INVALID_ID` untuk parameter UUID yang tidak valid pada chat, bahaya, dan media.

`docs/openapi.json` tidak berubah karena tidak ada path atau skema baru.

## 14. Migration changes

`0009_phase6.sql`: tabel `login_throttles` dan indeks `login_throttles_locked_idx`. Tidak ada perubahan destruktif. Migrasi berjalan otomatis pada test dan `npm run migration:run`.

## 15. Known limitations

- Chat Android belum realtime; hanya memuat ulang.
- Bahaya Android belum mendukung foto.
- Belum ada layar consent, penghapusan akun, unggah media, tempat favorit.
- Presigned upload belum SigV4; `complete` belum memverifikasi objek.
- Penghapusan objek storage belum diuji.
- Chat belum menerima pesan realtime (perlu muat ulang).
- `junk-check` dijalankan dari `backend/`, sesuai `working-directory` workflow.

## 16. Remaining blockers

| Blocker | Alasan |
|---|---|
| Perangkat/emulator Android | Tidak tersedia |
| S3/MinIO | Tidak ada endpoint, kredensial, atau container |
| Redis nyata | Tidak ada instance |
| LiveKit | Tidak ada server/kredensial |
| Staging, backup/restore, load test | Tidak ada infrastruktur |
| Play Billing | Tidak ada akun/produk |
| Keystore Android | Tidak ada |

## 17. Acceptance checklist

| Kriteria | Status | Bukti |
|---|---|---|
| Chat Android terhubung ke backend | PASS | Endpoint nyata dipakai, kompilasi + unit test; perilaku perangkat BLOCKED (bagian 11) |
| Hazard Android terhubung ke backend | PASS | Sama seperti chat; foto dan realtime belum |
| Privacy dan consent flow tersedia | FAIL | Backend ada; layar Android belum ada |
| Account deletion flow tersedia | FAIL | Backend ada; layar Android belum ada |
| Avatar dan vehicle media berfungsi | FAIL | Backend ada; unggah Android belum ada |
| Favorite places berfungsi | FAIL | Endpoint backend ada; Android belum memakai |
| Upload pipeline tervalidasi end-to-end | BLOCKED | Tidak ada storage; presign bukan SigV4 |
| Object deletion tervalidasi | BLOCKED | Tidak ada storage; worker belum ada |
| Password reset race diperbaiki | PASS | `phase6.test.ts`, dua konfirmasi paralel |
| Login rate limit diperbaiki | PASS | `phase6.test.ts`, 9×401 lalu 429, kunci tidak bisa dilewati |
| Authorization chat dan hazard lolos test | PASS | Membership guard + 400/404 di `phase6.test.ts`; blokir dua arah di `phase2.test.ts` |
| Android build dan test lulus | PASS | 16/16 unit test, APK debug |
| Backend build dan test lulus | PASS | 40/40, typecheck exit 0 |
| Admin build lulus | PASS | `npm run build` sukses |
| Dokumentasi mencerminkan kondisi aktual | PASS | README, roadmap, matrix, kontrak, test plan, readiness diperbarui |

Empat kriteria FAIL dan dua BLOCKED adalah hasil sebenarnya. Tidak ada yang diubah menjadi PASS karena kode backend sudah ada.

## 18. Recommended next phase

1. **Selesaikan media P0 lebih dulu.** Implementasikan SigV4 kanonikal, verifikasi `HEAD` objek (ukuran, MIME, ETag), dan worker penghapusan berbasis outbox. Uji dengan MinIO di CI sebelum menyentuh fitur lain.
2. **Layar Android yang tersisa**: consent, penghapusan akun (dengan konfirmasi dan status server), unggah avatar/foto kendaraan dengan progres dan retry, tempat favorit.
3. **Realtime chat di klien** dan notifikasi bahaya.
4. **Uji perangkat nyata** untuk FGS, background location, process death, dan pergantian jaringan.
5. **Observability dan staging** sebelum klaim kesiapan produksi.

Jangan menaikkan status media atau uji perangkat sebelum ada bukti yang dapat dijalankan ulang.
