# TEST PLAN — RiderJourney

Rencana pengujian yang proporsional terhadap risiko. Mengacu pada PRD 14 dan 11.1. Tidak ada test yang sudah dijalankan pada Fase 0 karena belum ada kode; dokumen ini menetapkan apa yang harus ada dan bagaimana hasilnya dibuktikan.

## 1. Prinsip

- Setiap fitur diuji pada lapisan tempat logikanya berada: aturan bisnis di unit test, kontrak HTTP di integration test, alur pengguna di UI test.
- Tidak ada klaim "sudah diuji" tanpa perintah dan keluaran yang terlihat.
- Test yang gagal karena bug diperbaiki, bukan dihapus atau dilemahkan.
- Data uji tidak boleh memakai data produksi; seed hanya untuk development/test.
- Keamanan diuji dengan dua akun nyata di lingkungan uji, bukan dengan menyembunyikan tombol.

## 2. Piramida dan alat

| Lapisan | Cakupan | Alat yang direncanakan | Lingkungan |
|---|---|---|---|
| Unit backend | Use case, validator, entitlement, perhitungan trip, confidence bahaya, otorisasi murni | Jest, ts-jest | CI, tanpa I/O |
| Integration backend | Repository, transaksi, constraint, migrasi, route HTTP, WebSocket | Jest + Supertest + Testcontainers (PostgreSQL/PostGIS, Redis) | CI |
| Contract | Skema request/response terhadap `openapi.yaml`; event WebSocket | Validator skema + fixture | CI |
| Unit Android | ViewModel, use case, mapper, filter GPS, state machine | JUnit, MockK, Turbine, kotlinx-coroutines-test | CI |
| Repository Android | Mapping error, retry, cache, pagination | MockWebServer, Room in-memory | CI |
| UI Android | Alur kritis: onboarding, mulai tracking, join konvoi, kirim laporan | Compose UI Test, Robolectric bila sesuai | Emulator/perangkat |
| Security | IDOR, role escalation, invite abuse, data exposure | Test dua akun + skrip khusus | Staging |
| Load | 30 anggota/konvoi, banyak konvoi, WebSocket fan-out | k6 atau alat setara | Staging terisolasi |
| Manual lapangan | GPS, baterai, OEM, jaringan | Matriks perangkat PRD 14.2 | Perangkat nyata |

## 3. Matriks requirement ke pengujian

| Requirement | Unit | Integration | UI | Security | Catatan |
|---|---|---|---|---|---|
| ACC-01…ACC-03 | ✓ | ✓ | ✓ | ✓ | Duplikat username, format, sesi |
| ACC-04 hapus akun | ✓ | ✓ | ✓ | ✓ | Status permintaan, data turunan |
| ACC-05 consent | ✓ | ✓ | ✓ | — | Versi dan waktu tersimpan |
| RID-01/02, VEH-01…03 | ✓ | ✓ | ✓ | ✓ | Plat tidak bocor |
| MAP-02…05 | ✓ | ✓ | ✓ | — | Provider gagal, waypoint 1–7 |
| TRP-01…05 | ✓ | ✓ | ✓ | — | Layar mati, GPS hilang, pemulihan |
| CNV-01…06 | ✓ | ✓ | ✓ | ✓ | Kapasitas, invite, posisi |
| COM-01 | ✓ | ✓ | ✓ | ✓ | Retry tidak menggandakan |
| SAF-01…03 | ✓ | ✓ | ✓ | ✓ | TTL, duplikat, konfirmasi |
| Notifikasi | ✓ | ✓ | — | — | Idempoten |
| Admin minimum | ✓ | ✓ | — | ✓ | Audit |
| PRD 14.1 seluruh daftar | — | — | — | — | Menjadi acuan skenario manual |

## 4. Unit test yang wajib ada

### 4.1 Aturan bisnis

| ID | Kasus |
|---|---|
| BR-01 | Start trip kedua saat sesi aktif → 409; setelah finish → boleh |
| BR-02 | Join konvoi kedua saat masih aktif → 409; setelah keluar → boleh |
| BR-03 | Anggota biasa mengubah rute → 403; leader/co-leader → 200 dan `version` naik |
| BR-04 | Invite kedaluwarsa, melebihi `max_uses`, sudah di-revoke → ditolak |
| BR-05 | Location event tanpa consent atau konvoi tidak aktif → ditolak |
| BR-06 | `last_seen_at` lebih tua dari ambang → `stale: true` |
| BR-07 | Leader disconnect dengan co-leader → handoff; tanpa co-leader → status menunggu |
| BR-08 | Lompatan GPS ekstrem → flag kualitas, bukan ban |
| BR-09 | Hazard lewat `expires_at` → tidak muncul di nearby; confidence turun |
| BR-10 | Kapasitas dari entitlement, bukan dari body klien |
| BR-11 | Hapus akun → data turunan diproses, token dicabut |
| BR-12 | Pengguna diblokir tidak dapat mengirim pesan/mention |
| BR-13 | Retry upload/pesan tidak menggandakan |
| BR-14 | Offline → state degraded, bukan sukses palsu |
| BR-15 | Sesi tidak ditutup → draft `recovered`, bukan hilang |

### 4.2 Perhitungan

- Jarak trip: haversine/PostGIS, tolak titik akurasi rendah dan lompatan; hasil sama untuk data yang sama.
- Durasi: waktu berjalan tanpa jeda `paused`.
- Kecepatan rata-rata: jarak/durasi bergerak, bukan rata-rata kecepatan titik.
- Confidence bahaya: fungsi konfirmasi + usia laporan; monoton dan terbatas 0–1.
- Stale: batas tepat pada ambang (uji batas).
- Entitlement: paket, override, grace period, refund.

## 5. Integration test backend

- Migrasi dari database kosong berhasil dan dapat diulang (`migrate up`, `migrate down` bila didukung).
- Constraint ditegakkan: unique trip aktif, unique konvoi aktif, unique `client_message_id`, unique `provider_txn_id`.
- Transaksi: kegagalan di tengah start konvoi tidak meninggalkan anggota yatim.
- Otorisasi endpoint: tabel kasus untuk setiap resource (pemilik, anggota, non-anggota, moderator).
- WebSocket: handshake tiket, langganan room, penolakan tiket kedaluwarsa, broadcast posisi, pencabutan saat keluar.
- Idempotency: dua request dengan key sama menghasilkan satu baris dan respons sama.
- Pagination: cursor stabil saat ada data baru; tidak ada duplikat/hilang.
- Error mapping: provider timeout → 503 dengan kode, bukan 500.

## 6. UI test Android (alur kritis)

1. Onboarding → daftar/login → consent → profil minimum.
2. Buka peta → cari tempat → pilih tujuan → preview rute → mulai trip.
3. Tracking berjalan → jeda → lanjut → selesai → riwayat terbuka.
4. Buat konvoi → anggota join → posisi tampil → keluar → posisi hilang.
5. Kirim pesan saat offline → indikator pending → reconnect → terkirim sekali.
6. Buat laporan bahaya → tampil di peta → kedaluwarsa.
7. Izin ditolak: peta, tracking, mikrofon (Fase 2).

Setiap alur memeriksa state loading, empty, error, permission denied, dan offline.

## 7. Pengujian GPS dan kondisi lapangan

| Skenario | Data | Ekspektasi |
|---|---|---|
| Akurasi rendah | accuracy > ambang | Ditandai `low_accuracy`, tidak menambah jarak agresif |
| Lonjakan | Titik melompat 5 km dalam 2 detik | Ditolak/flag, tidak menambah jarak |
| GPS hilang | Tidak ada titik 2 menit | `gap` tersimpan, jarak tidak diinterpolasi |
| Terowongan | Akurasi memburuk lalu pulih | Marker stale, pemulihan tanpa duplikasi |
| Layar mati | Sesi aktif, layar dimatikan 30 menit | Tracking berlanjut sesuai izin, notifikasi tampil |
| Aplikasi dibunuh OS | Force stop saat sesi | Sesi dapat dipulihkan sebagai draft |
| Jaringan putus | Offline 10 menit | Titik tersimpan lokal, terkirim setelah pulih, tanpa duplikat |
| Berpindah Wi-Fi/seluler | Reconnect | WebSocket pulih, tidak ada pesan ganda |
| Hemat baterai | Mode aktif | Sampling menurun, indikator akurasi muncul |
| Simulasi 30 anggota | 30 klien satu konvoi | p95 update sesuai target PRD 1.4 pada lingkungan uji |

Alat: lokasi simulasi (GPX/fake provider), kontrol jaringan, dan perangkat fisik untuk validasi akhir.

## 8. Security test

| Kasus | Ekspektasi |
|---|---|
| Akun A membaca trip/kendaraan/pesan akun B | 404/403, tidak ada data |
| Anggota biasa mengubah role atau mengeluarkan leader | 403 |
| Non-anggota membuka WebSocket konvoi | 401/403 |
| Anggota keluar lalu memakai tiket lama | Ditolak |
| Brute force kode undangan | 429 setelah batas, audit |
| Upload file dengan MIME palsu | 415 |
| Signed URL kedaluwarsa | 403 |
| Moderator mencari pesan tanpa laporan | 403 |
| Replay `purchaseToken` | Tidak menambah entitlement |
| Log dan crash report | Tidak memuat token/koordinat/plat |
| Endpoint admin tanpa role | 403, audit percobaan |

## 9. Load test

Target mengikuti PRD 11.1 dan 1.4, diukur bukan diasumsikan:

- 30 anggota aktif dalam satu konvoi mengirim posisi setiap 5 detik.
- Beberapa konvoi serentak sesuai kapasitas staging yang disepakati.
- 100 pesan/menit per konvoi.
- Reconnect 10% klien secara bersamaan.
- Kriteria: tidak ada kehilangan event tanpa terdeteksi, p95 latensi sesuai target PRD, error rate dapat diterima, memori Redis stabil.

Hasil load test harus disertai tanggal, commit, ukuran instance, dan skrip yang dipakai. Belum ada yang dijalankan.

## 10. Gerbang CI

| Tahap | Perintah (direncanakan) | Gagal bila |
|---|---|---|
| Backend lint | `npm run lint` | Error lint |
| Backend typecheck | `npm run typecheck` | Error tipe |
| Backend unit | `npm test` | Test gagal |
| Backend integration | `npm run test:integration` | Container gagal atau test gagal |
| Kontrak | validasi OpenAPI yang dihasilkan dari DTO (dibuat pada awal Fase 1) | Skema tidak valid atau berbeda dari `API_CONTRACT.md` |
| Android lint | `./gradlew lintDebug` | Error lint |
| Android unit | `./gradlew testDebugUnitTest` | Test gagal |
| Android build | `./gradlew assembleDebug` | Build gagal |
| Admin | `npm run lint && npm run build` | Gagal |

Prasyarat mesin saat ini belum terpenuhi: JDK 8 bukan JDK 17/21, Android SDK tidak terdeteksi, Docker tidak tersedia. Lihat `PHASE_REPORTS/PHASE_0_REPORT.md`.

## 11. Bukti dan pelaporan

Setiap laporan fase mencantumkan:

- perintah yang dijalankan,
- kode keluar,
- ringkasan keluaran (jumlah test lulus/gagal),
- commit/working tree saat dijalankan,
- hal yang tidak dapat dijalankan beserta alasannya.

Screenshot atau rekaman hanya bukti tambahan, bukan pengganti test otomatis.

## 12. Bukti Fase 4 (dijalankan 2026-11-25)

Perintah: `cd backend && npm test` (build TypeScript + seluruh `dist/test`).

| Berkas | Cakupan | Hasil |
|---|---|---|
| `api.test.ts` | baseline auth, kendaraan, rute, trip, GPS noise | lulus |
| `phase2.test.ts` | convoy realtime dan kapasitas | lulus |
| `phase4.test.ts` | enam migrasi berurutan + tabel baru | lulus |
| `phase4.social.test.ts` | audience private/public/followers/community, cross-user, feed & komentar pagination, idempotensi reaksi, save/mention/hashtag/report/block/mute, album quota/permission/moderation | lulus |
| `phase4.replay.test.ts` | validasi ukuran/tipe/isi upload, signed URL akses + kedaluwarsa, replay gap/spike/low-accuracy + marker foto, poster SVG + export, poin/badge/leaderboard, preferensi notifikasi + rotate perangkat, hapus data sosial | lulus |

Hasil: **23 test lulus, 0 gagal**. `node tools/junk-check.mjs` melaporkan 0 baris mencurigakan pada 168 berkas. OpenAPI diregenerasi: 100 path.

Belum dijalankan pada fase ini: build Android, uji FCM dengan kredensial nyata, uji bucket S3 nyata, dan uji beban sosial.

## 13. Bukti Fase 5 (dijalankan 24 November 2026)

Perintah: `cd backend && npm test` (build TypeScript + seluruh `dist/test`).

| Berkas | Cakupan | Hasil |
|---|---|---|
| `api.test.ts` | baseline auth, kendaraan, rute, trip, GPS noise | lulus |
| `phase2.test.ts` | convoy realtime dan kapasitas | lulus |
| `phase4.test.ts` | tujuh migrasi berurutan + tabel baru | lulus |
| `phase4.social.test.ts` | audience, feed, komentar, album, moderasi | lulus |
| `phase4.replay.test.ts` | upload, signed URL, replay, poster, poin, notifikasi, deletion | lulus |
| `phase5.test.ts` | verifikasi billing palsu, replay token, notifikasi idempoten, batas kendaraan, RBAC/MFA/step-up, redeem idempoten, audit, export/deletion, kill switch | lulus |

Hasil: **29 test lulus, 0 gagal, exit 0**. `node tools/junk-check.mjs` melaporkan 0 baris mencurigakan pada 200 berkas. OpenAPI diregenerasi: **134 path**. `cd admin && npm run build` sukses dengan Next.js 16.4.6.

Tidak dijalankan pada fase ini:

- verifikasi Google Play nyata, RTDN Pub/Sub, dan service account;
- PostgreSQL/Redis/storage produksi dan uji backup/restore;
- load test staging (`backend/tools/load-test.mjs` tersedia, belum dieksekusi);
- klik-through browser admin, uji dua peran end-to-end, dan audit aksesibilitas;
- build Android, signing, crash monitoring, dan staged rollout.

## 14. Bukti API komunitas (dijalankan 24 November 2026)

Perintah: `cd backend && npm test` (build TypeScript + seluruh `dist/test`).

| Berkas | Cakupan | Hasil |
|---|---|---|
| `community.test.ts` | create komunitas + seed permission, join privat menjadi request, approve/decline, daftar anggota, perubahan role dengan permission, audit, post audience komunitas, album komunitas + media, join publik langsung | lulus |

Hasil: **36 test lulus, 0 gagal, exit 0**. `node tools/junk-check.mjs` melaporkan 0 baris mencurigakan pada 205 berkas. OpenAPI diregenerasi: **151 path**.
