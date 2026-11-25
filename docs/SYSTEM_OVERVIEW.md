# SYSTEM OVERVIEW — RiderJourney

Ringkasan sistem yang akan dibangun, aktor, kapabilitas, dan batas fase. Sumber: `PRD_RiderJourney.md`. Dokumen ini tidak menambah kebutuhan produk baru; bila ada perbedaan, PRD menang.

## 1. Tujuan sistem

RiderJourney menyatukan perencanaan rute, navigasi, pencatatan perjalanan, koordinasi konvoi, komunikasi, keselamatan jalan, komunitas, dan dokumentasi perjalanan dalam satu ekosistem (PRD 1). Masalah yang diselesaikan adalah koordinasi touring yang tersebar di banyak aplikasi, yang meningkatkan risiko anggota tertinggal dan dokumentasi tercecer (PRD 1).

Prioritas: keandalan GPS, navigasi, konvoi, izin lokasi, dan keamanan di atas animasi, gamifikasi, feed sosial, dan monetisasi (PRD 1).

## 2. Aktor

| Aktor | Kebutuhan utama | Sumber |
|---|---|---|
| Rider individu | Rute, perjalanan pribadi, tempat favorit, garasi, komunitas | PRD 3.1 A |
| Ketua konvoi / road captain | Rute, titik kumpul, undangan, mulai/akhiri sesi, kelola anggota | PRD 3.1 B |
| Anggota konvoi | Bergabung, berbagi lokasi, navigasi, pesan, laporan | PRD 3.1 C |
| Pengurus komunitas | Profil komunitas, anggota, role, agenda, channel, album, artikel | PRD 3.1 D |
| Moderator platform | Laporan, konten berbahaya, spam, akun palsu, penyalahgunaan lokasi | PRD 3.1 E |
| Super admin / operator | Konfigurasi global, paket, entitlement, poin, redeem, banner, audit | PRD 3.1 F |

Role ditegakkan di backend; menyembunyikan tombol di aplikasi bukan otorisasi (PRD 3.2).

## 3. Konteks sistem

```text
                        +---------------------------+
                        |        Rider (Android)    |
                        |  Compose · MapLibre · FGS |
                        +------------+--------------+
                                     |
              HTTPS /v1             |             WebSocket (event konvoi)
                                     v
+----------------------------- API Gateway / NestJS -----------------------------+
| auth · profile · vehicles · places · routes · trips · convoys · chat · hazards  |
| communities · feed · media · billing · rewards · notifications · admin · config |
+------+-------------------+-------------------+------------------+---------------+
       |                   |                   |                  |
       v                   v                   v                  v
 PostgreSQL+PostGIS      Redis           Object storage       Worker/queue
 (data transaksional)  (live pos,       (media, signed URL)   (push, media,
                        presence, rate                          moderasi, ekspor)
                        limit, pub/sub)         |
                                                v
                                        LiveKit SFU (Fase 2)
                                                |
                                     Provider eksternal (adapter):
                                     tiles · routing · geocoding · cuaca · FCM · billing
```

Admin web (Next.js) memakai API admin yang sama dengan otorisasi server-side (PRD 9.2, 5.14).

## 4. Peta kapabilitas dan fase

Fase mengikuti PRD 15. Prioritas mengikuti PRD 5 (`P0`, `P1`, `P2`).

| Kapabilitas | Requirement | Prioritas | Fase PRD |
|---|---|---|---|
| Registrasi, login, sesi, consent, hapus akun | ACC-01…ACC-05 | P0 | 1 |
| Profil rider, privasi, garasi dasar | RID-01, RID-02, VEH-01, VEH-03 | P0 | 1 |
| Kendaraan tambahan dan kendaraan utama | VEH-02 | P1 | 2 |
| Tema profil dan aset | RID-03 | P1 | 3 |
| Peta, pencarian, waypoint, preview rute | MAP-01…MAP-05 | P0 | 1 |
| Gaya peta, navigasi suara, peringatan rute | MAP-06…MAP-08 | P1 | 2 |
| Peta 3D/premium | MAP-09 | P2 | 4 |
| Sesi touring, tracking background, riwayat | TRP-01…TRP-05 | P0 | 1 |
| Replay, poster | TRP-06, TRP-07 | P1 | 3 |
| Ekspor video | TRP-08 | P2 | 4 |
| Konvoi, undangan, live location, status anggota | CNV-01…CNV-06 | P0 | 1 |
| Co-leader dan handoff | CNV-07 | P1 | 2 |
| Kapasitas per paket | CNV-08 | P1 | 4 |
| Chat konvoi | COM-01 | P0 | 1 |
| Voice room/PTT, share lokasi via chat, reconnect | COM-02…COM-06 | P1/P2 | 2 |
| Laporan bahaya dan konfirmasi | SAF-01…SAF-03 | P0 | 1 |
| Peringatan navigasi, tempat singgah, kontak darurat, SOS | SAF-04…SAF-07 | P1/P2 | 2–3 |
| Komunitas, agenda, channel, album, artikel | CMT-01…CMT-07 | P1/P2 | 2 |
| Feed, reaksi, follow, mention, story | SOC-01…SOC-06 | P1/P2 | 2–3 |
| Album, poster, pipeline media | PRD 5.10 | P1 | 3 |
| Poin, badge, leaderboard, redeem | RWD-01…RWD-05 | P2 | 3–4 |
| Langganan dan entitlement | PRD 5.12 | P2 | 4 |
| Notifikasi | PRD 5.13 | P0 | 1 |
| Admin dan moderasi | PRD 5.14 | P0 (minimum) | 1 |
| Cuaca dasar | MAP-08 | P1 | 2 |

Fase 1 (MVP) adalah irisan P0 pada tabel di atas, sesuai PRD 15 Fase 1 dan acceptance gate PRD 14.3. Pemetaan per requirement ID, dependensi, dan acceptance criteria ada di `REQUIREMENTS_MATRIX.md`.

## 5. Ruang lingkup yang tidak dikerjakan

Sesuai PRD 2.2: ride-hailing/kurir/marketplace, iuran komunitas kompleks, penjaminan keselamatan atau dispatch darurat resmi tanpa perjanjian, navigasi offline penuh, streaming musik komersial tanpa lisensi, video call bebas, integrasi ECU/OBD, dan kompetisi kecepatan.

Keputusan produk yang belum ditetapkan (brand, provider peta, harga, retensi legal) dicatat di `DECISIONS.md` bagian 5 dan tidak diisi dengan asumsi yang diklaim sebagai fakta.

## 6. Lingkungan

| Lingkungan | Tujuan | Data | Kredensial |
|---|---|---|---|
| local | Pengembangan dan test otomatis | Seed development, bukan data produksi | Dummy/container |
| test | CI: unit, integration, contract | Ephemeral, dibuat dan dihapus per run | Dummy |
| staging | UAT, uji perangkat, beta internal | Data uji teranonimisasi | Kredensial terpisah |
| production | Rilis | Data pengguna | Rahasia dikelola secret manager |

Pemisahan ini mengikuti PRD 15 Fase 0 ("environments dev/staging/prod") dan prompt bagian 3. Tidak ada kredensial nyata di repository; `.env.example` hanya berisi nama variabel dan placeholder.

## 7. Struktur repository yang dituju

```text
RiderJourney/
  android/                 # aplikasi Kotlin, multi-modul (Fase 1)
  backend/                 # NestJS modular monolith + worker (Fase 1)
  admin/                   # Next.js admin (Fase 1, minimal)
  infra/                   # docker-compose lokal, migration runner, CI (Fase 1)
  docs/                    # dokumen ini
  PRD_RiderJourney.md      # sumber kebutuhan (root, lihat D-001)
```

Fase 0 belum membuat direktori aplikasi; alasan ada di `DECISIONS.md` D-011.

## 8. Aliran pengguna utama

PRD 6 menetapkan empat alur: registrasi sampai perjalanan pertama (6.1), membuat dan menjalankan konvoi (6.2), melaporkan bahaya (6.3), dan mengelola komunitas (6.4). Alur 6.1–6.3 menjadi acuan Fase 1; alur 6.4 menyusul di Fase 2.

## 9. Indikator yang dipantau

PRD 1.4 menetapkan sasaran awal: crash-free sessions, onboarding completion, first trip activation, trip completion, p95 update lokasi konvoi, p95 delivery pesan, retensi D30, dan kualitas laporan bahaya. Angka target tersebut adalah sasaran produk yang harus divalidasi lewat beta (PRD 1.4), bukan klaim performa. Implementasi telemetri dan dashboard-nya belum ada pada Fase 0.
