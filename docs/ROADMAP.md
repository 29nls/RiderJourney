# ROADMAP — RiderJourney

Urutan pengerjaan mengikuti PRD 15. Tidak ada tanggal, durasi, atau jumlah tim yang dicantumkan karena PRD tidak menetapkannya; estimasi dibuat setelah Fase 1 slice pertama terukur.

## 1. Status

| Fase | Status | Catatan |
|---|---|---|
| 0 — Discovery dan fondasi | Selesai dengan pengecualian | Provider peta (exit criteria) belum dipilih; brand dan legal terbuka |
| 1 — MVP touring inti (P0) | Belum dimulai | Menunggu instruksi eksplisit |
| 2 — Komunikasi dan komunitas (P1) | Belum dimulai | |
| 3 — Journey dan engagement (P1/P2) | Belum dimulai | |
| 4 — Monetisasi dan fitur premium (P2) | Belum dimulai | |

## 2. Fase 0 — Discovery dan fondasi

**Deliverable:** audit repository, ringkasan sistem, arsitektur, model data, kontrak API, kontrak realtime, threat model, matriks izin, rencana test, keputusan, dan laporan fase.

**Exit criteria PRD 15:**

| Kriteria | Status |
|---|---|
| Desain arsitektur disetujui | PASS — dokumen tersedia, menunggu review pemilik produk |
| Backlog terpecah | PASS — slice Fase 1 di bagian 3 |
| Risiko privasi lokasi dianalisis | PASS — `SECURITY_AND_PRIVACY.md` bagian 7 |
| Peta provider dipilih | BLOCKED — O-02, butuh keputusan lisensi/biaya |

**Prasyarat yang belum siap:** JDK 17/21, Android SDK, Docker/PostgreSQL/Redis lokal, repository git. Rincian di `PHASE_REPORTS/PHASE_0_REPORT.md`.

## 3. Fase 1 — MVP touring inti (P0)

Fase 1 dipecah menjadi tujuh slice yang masing-masing harus dapat dijalankan dan diuji sebelum slice berikutnya. Urutan ini menjaga agar vertical slice pertama tidak menunggu provider peta.

### Slice 1A — Walking skeleton

- Struktur monorepo `android/`, `backend/`, `admin/`, `infra/`.
- Backend NestJS: health check, konfigurasi, koneksi PostgreSQL/Redis, migrasi `0001_core_identity`.
- Verifikasi token OIDC/Firebase dan `POST /v1/auth/session`, `GET /v1/me`.
- Android: aplikasi Compose kosong dengan tema, navigasi, Hilt, dan panggilan `GET /v1/me` setelah login.
- CI: lint, typecheck, unit test, build backend; lint dan build Android.
- Bukti: `GET /health/ready` 200, migrasi berhasil, test unit lulus, build Android lulus.

**Gerbang:** semua perintah CI lulus di mesin/CI yang memenuhi prasyarat.

### Slice 1B — Profil, consent, garasi

- ACC-01…ACC-05, RID-01/02, VEH-01/03.
- Consent versioned, privasi profil, plat terenkripsi, media avatar.
- UI: onboarding, edit profil, daftar kendaraan, state izin media.

**Gerbang:** test otorisasi dua akun, plat tidak bocor, consent tercatat.

### Slice 1C — Peta, tempat, rute

- MAP-01…MAP-05 dengan adapter routing/geocoding.
- Preview rute, waypoint maksimal 7, fallback dan pesan gagal transparan.
- **Ketergantungan:** O-02 (provider). Tanpa keputusan provider, slice ini hanya dapat memakai adapter fake untuk test, bukan rilis.

**Gerbang:** test provider gagal, validasi waypoint, atribusi peta tampil.

### Slice 1D — Trip tracking dan riwayat

- TRP-01…TRP-05, BR-01, BR-15.
- Foreground service, sampling adaptif, penyimpanan lokal, batch titik, pemulihan draft.
- UI: sesi aktif, jeda/lanjut, ringkasan, riwayat.

**Gerbang:** test GPS (akurasi rendah, lonjakan, gap, layar mati, app dibunuh), tidak ada duplikasi titik.

### Slice 1E — Konvoi, live location, chat

- CNV-01…CNV-06, COM-01, BR-02…BR-07.
- Invite code, kapasitas server-side, snapshot posisi, WebSocket, chat idempoten.
- UI: buat/join, lobby, peta anggota, chat, keluar.

**Gerbang:** test dua/ tiga klien, pencabutan akses, stale, beban 30 anggota (PRD 11.1).

### Slice 1F — Bahaya dan notifikasi

- SAF-01…SAF-03, PRD 5.13.
- TTL, konfirmasi, confidence, push undangan/status, preferensi kategori.
- UI: kontrol cepat laporan, detail, peringatan.

**Gerbang:** test TTL, duplikat, rate limit, push idempoten.

### Slice 1G — Admin minimum dan hardening

- Admin: user, suspend/reinstate, laporan bahaya, config, audit.
- Security test penuh, load test, observability, backup/restore, deklarasi Play.
- Acceptance gate PRD 14.3 diuji satu per satu.

**Gerbang:** seluruh acceptance gate MVP PASS atau blocker tercatat; beta terbatas dapat dimulai.

## 4. Fase 2 — Komunikasi dan komunitas (P1)

- LiveKit/PTT dan voice room, prioritas audio dengan navigasi (COM-03…COM-06).
- Komunitas/klub, role, agenda, channel, artikel, album (CMT-01…CMT-06).
- Feed, follow, komentar, reaksi, blokir, notifikasi sosial (SOC-01…SOC-06).
- Co-leader dan handoff (CNV-07), kendaraan tambahan dan kendaraan utama (VEH-02), tema peta, navigasi suara, tempat favorit lanjutan.
- Moderation tools untuk konten komunitas.

**Exit criteria PRD 15:** pengujian audio dan moderasi lulus; permission dan kebijakan lokasi jelas.

## 5. Fase 3 — Journey dan engagement (P1/P2)

- Replay perjalanan (TRP-06), poster original dan ekspor gambar (TRP-07).
- Pipeline media lengkap, album pribadi/komunitas.
- Profil bertema, badge, leaderboard dengan anti-fraud dan opt-out.
- Poin dan ledger yang sudah berjalan.

**Exit criteria PRD 15:** media pipeline stabil, biaya storage terukur, kontrol privasi tersedia.

## 6. Fase 4 — Monetisasi dan fitur premium (P2)

- Paket Free/Pro/Pro Plus, Google Play Billing, entitlement, restore, refund/grace (PRD 5.12).
- Ekspor video, peta premium, avatar 3D/asset store, redeem, website komunitas.
- Rekonsiliasi billing, audit fraud, optimasi biaya routing/audio/storage/CDN.

**Exit criteria PRD 15:** audit billing, fraud, hak aset, dan unit economics selesai.

Kapasitas 3/20/30 dan harga belum final (PRD 5.5, 17 butir 4); implementasi memakai konfigurasi.

## 7. Ketergantungan lintas fase

| Butir | Dibutuhkan pada | Status |
|---|---|---|
| Provider tile/routing/geocoding/cuaca | Slice 1C | Terbuka (O-02) |
| Brand, domain, package name | Sebelum Play Console | Terbuka (O-01) |
| Kebijakan retensi dan legal | Sebelum beta | Terbuka (O-04, O-07) |
| Akun Google Play Billing dan produk | Fase 4 | Belum dimulai |
| Firebase/OIDC, FCM, storage, LiveKit | Slice 1A/1E/2 | Belum disiapkan |
| Perangkat uji dan jaringan | Slice 1D/1G | Belum disiapkan |

## 8. Acceptance gate per fase

Gate ini melengkapi exit criteria PRD 15; sebuah fase tidak ditutup hanya karena fitur tampil di UI.

| Fase | Gate yang harus lulus | Bukti yang disimpan |
|---|---|---|
| 0 | Dokumen lengkap dan konsisten; seluruh requirement ber-ID terpetakan; tidak ada secret; pemeriksaan awal dijalankan | Laporan Fase 0, audit dokumen, hasil `npm test` kondisi awal |
| 1 | Acceptance gate MVP PRD 14.3 (10 butir); otorisasi dua akun; GPS/offline/FGS; WebSocket 30 anggota; build Android + backend + admin lulus | Test log, laporan slice, hasil load test, APK internal |
| 2 | Audio/PTT lulus uji jaringan buruk; moderasi komunitas; role dan channel teruji; tidak ada kebocoran lokasi | Test audio, security test, laporan moderasi |
| 3 | Pipeline media stabil; biaya storage terukur; replay/poster berjalan; kontrol privasi media | Laporan biaya, test media, sample poster |
| 4 | Audit billing/fraud; hak aset; unit economics; entitlement server-side teruji | Rekonsiliasi billing, audit aset, laporan biaya |

Status gate Fase 0: dokumen dan pemetaan PASS; persetujuan pemilik produk dan provider peta BLOCKED (lihat `PHASE_REPORTS/PHASE_0_REPORT.md`).

## 9. Definition of Done per slice

Slice hanya ditutup bila:

- UI terhubung ke use case dan sumber data nyata (bukan data hardcoded).
- Endpoint, migrasi, dan otorisasi tersedia bila dibutuhkan.
- Loading, empty, error, retry, permission denied, offline, dan stale ditangani.
- Test relevan dibuat dan dijalankan; hasilnya dilampirkan.
- Tidak ada secret di repository.
- Dokumentasi kontrak diperbarui bila berubah.
- Risiko dan known issue dicatat di laporan fase.

## 10. Yang tidak dijadwalkan

Fitur di luar PRD 2.1, integrasi darurat resmi tanpa perjanjian, navigasi offline penuh, musik komersial tanpa lisensi, video call, dan integrasi ECU/OBD tidak masuk roadmap ini (PRD 2.2).
