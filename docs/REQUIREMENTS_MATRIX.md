# REQUIREMENTS MATRIX — RiderJourney

Matriks seluruh requirement ber-ID pada PRD 5, dipetakan ke modul, dependensi, status awal, fase target, dan acceptance criteria. Sumber: `PRD_RiderJourney.md` bagian 5; fase mengikuti PRD 15 dan `ROADMAP.md`.

Konvensi:

- **P** = prioritas PRD (`P0` wajib MVP, `P1` rilis lanjutan, `P2` ekspansi).
- **Status awal** = kondisi repository saat Fase 0: tidak ada kode aplikasi, jadi semua `Belum ada`.
- **Fase** = fase PRD tempat requirement dijadwalkan, bukan tanggal.
- Acceptance criteria diringkas dari kolom PRD; bila berbeda, PRD menang.

## 1. Akun, profil, kendaraan, peta

| ID | P | Modul/domain | Dependensi | Status awal | Fase | Acceptance criteria |
|---|---|---|---|---|---|---|
| ACC-01 | P0 | identity | OIDC/Firebase, email, `users` | Belum ada | 1 | Akun tercipta satu kali; email terverifikasi sebelum fitur sensitif |
| ACC-02 | P0 | identity | token verifier, `device_tokens` | Belum ada | 1 | Token tersimpan aman; logout mengakhiri sesi lokal dan token dapat dicabut |
| ACC-03 | P0 | profiles | `users.username`, filter profaniti | Belum ada | 1 | Duplikat ditolak server; format dan profaniti divalidasi |
| ACC-04 | P0 | identity | job penghapusan, audit, retensi | Belum ada | 1 | Konfirmasi ulang; autentikasi dinonaktifkan; data dihapus/dianonimkan; status tercatat |
| ACC-05 | P0 | identity | `user_consents` | Belum ada | 1 | Versi, waktu, dan konteks persetujuan tersimpan |
| RID-01 | P0 | profiles | media avatar, visibilitas | Belum ada | 1 | Perubahan tersimpan dan terlihat sesuai pengaturan visibilitas |
| RID-02 | P0 | profiles | `user_settings`, otorisasi | Belum ada | 1 | Pengguna dapat menyembunyikan plat, riwayat, lokasi, dan daftar sosial |
| RID-03 | P1 | profiles | aset berlisensi, entitlement | Belum ada | 3 | Aset dapat dipilih sesuai hak akses dan lisensi aset |
| VEH-01 | P0 | vehicles | media foto | Belum ada | 1 | Field minimum: jenis, merek, model, tahun opsional, cc opsional, foto, nama panggilan |
| VEH-02 | P1 | vehicles | `plans`/kuota, kendaraan utama | Belum ada | 2 | Kendaraan utama tampil di profil/rekap; batas jumlah dapat dikonfigurasi per paket |
| VEH-03 | P0 | vehicles | enkripsi kolom, KMS | Belum ada | 1 | Plat terenkripsi dan tidak tampil pada feed atau peta |
| MAP-01 | P0 | maps | lokasi runtime, MapLibre | Belum ada | 1 | Status akurasi dan waktu pembaruan posisi terlihat |
| MAP-02 | P0 | places | geocoding adapter | Belum ada | 1 | Hasil memuat nama, jenis, jarak, koordinat; empty/error punya state jelas |
| MAP-03 | P0 | routing | editor waypoint, peta | Belum ada | 1 | Maksimal 7 waypoint; dapat ditambah, dihapus, diurutkan, dipilih dari peta/pencarian |
| MAP-04 | P0 | routing | routing adapter + fallback | Belum ada | 1 | Minimal satu rute valid; alternatif tampil bila provider mengembalikan |
| MAP-05 | P0 | places | akun, sinkronisasi favorit | Belum ada | 1 | Favorit tersinkron ke akun dan dapat dihapus |
| MAP-06 | P1 | maps | tile provider, lisensi | Belum ada | 2 | Aturan atribusi provider ditampilkan dengan benar |
| MAP-07 | P1 | navigation | voice guidance, prioritas audio | Belum ada | 2 | Suara dapat dimatikan; instruksi tidak mengganggu PTT |
| MAP-08 | P1 | navigation | cuaca, hazard, rute | Belum ada | 2 | Peringatan diberi waktu pembaruan dan sumber; cuaca bukan jaminan keselamatan |
| MAP-09 | P2 | maps | provider premium, biaya | Belum ada | 4 | Bergantung izin, biaya, dan ketersediaan provider |

## 2. Touring, konvoi, komunikasi, keselamatan

| ID | P | Modul/domain | Dependensi | Status awal | Fase | Acceptance criteria |
|---|---|---|---|---|---|---|
| TRP-01 | P0 | trips | `trips`, auth | Belum ada | 1 | Sesi memiliki ID, status, waktu mulai, dan identitas rider |
| TRP-02 | P0 | trips + location | FGS, background location, izin | Belum ada | 1 | Foreground notification tampil; pengguna dapat menghentikan tracking |
| TRP-03 | P0 | trips | filter GPS, agregasi | Belum ada | 1 | Perhitungan mengabaikan lonjakan tidak wajar dan menyimpan kualitas data |
| TRP-04 | P0 | trips | state machine, Room | Belum ada | 1 | Transisi tervalidasi; sesi tidak berakhir hanya karena aplikasi background |
| TRP-05 | P0 | trips | riwayat, peta, kendaraan | Belum ada | 1 | Detail memuat peta rute, waktu, jarak, durasi, dan kendaraan |
| TRP-06 | P1 | trips/replay | data titik, media | Belum ada | 3 | Replay dapat diputar, dijeda, dipilih kecepatannya; foto mengikuti izin |
| TRP-07 | P1 | media/poster | template original, galeri | Belum ada | 3 | Poster memakai template original; output tersimpan ke galeri |
| TRP-08 | P2 | media/export | worker, storage, entitlement | Belum ada | 4 | Resolusi dibatasi perangkat/storage/entitlement; proses tidak mengunci UI |
| CNV-01 | P0 | convoys | `convoys`, `convoy_invites` | Belum ada | 1 | Kode/link undangan unik dan dapat dicabut |
| CNV-02 | P0 | convoys | invite hash, kapasitas, status | Belum ada | 1 | Server memvalidasi kapasitas, status konvoi, dan kebijakan akses |
| CNV-03 | P0 | convoys | audit, realtime | Belum ada | 1 | Perubahan anggota tercatat di audit log dan dikirim real-time |
| CNV-04 | P0 | realtime | consent, Redis, WS | Belum ada | 1 | Hanya anggota aktif berhak melihat lokasi; stale/offline terlihat |
| CNV-05 | P0 | convoys | transaksi status, WS | Belum ada | 1 | Semua anggota menerima status sesi yang konsisten |
| CNV-06 | P0 | maps/convoy | snapshot posisi, rute | Belum ada | 1 | Marker punya identitas/arah dan tidak menampilkan data sensitif berlebih |
| CNV-07 | P1 | convoys | aturan handoff, audit | Belum ada | 2 | Jika leader terputus, co-leader dapat mengambil alih sesuai aturan |
| CNV-08 | P1 | billing/entitlement | `plans`, `plan_entitlements` | Belum ada | 4 | Kapasitas ditetapkan backend dan tidak dapat dimanipulasi aplikasi |
| COM-01 | P0 | chat | `convoy_messages`, WS | Belum ada | 1 | Pesan punya sender, timestamp, delivery state, dan pagination |
| COM-02 | P1 | chat | deep link, permission | Belum ada | 2 | Tautan membuka koordinat/rute di aplikasi dan memeriksa permission |
| COM-03 | P1 | voice | LiveKit, `RECORD_AUDIO` | Belum ada | 2 | Tombol PTT besar, status transmit terlihat, audio hanya dikirim saat ditekan |
| COM-04 | P1 | voice | LiveKit, presence | Belum ada | 2 | Daftar peserta dan mute state tampil; pengguna dapat mute diri dan keluar |
| COM-05 | P2 | voice/audio | lisensi audio, prioritas | Belum ada | 2 | Sumber audio legal; PTT dan navigasi diprioritaskan di atas musik |
| COM-06 | P1 | chat/realtime | reconnect, dedup | Belum ada | 2 | UI menunjukkan reconnect dan tidak menggandakan pesan/anggota |
| SAF-01 | P0 | hazards | geospasial, media | Belum ada | 1 | Laporan menyimpan jenis, koordinat, waktu, catatan opsional, foto opsional |
| SAF-02 | P0 | hazards | TTL job, PostGIS | Belum ada | 1 | Laporan lama ber-TTL; duplikat dapat digabung/ditandai |
| SAF-03 | P0 | hazards | konfirmasi, reputasi | Belum ada | 1 | Reputasi memperhitungkan konfirmasi, bukan jumlah klik mentah |
| SAF-04 | P1 | navigation/safety | hazard, preferensi | Belum ada | 2 | Peringatan tidak menutupi seluruh peta dan dapat diatur |
| SAF-05 | P1 | places | POI provider | Belum ada | 2 | Kategori dari data provider; tidak menjamin layanan buka |
| SAF-06 | P1 | profiles/safety | enkripsi kontak | Belum ada | 3 | Kontak disimpan privat dan tidak dapat dilihat komunitas |
| SAF-07 | P2 | safety | kontak, izin lokasi | Belum ada | 3 | Tidak mengklaim menghubungi layanan darurat resmi tanpa integrasi nyata |

## 3. Komunitas, sosial, reward

| ID | P | Modul/domain | Dependensi | Status awal | Fase | Acceptance criteria |
|---|---|---|---|---|---|---|
| CMT-01 | P1 | communities | slug unik, media | Belum ada | 2 | Nama/slug unik; owner menjadi admin awal |
| CMT-02 | P1 | communities | role, permintaan bergabung | Belum ada | 2 | Komunitas privat memerlukan persetujuan pengurus |
| CMT-03 | P1 | communities | RBAC komunitas, audit | Belum ada | 2 | Permission tiap role dapat dikonfigurasi dan diaudit |
| CMT-04 | P1 | communities | agenda, kapasitas | Belum ada | 2 | Agenda memuat lokasi, waktu, titik kumpul, kapasitas, status |
| CMT-05 | P1 | communities/voice | channel, LiveKit | Belum ada | 2 | Hanya member berhak mengakses channel privat |
| CMT-06 | P1 | communities/media | storage, moderasi, kuota | Belum ada | 2 | Upload memeriksa ukuran, format, quota, dan status moderasi |
| CMT-07 | P2 | communities/web | Next.js publik, kontrol owner | Belum ada | 4 | Owner memilih konten publik; data member privat tidak terbuka |
| SOC-01 | P1 | social | feed, media, audience | Belum ada | 2 | Post punya audience publik, pengikut, komunitas, atau privat |
| SOC-02 | P1 | social | reaksi, komentar, idempotensi | Belum ada | 2 | Interaksi konsisten dan tidak terhitung ganda saat retry |
| SOC-03 | P1 | social | `follows`, privasi | Belum ada | 2 | Status hubungan jelas dan dapat dibatalkan |
| SOC-04 | P1 | social/notifications | mention, hashtag, preferensi | Belum ada | 2 | Notifikasi sesuai preferensi; spam dibatasi |
| SOC-05 | P2 | social | story, job kedaluwarsa | Belum ada | 3 | Masa tampil dan penghapusan otomatis ditetapkan jelas |
| SOC-06 | P1 | social/moderation | blokir, mute, laporan | Belum ada | 2 | Konten akun yang diblokir tidak muncul di feed default |
| RWD-01 | P2 | rewards | ledger immutable | Belum ada | 4 | Semua perubahan saldo dicatat dalam ledger immutable |
| RWD-02 | P2 | rewards | stok/harga server | Belum ada | 4 | Harga dan stok dikelola server |
| RWD-03 | P2 | rewards | kriteria terverifikasi | Belum ada | 3 | Kriteria transparan dan tidak mendorong kecepatan berbahaya |
| RWD-04 | P2 | rewards | anti-fraud, opt-out | Belum ada | 3 | Deteksi fraud dan opsi opt-out privasi tersedia |
| RWD-05 | P2 | rewards | redeem hash, kuota | Belum ada | 4 | Redeem divalidasi server dan tidak dapat dipakai berulang |

## 4. Requirement PRD tanpa ID per butir

| Sumber | Isi | Modul | Fase | Acceptance gate |
|---|---|---|---|---|
| PRD 5.10 | Album, poster, upload media, ekspor video | media, social, communities | 3 (album dasar di 2) | Media pipeline stabil, biaya storage terukur, kontrol privasi tersedia (PRD 15) |
| PRD 5.12 | Paket, Google Play Billing, entitlement, restore | billing | 4 | Audit billing, fraud, hak aset, unit economics (PRD 15) |
| PRD 5.13 | Push per kategori, badge unread, idempotensi | notifications | 1 | Tidak ada duplikasi saat retry; preferensi dihormati |
| PRD 5.14 | Admin, moderasi, audit, konfigurasi | admin, moderation | 1 minimum; lanjut 2–4 | Tindakan sensitif menyimpan actor, target, waktu, alasan, before/after, request ID |
| PRD 5.3 aturan navigasi | Rute motor, disclaimer, fallback, perubahan rute | routing/navigation | 1–2 | Tidak ada ETA palsu; perubahan rute disebarkan |
| PRD 5.4 aturan pencatatan | Sampling, gap GPS, pemulihan draft, auto-finish | trips | 1 | Sesi tidak hilang saat app dibunuh; jarak tidak diinterpolasi agresif |
| PRD 5.5 aturan lokasi | Opt-in, stale, stop sharing, hapus saat selesai | realtime/convoys | 1 | Posisi hilang setelah keluar; status stale terlihat |
| PRD 7 BR-01…BR-15 | Aturan bisnis lintas fitur | lintas modul | sesuai fitur | Diuji pada fase tempat fitur berada; lihat `TEST_PLAN.md` |
| PRD 11 NFR | Kinerja, keandalan, baterai, keamanan, privasi, aksesibilitas | lintas modul | 1–4 | Target diukur, bukan diklaim; lihat `TEST_PLAN.md` |
| PRD 12 permission | Izin bertahap dan fallback | Android | 1–2 | Lihat `ANDROID_PERMISSIONS.md` |
| PRD 13 analytics | Event produk minimum, monitoring teknis | observability | 1 (dasar), 2 (voice) | Tidak ada data sensitif di event |
| PRD 14 test | Fungsional, perangkat, acceptance gate MVP | QA | 1–4 | Gate PRD 14.3 diuji sebelum beta |

## 5. Ringkasan cakupan per fase

| Fase | Requirement ber-ID | Jumlah |
|---|---|---|
| 1 | ACC-01…05, RID-01/02, VEH-01/03, MAP-01…05, TRP-01…05, CNV-01…06, COM-01, SAF-01…03 | 29 |
| 2 | VEH-02, MAP-06…08, CNV-07, COM-02…06, SAF-04/05, CMT-01…06, SOC-01…04, SOC-06 | 23 |
| 3 | RID-03, TRP-06/07, SAF-06/07, SOC-05, RWD-03/04 | 8 |
| 4 | MAP-09, TRP-08, CNV-08, CMT-07, RWD-01/02/05 | 7 |
| **Total** |  | **67** |

Catatan: total 67 baris karena PRD 5 memiliki 67 requirement ber-ID; angka ini harus sama dengan jumlah baris pada tabel 1–3. Setiap requirement dipetakan tepat satu fase; tidak ada yang berstatus "tidak dijadwalkan".

## 6. Dependensi lintas requirement

```text
ACC-01..05 → semua fitur berakun
VEH-01 → TRP-05 (kendaraan pada ringkasan trip)
MAP-03/04 → CNV-01 (rute bersama) dan TRP-01 (navigasi)
TRP-01..05 → TRP-06/07 (replay/poster)
CNV-01..06 → CNV-07/08
COM-01 → COM-02/06
SAF-01..03 → SAF-04/07
CMT-01/02/03 → CMT-04/05/06/07
SOC-01..04 → SOC-05/06
RWD-01 → RWD-02/04; RWD-05 berdiri sendiri
PRD 5.12 → CNV-08, MAP-09, TRP-08, CMT-07, RWD-02/05
```

Dependensi eksternal yang belum tersedia: OIDC/Firebase, FCM, provider peta/routing/geocoding/cuaca, object storage, LiveKit (Fase 2), Google Play Billing (Fase 4). Tidak ada yang diklaim aktif.

## 7. Status implementasi Fase 1 (24 November 2026)

Kolom **Status awal** pada tabel 1–3 adalah catatan historis Fase 0 dan tidak diubah. Status aktual setelah eksekusi Fase 1 dicatat di sini. Cakupan eksekusi mengikuti instruksi kerja Fase 1: fondasi, auth lokal, profil/privasi, garasi, peta/adapter, pencarian tempat dan preview rute, perekaman trip personal, permission, migrasi, validasi, otorisasi, observability. Konvoi real-time, voice/PTT, feed, rewards, subscription, 3D, chat, dan hazard **ditunda** atas instruksi tersebut meskipun PRD menempatkannya di Fase 1.

Legenda: **Selesai** = kode + jalur test lulus; **Sebagian** = jalur utama ada tetapi acceptance criteria belum seluruhnya; **Belum** = belum diimplementasikan; **Ditunda** = sengaja tidak dikerjakan pada eksekusi ini.

| ID | Status Fase 1 | Bukti / catatan |
|---|---|---|
| ACC-01 | Sebagian | Register/login lokal, verifikasi email berupa token; pengiriman email produksi dan pembatasan fitur sebelum verifikasi belum dikonfigurasi |
| ACC-02 | Selesai | JWT akses + refresh opaque dengan rotasi, logout mencabut refresh, token disimpan EncryptedSharedPreferences |
| ACC-03 | Sebagian | Username unik dan format divalidasi; filter profaniti belum ada |
| ACC-04 | Belum | Penghapusan akun belum termasuk cakupan eksekusi |
| ACC-05 | Sebagian | Endpoint consent tersedia di backend; layar consent Android belum ada |
| RID-01 | Sebagian | Nama, bio, kota, visibilitas, dan URL avatar (http/https) dapat diubah dan tersimpan di server; unggah media avatar belum ada |
| RID-02 | Selesai | Visibilitas profil, visibilitas riwayat, dan default berbagi lokasi disimpan di server |
| VEH-01 | Sebagian | CRUD kendaraan dengan jenis/merek/model/tahun/cc/nama panggilan; foto belum ada |
| VEH-03 | Selesai | Plat AES-256-GCM, hanya pemilik dengan `includePlate=true`; diuji lintas pengguna |
| MAP-01 | Sebagian | MapLibre, tombol lokasi saya dengan izin runtime, marker posisi pengguna, kamera ke posisi, dan zoom; indikator akurasi/waktu pembaruan live dan uji perangkat belum ada |
| MAP-02 | Sebagian | Pencarian provider dengan empty/error state; jarak pada hasil belum dihitung |
| MAP-03 | Sebagian | Tambah/hapus waypoint, batas 7; pengurutan ulang dan pemilihan langsung dari peta belum ada |
| MAP-04 | Selesai | Preview rute, alternatif bila provider mengembalikan, 503 eksplisit bila belum dikonfigurasi; diuji success/no result/provider error/invalid waypoint |
| MAP-05 | Belum | Favorit tersinkron belum ada |
| TRP-01 | Selesai | Sesi trip dengan ID, status, waktu mulai, kendaraan; diuji state machine |
| TRP-02 | Sebagian | Foreground service lokasi + notifikasi dan stop; belum diuji pada perangkat/emulator |
| TRP-03 | Selesai | Filter akurasi/spike/gap di klien dan server, kualitas tersimpan dan direkap |
| TRP-04 | Sebagian | State machine start/pause/resume/finish dan Room recovery; process death belum diuji di perangkat |
| TRP-05 | Sebagian | Ringkasan dan riwayat memuat jarak, durasi, waktu bergerak, kecepatan rata-rata/maksimum, serta lokasi mulai/selesai dari titik GPS; detail peta rute per trip belum ada |
| CNV-01…06 | Ditunda | Konvoi real-time di luar cakupan eksekusi Fase 1 |
| COM-01 | Ditunda | Chat di luar cakupan eksekusi Fase 1 |
| SAF-01…03 | Ditunda | Hazard di luar cakupan eksekusi Fase 1 |

Catatan verifikasi: build Android dan unit test filter GPS/state machine dijalankan; backend e2e memakai PostgreSQL/PostGIS nyata melalui PGlite. Tracking background dan process death belum boleh diklaim lulus karena belum diuji pada perangkat/emulator yang mendukung. Rincian bukti ada di `docs/PHASE_REPORTS/PHASE_1_REPORT.md`.

## 8. Status implementasi Phase 2 — Convoy & Live Location (24 November 2026)

Eksekusi Phase 2 dibatasi pada CNV-01…CNV-08. Requirement Phase 2 lain di PRD (voice/PTT, chat, hazard lanjutan, komunitas, feed) **tidak** dikerjakan pada eksekusi ini dan tidak boleh dianggap selesai.

| ID | Status | Bukti / catatan |
|---|---|---|
| CNV-01 | Selesai | Invite 10 karakter Crockford Base32, hash HMAC-SHA256, expiry/revoke/max uses; kode mentah hanya dikembalikan saat dibuat |
| CNV-02 | Selesai | Join selalu `requested`; leader/co-leader approve/reject; kapasitas `active + requested` dihitung server dari entitlement |
| CNV-03 | Selesai | Audit insert-only untuk join/approve/reject/remove/leave/role/transfer/handoff/status/route/invite; event realtime disiarkan |
| CNV-04 | Sebagian | Backend dan test realtime lengkap: consent, stale, isolasi room, reconnect, pencabutan akses. Klien Android terkompilasi, tetapi belum dijalankan pada perangkat |
| CNV-05 | Selesai | State machine `draft/lobby/active/paused/completed/cancelled`, `If-Match`, event status ke room; diuji lewat HTTP dan WebSocket |
| CNV-06 | Sebagian | Snapshot/event posisi + marker MapLibre dengan identitas dan stale; rute bersama dibaca lewat `GET /v1/routes/{id}` dan digambar sebagai LineString. Tampilan peta belum diuji pada perangkat dan provider tile produksi belum ada |
| CNV-07 | Selesai | Handoff otomatis ke co-leader/anggota aktif terlama saat semua socket leader terputus; audit + event; diuji |
| CNV-08 | Sebagian | Kapasitas/entitlement ditegakkan server (`user_entitlements`), tidak percaya field klien; billing Google Play dan paket berbayar belum ada |

Verifikasi Phase 2: `cd backend && npm test` → 10/10 lulus; Android `:app:testDebugUnitTest :app:assembleDebug` → BUILD SUCCESSFUL (14 unit test lama, tidak ada unit test konvoi baru); OpenAPI 50 path. Redis nyata, multi-instance fanout, dan UI perangkat belum diuji. Rincian ada di `PHASE_2_REPORT.md`.

## 9. Status implementasi Phase 6 (26 November 2026)

Bagian ini menambahkan status aktual setelah Phase 6. Tabel 1–3 tetap historis dan tidak diubah.

| ID | Status | Bukti / catatan |
|---|---|---|
| COM-01 | Sebagian | Android: daftar pesan, kirim, pagination `before`, state `sending/failed/sent`, retry memakai `clientMessageId` yang sama, dedupe berdasarkan id. Belum: langganan realtime pesan di layar chat, uji perangkat |
| SAF-01 | Sebagian | Android: buat laporan dengan GPS terakhir, kategori, catatan opsional; backend menyimpan jenis, koordinat, waktu, catatan. Foto opsional belum dipilih dari galeri |
| SAF-02 | Selesai (backend) | TTL dihitung server, sweep mengubah status kedaluwarsa; Android menampilkan status aktif/kedaluwarsa |
| SAF-03 | Sebagian | Konfirmasi "masih ada" dan "tidak relevan" dari Android; reputasi belum ada di klien maupun backend |
| ACC-04 | Sebagian | Backend: export, permintaan penghapusan, grace period, pembatalan. Android: belum ada layar |
| ACC-05 | Sebagian | Backend menyimpan consent; Android belum punya layar consent |
| RID-01 / VEH-01 | Sebagian | URL avatar dan foto kendaraan ada di backend; unggah dari Android belum ada |
| MAP-05 | Sebagian | Endpoint favorit ada di backend; Android belum memakai |

Android yang belum memiliki layar sama sekali pada Phase 6: consent/privasi, permintaan penghapusan akun, unggah media, tempat favorit.

## 10. Status media Phase 6.1 (26 November 2026)

| ID | Status | Bukti / catatan |
|---|---|---|
| Unggah media backend | PASS (S3-compatible) | SigV4, HEAD, SHA-256, magic bytes, idempotensi; 11 uji integrasi |
| Penghapusan objek | PASS (S3-compatible) | Outbox + worker + verifikasi `HEAD`; uji penghapusan akun |
| Unggah dari Android | FAIL | Belum ada layar/klien unggah; kontrak baru belum dipakai |
| Verifikasi AWS produksi | BLOCKED | Tidak ada akun/bucket AWS; hanya S3-compatible yang diuji |
| MinIO sebagai target uji | BLOCKED | MinIO open-source diarsipkan, unduhan 410 |
| Intent `pending` yang ditinggalkan | FAIL | Belum ada lifecycle/TTL objek yatim |

## 11. Status storage lifecycle dan Android media (Phase 6.2, 27 November 2026)

| Requirement | Status | Bukti |
| --- | --- | --- |
| Deteksi upload intent kedaluwarsa | PASS | `UploadCleanupService.cleanupExpired` |
| Verifikasi objek nyata sebelum hapus | PASS | `HEAD` sebelum CAS |
| Enqueue penghapusan objek orphan | PASS | `enqueueMediaDeletion` dalam transaksi yang sama |
| Intent tanpa objek di-expire tanpa job | PASS | test `missing object` |
| Media `ready` tidak tersentuh | PASS | test `cleanup never touches ready media` |
| Idempotensi pembersihan | PASS | CAS `status + object_key + expiry` |
| Worker penghapusan periodik | PASS | `startScheduled(pollSeconds, batchSize)` |
| Konkurensi aman antar instance | PASS | `FOR UPDATE SKIP LOCKED` + lease 10 menit |
| Retry & exponential backoff | PASS | `base * 2^(n-1)`, cap 3600 s |
| Dead-letter monitoring | PASS | `status().failed`, `lastResult` |
| Graceful shutdown worker | PASS | `stopScheduled()` menunggu batch |
| Kuota per pengguna | PASS | tabel `storage_quotas` |
| Perhitungan used storage | PASS | diturunkan dari `media_assets.status='ready'` |
| Reservasi upload pending | PASS | `reserveUpload` / `releaseReservation` |
| Enforcement kuota saat intent | PASS | `409 STORAGE_QUOTA_EXCEEDED` |
| Rekonsiliasi kuota | PASS | `reconcile(userId)` |
| Proteksi konsumsi paralel | PASS | UPDATE bersyarat + test paralel |
| Otorisasi unduh berbasis visibilitas | PASS | `accessible()` + `signGet` |
| Capability URL berumur pendek | PASS | HMAC id+expiry, presigned GET 60 s |
| Interface media scanning | PASS | `MediaScanner` + `NoOpMediaScanner` |
| Provider scanning nyata | BLOCKED | belum ada provider |
| Android upload repository | PASS | `MediaRepository` |
| SHA-256 dari file (streaming) | PASS | `MediaChecksum`, unit test |
| Header presigned persis | PASS | `MediaUploadRequest`, unit test |
| Completion tanpa body | PASS | `api.completeUpload(id)` tanpa payload |
| Upload state (idle…cancelled) | PASS | kolom `state` di Room |
| Upload progress | PASS | callback per chunk → UI; Room menyimpan fase |
| Retry & duplicate prevention | PASS | `clientMediaId` tetap, re-issue intent |
| Pemulihan URL kedaluwarsa | PASS | `needsNewIntent` + re-issue |
| Persistensi state (Room) | PASS | `MediaUploadEntity`/`MediaUploadDao` |
| Avatar upload/preview/replace | PASS | `ProfileScreen` + `MediaImage` |
| Vehicle photo upload/preview | PASS | `GarageScreen` + `photoMediaId` |
| Media display via signed URL | PASS | `MediaRepository.loadImage` |
| Access denied handling | PASS | `Result.failure` → pesan galat |
| AWS production compatibility | BLOCKED | belum diuji ke AWS |

## 12. Status Phase 6.3 — penghapusan, observability, scanning (27 November 2026)

| Requirement | Status | Bukti |
| --- | --- | --- |
| Endpoint hapus media | PASS | `DELETE /v1/media/:id` |
| Penegakan kepemilikan | PASS | test non-owner 404, anonim 401 |
| Deteksi referensi media | PASS | `referencesOf()` 9 sumber |
| Media bersama terlindungi | PASS | `409 MEDIA_IN_USE` + `references` |
| Penggantian avatar aman | PASS | transaksi + test |
| Penggantian foto kendaraan aman | PASS | transaksi + test |
| Outbox transaksional | PASS | CAS + insert satu transaksi |
| Verifikasi penghapusan objek | PASS | `HEAD` pasca-delete |
| Double deletion idempoten | PASS | test khusus |
| Kuota dilepas setelah hapus nyata | PASS | `deleting` dihitung `usedBytes` |
| Endpoint admin health | PASS | `/v1/admin/media/workers` |
| Worker status tersedia | PASS | `health()` + `status()` |
| Dead-letter terlihat | PASS | `failed` + `lastError` |
| Pending queue terlihat | PASS | `pending` + `oldestPendingSeconds` |
| Error status tersedia | PASS | `lastFailureAt`, `lastError` |
| Admin authorization | PASS | `AdminGuard`, test 401/403 |
| Scanner adapter nyata | PASS | `ClamAvMediaScanner` INSTREAM |
| Malware scanning diuji provider nyata | BLOCKED | tidak ada clamd/Docker |
| Scanner failure bukan clean | PASS | test `scan_failed` |
| Karantina bekerja | PASS | test akses publik ditolak |
| Public media ikut scan policy | PASS | fail-closed `scan_status='clean'` |
| Moderasi konten dipisah dari malware | PASS | `moderation_status` terpisah |
| Android hapus avatar | PASS | kode + build |
| Android replace avatar | PASS | kode + build |
| Android hapus foto kendaraan | PASS | kode + build |
| Android replace foto kendaraan | PASS | kode + build |
| Media state tersinkron | PASS | status `deleting`/`deleted` + refresh kuota |
| Kuota diperbarui di UI | PASS | `refreshQuota()` + ProfileScreen |
| Expired URL ditangani | PASS | `needsNewIntent` + re-issue intent |
| Quarantined media tidak tampil publik | PASS | server 404; klien menampilkan galat |
| Video support | BLOCKED | backend siap, Android belum punya layar composer |

## 13. Status Phase 6.4 — reliability & verifikasi (27 November 2026)

| Requirement | Status | Bukti |
| --- | --- | --- |
| Deteksi job penghapusan basi | PASS | `reconcileStale` + test requeue |
| Reclaim lease & requeue retryable | PASS | test lease/retry 6.3 + 6.4 |
| Kuota tidak dilepas sebelum objek hilang | PASS | test `deleting` tetap dihitung |
| Verifikasi HEAD sebelum `deleted` | PASS | reconcile memakai `HEAD` |
| Pembatalan hanya sebelum klaim | PASS | `409` setelah `attempts>0` |
| Race pembatalan vs worker | PASS | `FOR UPDATE` baris media + outbox |
| Dead-letter recovery admin-only | PASS | `media.ops` + step-up, audit |
| Riwayat kegagalan dipertahankan | PASS | `media_deletion_ops_log` + audit |
| ClamAV daemon nyata | BLOCKED | tidak ada Docker; job CI disiapkan |
| EICAR terdeteksi | BLOCKED | butuh daemon nyata (mock hanya protokol) |
| Quarantine tidak pernah publik | PASS | 404 untuk non-pemilik, preview 409 |
| Scanner gagal ≠ clean | PASS | test 6.3 + 6.4 |
| CI menjalankan container scanner | BLOCKED | workflow ditulis, belum dijalankan |
| Malware vs moderation terpisah | PASS | kolom & service terpisah |
| Queue moderasi + approve/reject | PASS | endpoint admin + panel admin |
| Alasan & audit trail | PASS | `media_moderation_log`, `admin_audit_logs` |
| Reviewer tak berwenang ditolak | PASS | support → `403` |
| Alert worker unavailable | PASS | `deletion_worker_unavailable` |
| Alert dead-letter | PASS | `deletion_dead_letter` |
| Dedup & recovery event | PASS | `occurrences`, `resolved_at` |
| Provider notifikasi | BLOCKED | no-op jujur, belum ada delivery |
| Android lint correctness/security | PASS | `InlinedApi`, `ObsoleteSdkInt`, backup rules |
| Android unit test | PASS | `testDebugUnitTest` |
| Device test | BLOCKED | instrumented test disiapkan, tidak dijalankan |
| Video (fase ini) | NOT APPLICABLE | dilarang oleh instruksi fase |

## Status verifikasi (PHASE 6.5)

- SeaweedFS 4.55 lokal: PASS (11/11).
- ClamAV 1.4.7 lokal: PASS (10/10).
- GitHub Actions / emulator / PostgreSQL nyata / AWS: BLOCKED.

## 5. Bukti verifikasi perangkat (Phase 6.5.2, 28 November 2026)

Requirement yang menyangkut media/profil/kendaraan kini punya bukti eksekusi di
emulator nyata, bukan hanya kompilasi:

| Requirement | Bukti perangkat |
| --- | --- |
| ACC-01 (akun, sesi) | `AuthenticationE2ETest` 5 test — register, logout/login, token persisten, refresh, tanpa token |
| ACC-02/ACC-03 (profil) | `ProfileMediaE2ETest` 5 test — avatar unggah/tampil/ganti/hapus, kuota |
| Garasi + foto kendaraan | `VehicleMediaE2ETest` 5 test — tambah, list, ganti, hapus, media in-use |
| CMT-06 (upload memeriksa ukuran, format, kuota, moderasi) | ukuran/format/kuota terbukti di perangkat; **moderasi & scan status belum** |
| Media hanya untuk yang berhak | `MediaSecurityE2ETest` 4 test — akun lain ditolak, capability terikat media id |

Run `46097769865` (commit `eb8ee59`): 26/26 lulus di API 34 dan API 36.
Belum tercakup: matriks status scan untuk penonton lain, process death,
gangguan jaringan, kuota habis. Rincian: `PHASE_6_5_2_REPORT.md`.
