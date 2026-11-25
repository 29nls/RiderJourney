# PHASE 2 REPORT — Convoy & Live Location

Tanggal: 24 November 2026. Status: **dilaporkan selesai untuk lingkup CNV-01…CNV-08 yang diminta**, dengan batasan verifikasi yang dicatat eksplisit di bagian 9. Tidak ada commit atau push.

## 1. Ringkasan

Phase 2 menambahkan konvoi beranggotakan banyak rider dan berbagi lokasi live:

- Backend NestJS: pembuatan konvoi, undangan, permintaan join dan persetujuan, peran, siklus status, rute bersama, consent berbagi lokasi, audit, entitlement kapasitas, tiket WebSocket, dan gateway lokasi realtime.
- Android: DTO/API, repository, klien WebSocket dengan reconnect, ViewModel, layar konvoi, marker anggota di peta, dan tab **Konvoi** di navigasi utama.
- Data: migrasi PostgreSQL/PostGIS baru, state sementara di Redis (dengan fallback memori untuk development/test), dan audit insert-only.
- Kontrak: OpenAPI diregenerasi menjadi **50 path**; dokumen API, event realtime, model data, arsitektur, keputusan, dan traceability diperbarui.

Hasil verifikasi aktual:

| Pemeriksaan | Hasil |
|---|---|
| `cd backend && npm test` | **10 test, 10 pass, 0 fail, exit 0**, total 47,4 detik |
| `node --test dist/test/phase2.test.js` setelah perubahan replay terakhir | **3 test, 3 pass, 0 fail, exit 0** |
| `cd android && JAVA_HOME=... ./gradlew :app:testDebugUnitTest :app:assembleDebug` | **BUILD SUCCESSFUL**, APK debug dihasilkan |
| Unit test Android | 14 test lama (GPS filter 8, state machine trip 6), 0 gagal; tidak ada unit test khusus konvoi |
| OpenAPI | `docs/openapi.json`, **50 path**, termasuk endpoint konvoi, rute tersimpan, dan tiket realtime |
| Migration | `0002_convoys.sql` dijalankan pada PGlite + PostGIS 3.7 di test |
| Redis nyata | **Tidak diuji** — Redis/valkey/Docker/WSL tidak tersedia |
| Emulator/perangkat | **Tidak tersedia** — UI konvoi belum diuji runtime, instrumented test, atau screenshot |
| Load 30 anggota | Lulus di store memori: connect 306 ms, fanout 114 ms pada run terakhir (bukan benchmark produksi) |

## 2. Lingkup yang diimplementasikan

### 2.1 Backend

| Area | Implementasi | Bukti utama |
|---|---|---|
| Skema | `user_entitlements`, `convoys`, `convoy_members`, `convoy_invites`, `convoy_audit_logs`; unique partial index satu membership terbuka per pengguna | `backend/migrations/0002_convoys.sql` |
| Undangan | Kode 10 karakter Crockford Base32; normalisasi input; hash HMAC-SHA256 dengan `INVITE_HMAC_PEPPER`; expiry, `maxUses`, revoke; kode mentah hanya pada respons pembuatan | `backend/src/convoys/invite-code.ts` |
| Join dan anggota | Join menghasilkan `requested`; approve/reject; remove; leave; role `leader/co_leader/member`; transfer kepemimpinan | `backend/src/convoys/convoys.service.ts` |
| Kapasitas | Entitlement dibaca server; default gratis 3, maksimum 30; permintaan pending ikut memesan kapasitas; kapasitas klien di-clamp/ditolak | `backend/src/convoys/entitlement.service.ts` |
| Lifecycle | `draft → lobby → active ⇄ paused → completed`; `cancelled` dari status nonterminal; `end` adalah alias `complete`; `If-Match` opsional | `backend/src/convoys/convoy-state.ts` |
| Rute | `PATCH /route` hanya leader/co-leader dan rute harus milik actor; `version` + `route_version` naik; event ke room. `GET /v1/routes/{id}` memberi geometri kepada pemilik atau anggota aktif konvoi | `convoys.service.ts`, `routes.service.ts` |
| Lokasi live | Tiket sekali pakai; WebSocket terautentikasi; validasi posisi; simpan Redis dengan TTL; stale; reconnect replay; isolation room | `backend/src/realtime/*` |
| Handoff | Saat semua socket leader terputus, co-leader/anggota aktif terlama menjadi leader; audit dan event | `realtime.gateway.ts` |
| Audit | Insert-only untuk perubahan konvoi dan handoff | `convoy_audit_logs` |
| HTTP security | Bearer token, validasi DTO whitelist, otorisasi resource, rate limit HTTP global | guard, DTO, service |

Endpoint yang tersedia (lihat `docs/openapi.json` untuk skema lengkap):

```text
GET    /v1/convoys
GET    /v1/convoys/active
POST   /v1/convoys
POST   /v1/convoys/join
GET    /v1/convoys/{id}
GET    /v1/convoys/{id}/members
GET    /v1/convoys/{id}/positions
PATCH  /v1/convoys/{id}/sharing
GET    /v1/convoys/{id}/invites
POST   /v1/convoys/{id}/invites
DELETE /v1/convoys/{id}/invites/{inviteId}
POST   /v1/convoys/{id}/members/{userId}/approve
POST   /v1/convoys/{id}/members/{userId}/reject
DELETE /v1/convoys/{id}/members/{userId}
PATCH  /v1/convoys/{id}/members/{userId}
POST   /v1/convoys/{id}/transfer
POST   /v1/convoys/{id}/leave
PATCH  /v1/convoys/{id}/route
POST   /v1/convoys/{id}/publish
POST   /v1/convoys/{id}/start
POST   /v1/convoys/{id}/pause
POST   /v1/convoys/{id}/resume
POST   /v1/convoys/{id}/complete
POST   /v1/convoys/{id}/end
POST   /v1/convoys/{id}/cancel
GET    /v1/routes/{id}
POST   /v1/realtime/ticket
```

### 2.2 Android

| Area | Implementasi |
|---|---|
| Data | DTO konvoi, anggota, invite, posisi, dan event realtime; endpoint Retrofit; `ConvoyRepository` |
| Realtime | `ConvoyRealtimeClient`: tiket baru, `sinceSeq`, deduplikasi `id`, urutan `seq`, backoff eksponensial + jitter, ping, penanganan status akses |
| State | `ConvoyViewModel`: daftar/aktif, detail, anggota, lokasi, consent, aksi lifecycle, approve/reject/remove/leave, route update |
| UI | `ConvoyScreen`: buat konvoi (termasuk waktu mulai ISO 8601), join dengan kode, invite, daftar anggota, aksi leader, kontrol status, berbagi lokasi, peta, marker anggota, dan garis rute bersama |
| Navigasi | Tab **Konvoi** ditambahkan di `AppRoot` |
| Peta | `RiderMap` menerima marker anggota dan geometri rute bersama; hanya posisi yang lolos filter server yang ditampilkan, rute digambar sebagai LineString |
| Konfigurasi | `features.convoy = true`; ambang stale dan kapasitas dibaca dari bootstrap config |

### 2.3 Dokumentasi

- `docs/openapi.json` diregenerasi dari DTO (50 path).
- `docs/API_CONTRACT.md`: status implementasi dan kontrak konvoi aktual.
- `docs/REALTIME_EVENTS.md`: bagian implementasi Phase 2, termasuk perbedaan dari rancangan.
- `docs/DATA_MODEL.md`: skema aktual, Redis, dan data yang belum ada.
- `docs/ARCHITECTURE.md`: batas runtime satu proses dan batasan Android.
- `docs/DECISIONS.md`: D-030…D-040.
- `docs/REQUIREMENTS_MATRIX.md`: status CNV-01…CNV-08.
- `backend/.env.example`: Redis, pepper, TTL, kapasitas, stale, dan link undangan.

## 3. State machine

```text
draft ──publish──> lobby ──start──> active ⇄ paused
  │                  │                │        │
  │                  └──cancel──┐     │        │
  └──────cancel──────> cancelled <────┴────────┘
                                      │
                                      └──complete──> completed
```

- Hanya transisi di atas yang diterima; lainnya `409 INVALID_CONVOY_STATE`.
- `If-Match` divalidasi bila header dikirim; konflik `409 VERSION_MISMATCH`.
- Status terminal: `completed`, `cancelled`.
- Saat terminal, posisi/presence dan buffer event konvoi dihapus; snapshot tidak lagi memuat lokasi.
- Leader yang keluar saat masih ada anggota aktif mempromosikan co-leader/anggota aktif terlama dan memperbarui `convoys.leader_id`; bila sendirian, konvoi menjadi `cancelled`.

## 4. Undangan dan kapasitas

- Panjang 10 karakter dari alfabet Crockford Base32 (`0-9A-Z` tanpa I/L/O/U), sekitar 50 bit entropi.
- Input dinormalisasi (huruf kecil, pemisah, `I/L→1`, `O→0`, `U→V`).
- Hanya hash HMAC-SHA256 yang disimpan; database tidak menyimpan kode mentah.
- Default berlaku 24 jam; `maxUses` default 20; dapat dicabut; invite kedaluwarsa atau habis menghasilkan `410`.
- Join selalu `requested`; kapasitas efektif dihitung dari `active + requested + leader`.
- Kapasitas default 3 dan maksimum 30, dibaca dari `user_entitlements` di server. Nilai `capacity` klien tidak dipercaya: di-clamp ke batas dan ditolak bila di atas maksimum.
- Permintaan join yang belum disetujui dapat dibatalkan dengan `POST /leave` (`requested → left`).

## 5. Realtime dan privasi lokasi

### 5.1 Alur

1. Klien meminta `POST /v1/realtime/ticket` dengan Bearer token dan `convoyId`.
2. Server memeriksa membership `active`, status `lobby/active/paused`, lalu menerbitkan tiket acak 32 byte. Yang disimpan hanya SHA-256; TTL default 60 detik.
3. Handshake `WS /v1/realtime?ticket=...&sinceSeq=...` mengambil dan menghapus tiket secara atomik, lalu memeriksa ulang membership.
4. Server memutar event setelah `sinceSeq`, mengirim `convoy.snapshot`, lalu `convoy.ready`.
5. Klien mengirim `convoy.location.updated`; server mengabaikan `userId` dari payload dan memakai identitas tiket.
6. Posisi disimpan dengan TTL 300 detik dan disiarkan ke room `convoy:{id}`.
7. Posisi yang tidak diperbarui melewati ambang stale (default 30 detik) menghasilkan `convoy.location.stale` satu kali sampai ada posisi baru.
8. Saat keluar/dikeluarkan/konvoi selesai, key posisi/presence dihapus dan koneksi terkait ditutup `4003`.

### 5.2 Validasi dan pembatasan

- Hanya konvoi `active`, anggota `active`, dan `sharingConsent = true` yang dapat mengirim posisi.
- Maksimum 1 pesan posisi per detik per koneksi; pelanggaran menghasilkan `error RATE_LIMITED`.
- Latitude −90…90, longitude −180…180, akurasi 0…1000 m, heading 0…360, kecepatan 0…100 m/s.
- `recordedAt` maksimum 30 detik di masa depan dan tidak lebih tua dari 5 menit.
- Posisi duplikat atau lebih lama ditolak `OUT_OF_ORDER`; klien juga menduplikasi berdasarkan `id` event.
- Anggota tanpa consent tidak muncul di snapshot posisi dan tidak dapat mengirim posisi.
- Event lokasi tidak pernah masuk PostgreSQL, feed, atau room di luar konvoi.

### 5.3 Reconnect

- Klien menyimpan `lastSeq`; handshake ulang mengirim `sinceSeq`.
- Server memutar event dari list `convoy:{id}:events` (maksimum 2000, TTL 24 jam).
- Bila buffer sudah terpotong, snapshot membawa `replayTruncated: true`; klien harus mengambil snapshot sebagai kebenaran baru.
- Backoff klien 1, 2, 4, 8, 16, 30 detik dengan jitter.
- Tiket selalu diminta ulang; tiket lama tidak dapat dipakai dua kali.

### 5.4 Handoff

Saat socket terakhir milik leader tertutup, server:

1. memilih co-leader, atau anggota aktif dengan `joined_at` paling lama;
2. menjadikan leader lama `co_leader`;
3. memperbarui `convoys.leader_id` dan menaikkan `version`;
4. menulis audit `leadership.handoff`;
5. menyiarkan `convoy.member.updated` dengan `reason: leader_disconnected`.

Jika tidak ada anggota aktif lain, konvoi tetap tanpa handoff dan menunggu leader. Perilaku ini otomatis dan dapat terjadi saat jaringan putus. Jalur `POST /leave` untuk leader memakai promosi yang sama dan juga memperbarui `convoys.leader_id`; bila tidak ada anggota aktif, konvoi dibatalkan.

## 6. Keamanan

Kontrol yang diterapkan:

- REST memakai Bearer token; `userId` selalu dari token, bukan body/query.
- WebSocket memakai tiket sekali pakai berumur pendek; token akses jangka panjang tidak masuk URL.
- Hash tiket disimpan, bukan nilai mentah; pengambilan atomik mencegah replay.
- Keanggotaan diperiksa saat tiket dibuat, saat upgrade, saat pesan lokasi, dan saat snapshot.
- Room ditentukan server dari tiket; klien tidak dapat memilih room lain.
- Payload lokasi memakai whitelist field; `userId`/`role` spoof diabaikan.
- Hanya leader/co-leader yang dapat mengubah status tertentu, mengelola anggota, dan mengubah rute.
- Kapasitas dan entitlement dihitung server.
- Invite disimpan sebagai hash, dapat kedaluwarsa dan dicabut.
- Origin WebSocket diperiksa bila `CORS_ORIGINS` diisi.
- Audit insert-only mencatat perubahan anggota, peran, status, rute, invite, dan handoff.
- Posisi dihapus saat sesi berakhir dan memiliki TTL; tidak ada riwayat lokasi konvoi di PostgreSQL.

Test keamanan yang benar-benar dijalankan:

| Kasus | Ekspektasi | Status |
|---|---|---|
| Nonanggota membuka detail konvoi | 404 | Lulus |
| Anggota `requested` meminta tiket | 403 | Lulus |
| Anggota biasa mencoba start | 403 | Lulus |
| Anggota mencoba mengubah peran sendiri | 403 | Lulus |
| Kapasitas di atas entitlement | 403 | Lulus |
| Invite dicabut | 410 | Lulus |
| Invite kedaluwarsa | 410 | Lulus |
| Invite satu kali sudah habis | 410 | Lulus |
| Handshake tanpa tiket | 401 | Lulus |
| Tiket dipakai dua kali | 401 | Lulus |
| Payload memalsukan `userId` leader | Event tetap memakai ID pengirim asli | Lulus |
| Kirim posisi terlalu cepat | `RATE_LIMITED` | Lulus |
| Kirim posisi lebih lama | `OUT_OF_ORDER` | Lulus |
| Klien konvoi lain menerima event | Tidak menerima | Lulus |
| Anggota keluar | Socket ditutup 4003 dan tidak menerima event baru | Lulus |
| Konvoi selesai | `GET /positions` mengembalikan daftar kosong | Lulus |
| Leader keluar saat ada anggota | Anggota dipromosikan dan `leaderId` diperbarui | Lulus |
| Rute dibaca anggota konvoi | 200 + geometri | Lulus |
| Rute dibaca nonanggota | 404 | Lulus |

Tidak dilakukan: uji penetrasi, brute-force invite secara nyata, audit header keamanan HTTP, atau pengujian rate limit tiket sampai batas. Klaim keamanan di atas terbatas pada test otomatis tersebut.

## 7. Audit dan retensi

- `convoy_audit_logs` menyimpan `actor_id`, `action`, `target_user_id`, `metadata`, dan waktu. Kolom `request_id` tersedia di skema tetapi belum diisi oleh service pada implementasi ini.
- Tidak ada endpoint aplikasi untuk mengubah atau menghapus audit.
- Retensi audit konvoi belum ditetapkan; ini keputusan legal/operasional yang masih terbuka.
- Posisi live: TTL 300 detik dan penghapusan saat keluar/terminal. Buffer event: TTL 24 jam.
- Invite dan audit dihapus otomatis bila konvoi dihapus (foreign key cascade), kecuali aktor/target yang di-set null.

## 8. Load test 30 anggota

Perintah: `cd backend && npm test`, test `PRD capacity load: 30 WebSocket members and fanout`.

Konfigurasi aktual:

| Butir | Nilai |
|---|---|
| Mesin | Windows 10 build 19045, x64 |
| CPU | Intel Core i5-8250U @ 1,60 GHz, 8 logical core |
| RAM | 7,9 GiB |
| Runtime | Node.js v26.13.0, `node:test`, proses tunggal |
| Database | PGlite + PostGIS 3.7 (in-process, bukan server produksi) |
| Store realtime | `MemoryRealtimeStore` (`store=memory`) |
| Jaringan | Loopback 127.0.0.1, tanpa TLS, tanpa radio seluler |
| Profil | `profile=node-test` |
| Kapasitas | 30 anggota, entitlement test di-seed |

Metode:

- 30 akun, satu leader dan 29 anggota, semuanya `active` dan consent.
- 30 koneksi WebSocket dibuka paralel; tiap koneksi meminta tiket, handshake, dan menunggu `convoy.snapshot`.
- Setelah semua terhubung, 30 klien mengirim satu posisi; satu klien kolektor menunggu 30 event `convoy.location.updated` dari 30 pengirim berbeda.

Hasil:

```text
PHASE2_LOAD capacity=30 connectedMs=306 fanoutMs=114 store=memory profile=node-test
```

Arti angka:

- `connectedMs=306`: waktu dari mulai membuka 30 koneksi sampai snapshot terakhir diterima.
- `fanoutMs=114`: waktu sampai kolektor menerima 30 event posisi dari 30 pengirim.

Run lain pada mesin yang sama mencatat connect 252–306 ms dan fanout 70–114 ms; variasi ini normal untuk pengukuran loopback, bukan peningkatan performa yang diklaim.

Angka ini **bukan** bukti kapasitas produksi: tidak memakai Redis nyata, tidak melewati jaringan nyata, tidak menguji 30 perangkat, dan tidak menguji banyak konvoi bersamaan. Target PRD 30 anggota per konvoi terpenuhi pada lingkungan uji ini, bukan sebagai SLA.

## 9. Batasan dan pekerjaan yang belum selesai

Batasan verifikasi:

1. **Redis nyata tidak diuji.** Tidak ada Redis/valkey, Docker, atau WSL di mesin ini. Semua test realtime memakai store memori. Perilaku TTL, atomic ticket take, dan key Redis baru diperiksa secara kode, bukan runtime.
2. **Multi-instance belum didukung.** Hub fanout berada di memori proses; Redis tidak dipakai untuk pub/sub. Dua replika API akan memecah room. Ini blocker sebelum deployment multi-replika.
3. **Android belum diuji runtime.** Tidak ada emulator/AVD/perangkat. Build dan unit test lulus, tetapi layar konvoi, marker peta, permission, lifecycle, reconnect nyata, dan kualitas UI belum diverifikasi.
4. **Berbagi lokasi belum background penuh.** Tidak ada foreground service khusus konvoi. Berbagi berhenti saat proses aplikasi dibunuh; belum memenuhi janji background dan belum diuji process death.
5. **Peta produksi belum tersedia.** Gaya peta berasal dari konfigurasi; tanpa `RJ_MAP_STYLE_URL` UI menampilkan state konfigurasi. Marker memakai API MapLibre yang deprecated dan belum dilihat secara visual.
6. **Provider routing/geocoding belum dikonfigurasi.** Preview rute tetap 503 eksplisit; tidak ada rute palsu. Rute tersimpan dapat dibaca dan digambar, tetapi tampilan garis/atribusi belum dilihat pada perangkat.
7. **Belum ada billing.** `user_entitlements` dapat di-seed manual, tetapi tidak ada pembelian, verifikasi Google Play, atau upgrade paket.
8. **Di luar lingkup dan belum ada:** chat konvoi, voice/PTT, hazard, push notification konvoi, deep link undangan Android (kode/link dikembalikan backend, tetapi aplikasi memakai input kode), dashboard admin, dan retensi audit.
9. **Rate limit tiket dan invite belum diuji sampai batas.** Rate posisi sudah diuji.
10. **OpenAPI 50 path** hanya mencakup endpoint yang ada; endpoint rancangan lain di `API_CONTRACT.md` belum boleh dianggap tersedia.
11. **Audit `request_id` belum diisi.** Kolom tersedia, tetapi service belum meneruskan request ID.

Perbaikan yang disarankan sebelum beta:

- Provision Redis dan jalankan ulang test realtime terhadap Redis nyata, termasuk dua instance untuk membuktikan pub/sub atau sticky routing.
- Tambah foreground service khusus konvoi atau hentikan berbagi secara eksplisit saat aplikasi tidak aktif dengan indikator UI.
- Uji dua perangkat nyata: join, approve, lokasi, stale, putus jaringan, reconnect, handoff, dan selesai.
- Tambah deep link undangan dan uji dari browser/WhatsApp.
- Tambah test rate limit tiket/invite dan uji beban dengan banyak konvoi, bukan satu room.
- Isi `request_id` audit dan tetapkan retensi audit.
- Ganti marker MapLibre yang deprecated ke Annotation API saat stabil.

## 10. Perintah reproduksi

```bash
# Backend: build + seluruh test (PGlite/PostGIS, HTTP, WebSocket, load)
cd backend
npm test

# OpenAPI dari DTO
AUTH_JWT_SECRET=0123456789abcdef0123456789abcdef npm run openapi

# Android: unit test + APK debug
cd ../android
JAVA_HOME="$PWD/.tooling/jdk-21.0.13.1+2" \
  ./gradlew :app:testDebugUnitTest :app:assembleDebug --console=plain
```

APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`.

Tidak ada commit, push, deployment, atau perubahan data produksi yang dilakukan.
