# DECISIONS — RiderJourney

Catatan keputusan teknis dan produk. Setiap butir diberi label jenis informasi:

- **Fakta** — terbaca dari `PRD_RiderJourney.md` atau dari isi repository/mesin.
- **Asumsi** — default yang dipilih karena PRD belum menetapkan, wajib ditinjau.
- **Keputusan** — pilihan tim untuk fase ini, mengikat sampai diubah lewat catatan baru.

PRD adalah sumber kebutuhan utama. Bila prompt kerja dan PRD berbeda, PRD menang dan konfliknya dicatat di bagian 4.

---

## 1. Hasil audit repository (fakta)

| Temuan | Bukti |
|---|---|
| Repository berisi toolkit `@mindmux/brain-md` v0.3.0, bukan aplikasi RiderJourney | `package.json` (`name`, `bin`, `scripts.test`) |
| Tidak ada kode Android, backend, admin, atau infrastruktur | Tidak ada `android/`, `build.gradle*`, `backend/`, `docker-compose*`; pencarian glob hanya menemukan `package.json` toolkit |
| Tidak ada direktori `docs/` sebelum fase ini | `glob docs/**/*` → 0 hasil |
| PRD berada di root, 903 baris, versi 1.0, tanggal 24 November 2026 | `PRD_RiderJourney.md` baris 1–10 |
| Folder bukan repository git | `git rev-parse --is-inside-work-tree` → `fatal: not a git repository` |
| Toolchain mesin: Node v26.13.0, npm 11.20.0, Python 3.15.2 | keluaran `node -v`, `npm -v`, `python --version` |
| JDK terpasang 1.8.0_513; Docker, Gradle, psql tidak ditemukan | keluaran `java -version`, `docker --version`, `gradle -v`, `psql --version` |
| `brain/` dan `_root/` berisi materi toolkit brain.md, bukan kode produk | struktur direktori dan isi halaman brain |

Konsekuensi: Fase 0 tidak mempertahankan kode aplikasi apa pun karena belum ada. Tidak ada kode lama yang dihapus atau ditimpa.

---

## 2. Keputusan yang mengikat

| ID | Status | Keputusan | Alasan / bukti | Dampak |
|---|---|---|---|---|
| D-001 | Keputusan | `PRD_RiderJourney.md` di root tetap menjadi satu-satunya salinan PRD; `docs/` merujuk ke sana, tidak menduplikasi | Menghindari dua versi PRD yang menyimpang; prompt meminta salinan PRD di dalam `docs/`, tetapi juga melarang menimpa PRD | Semua rujukan dokumen memakai path root |
| D-002 | Keputusan | Nama kerja `RiderJourney`, dipusatkan pada konfigurasi merek (`BrandConfig`: `productName`, `packageName`, `apiBaseUrl`, `tileStyleUrl`) | PRD baris 9 menyebut nama kerja dan mewajibkan nama final, domain, package name ditetapkan terpisah (PRD 17 butir 1) | Ganti nama tidak boleh menuntut perubahan kode domain |
| D-003 | Asumsi | `packageName` sementara `id.riderjourney.app`; domain dan aset merek belum ditetapkan | PRD 17 butir 1 masih terbuka; nilai ini hanya placeholder yang bisa diubah sebelum Play Console | Wajib dikonfirmasi sebelum rilis; tidak boleh dipakai sebagai klaim merek |
| D-004 | Keputusan | Mobile: Kotlin, Jetpack Compose + Material 3, Clean Architecture (presentation/domain/data), MVVM, Hilt, Coroutines/Flow, Retrofit/OkHttp, kotlinx.serialization, Room, WorkManager, Foreground Service untuk tracking, MapLibre | PRD 9.1 menyebut Hilt **atau** Koin dan meminta "pilih satu"; Hilt dipilih karena terintegrasi dengan Compose dan ViewModel | Modul Android memakai Hilt sejak awal; tidak ada Koin |
| D-005 | Keputusan | Backend: NestJS + TypeScript sebagai modular monolith, PostgreSQL + PostGIS, Redis, REST `/v1`, WebSocket, object storage S3-compatible, FCM, verifikasi token di backend | Prompt baseline; PRD 9.2 menyebut NestJS **atau** Kotlin/Ktor, dan PRD 17 butir 2 masih terbuka | PRD 17 butir 2 ditutup oleh keputusan ini; harus dicatat saat PRD direvisi |
| D-006 | Keputusan | Identitas memakai OIDC/Firebase Auth di belakang antarmuka `TokenVerifier`; backend memverifikasi tanda tangan, issuer, audience, dan waktu kedaluwarsa; `sub` adalah satu-satunya sumber identitas | PRD 9.2 dan 11.4; prompt melarang mempercayai user ID dari client | Tidak ada endpoint yang menerima `userId` dari body untuk otorisasi |
| D-007 | Keputusan | Rendering peta MapLibre Native; tile, routing, geocoding, dan cuaca di balik adapter; tidak ada kredensial provider di repository | PRD 9.1, 9.4; PRD 17 butir 3 belum menetapkan provider | Pemilihan provider produksi tetap terbuka (lihat bagian 5) |
| D-008 | Keputusan | Posisi live hanya di Redis dengan TTL; PostgreSQL tidak menyimpan ping GPS berfrekuensi tinggi; jejak perjalanan disimpan tersampling di `trip_points` | PRD 8 catatan penyimpanan, PRD 9.4, NFR 11.2 | Tidak ada tabel `convoy_positions` di PostgreSQL |
| D-009 | Keputusan | PTT/voice room masuk Fase 2, bukan MVP | PRD 15 menempatkan LiveKit/WebRTC di Fase 2; PRD 17 butir 6 masih terbuka | Fase 1 tidak menyertakan LiveKit; kontrak media disiapkan sebagai adapter |
| D-010 | Keputusan | Admin web Next.js + TypeScript dengan RBAC server-side; Fase 1 hanya user, laporan, konfigurasi | PRD 15 Fase 1; PRD 5.14 | Moderasi konten lanjutan menyusul di Fase 2 |
| D-011 | Keputusan | Fase 0 tidak membuat skeleton kode aplikasi | Prompt melarang "hanya membuat struktur folder"; setiap kode yang dibuat harus bisa dijalankan dan diuji | Fase 1 dimulai dengan walking skeleton yang lulus build/test, bukan folder kosong |
| D-012 | Asumsi | ID entitas UUIDv7; waktu disimpan `timestamptz` UTC; tampilan `Asia/Jakarta`; satuan metrik | Tidak diatur PRD; pilihan aman dan dapat diubah | Sorting kronologis efisien; tidak ada waktu lokal di database |
| D-013 | Keputusan | Format error API memakai problem-details RFC 9457 (`type`, `title`, `status`, `detail`, `code`, `requestId`, `errors[]`) | Tidak diatur PRD; dibutuhkan kontrak seragam | Klien memetakan `code`, bukan teks pesan |
| D-014 | Keputusan | Pagination berbasis cursor (keyset), bukan offset, untuk feed, chat, riwayat, anggota | PRD 4 butir 4 (pagination) dan sifat data real-time | Cursor opaque berisi `created_at` + `id` |
| D-015 | Asumsi | Ambang stale lokasi default 30 detik tanpa update; TTL Redis 5 menit; update klien 5 detik saat bergerak, 30 detik saat diam, adaptif saat hemat baterai | PRD 5.5 dan 11.3 mewajibkan status stale dan sampling adaptif tanpa angka | Semua angka adalah konfigurasi server, bukan janji performa |
| D-016 | Asumsi | Kode undangan 8 karakter Crockford Base32; disimpan sebagai HMAC-SHA-256 dengan pepper server; default berlaku 24 jam, dapat dicabut | PRD 7 BR-04 dan 5.5 CNV-01; PRD tidak menetapkan format | Kode asli tidak pernah tersimpan; lookup memakai hash |
| D-017 | Asumsi | Retensi: posisi live dihapus saat sesi berakhir; titik GPS mentah 30 hari; ringkasan trip permanen sampai dihapus pengguna; audit admin 2 tahun | PRD 11.5 mewajibkan kebijakan retensi tanpa angka; PRD 17 butir 5 terbuka | Wajib ditinjau legal sebelum produksi |
| D-018 | Asumsi | Kuota media awal: gambar 10 MB, video 200 MB, ditentukan per paket di server | PRD 17 butir 7 terbuka | Angka hanya default konfigurasi |
| D-019 | Asumsi | Penghapusan akun: masa tenggang 30 hari, lalu anonimisasi; data agregat tanpa identitas dipertahankan | PRD 5.1 ACC-04, BR-11, 11.5 | Status permintaan harus tercatat dan dapat diaudit |
| D-020 | Asumsi | Tiket WebSocket berumur 60 detik, sekali pakai, diterbitkan lewat REST setelah cek keanggotaan | PRD 10.2 mewajibkan autentikasi dan validasi keanggotaan | Tidak ada token statis di query string jangka panjang |
| D-021 | Keputusan | Semua mutasi memakai `Idempotency-Key` untuk operasi yang dapat di-retry (trip start/finish, pesan, laporan, konvoi join, billing verify) | PRD 9.4 dan BR-13, BR-06 | Disimpan di Redis 24 jam + unique index di tabel terkait |
| D-022 | Keputusan | Analitik tidak menyimpan koordinat presisi, plat, isi chat, token; event memakai ID internal dan properti non-sensitif | PRD 13.1 | Skema event diaudit sebelum rilis |
| D-023 | Keputusan | OpenAPI dihasilkan dari DTO NestJS pada awal Slice 1A, bukan ditulis tangan di Fase 0; `API_CONTRACT.md` menjadi acuan field sampai file OpenAPI ada | Menulis OpenAPI tangan tanpa kode berisiko menyimpang dari implementasi; PRD 18 butir API contract tetap dicatat sebagai belum selesai | Checklist PRD 18 butir 5 tetap terbuka sampai Slice 1A |
| D-024 | Keputusan | Tidak ada layanan eksternal yang diprovision pada Fase 0; semua integrasi berstatus belum tersedia sampai ada environment dan kredensial yang dikelola pemilik produk | Tidak ada bukti instance, kredensial, atau tagihan; mengklaim aktif akan melanggar instruksi | Dokumen dan laporan menyebut status "belum tersedia", bukan "aktif" |

---

## 3. Keputusan arsitektur utama (ringkas)

### D-005 — Modular monolith NestJS

Satu proses API dengan modul berbatas jelas, satu database, satu Redis, satu worker. Alasan: PRD 15 memulai dari MVP, PRD 9.2 menyebut modular monolith, dan microservices prematur dilarang prompt bagian 4 butir 11. Batas modul ditegakkan lewat aturan import: modul domain tidak mengimpor modul lain secara langsung, hanya lewat service publik atau event internal.

Konsekuensi: scaling awal vertikal + replika API stateless; WebSocket fan-out butuh Redis pub/sub; worker dipisah prosesnya agar pekerjaan berat tidak memblokir API.

### D-006 — Verifikasi identitas

Alur: klien memperoleh token dari identity provider → klien mengirim `Authorization: Bearer <token>` → `TokenVerifier` memvalidasi tanda tangan lewat JWKS, issuer, audience, `exp`, `nbf` → backend memetakan `sub` ke `users.auth_uid` dan memakai `users.id` internal. Tidak ada `userId` dari klien yang dipercaya. Untuk pengujian lokal, provider OIDC dijalankan sebagai container; kredensial produksi tidak pernah masuk repository.

### D-008 — Jalur data lokasi

- Klien mengirim `convoy.location.updated` lewat WebSocket (bukan polling REST).
- Gateway memvalidasi keanggotaan, consent, status sesi, dan laju kiriman.
- Posisi terbaru ditulis ke Redis: `convoy:{id}:pos:{userId}` dengan TTL 300 detik dan field `lat`, `lng`, `accuracy`, `heading`, `speed`, `recorded_at`, `seq`.
- Server menyiarkan ke room `convoy:{id}` hanya untuk anggota aktif yang berhak.
- Saat anggota keluar, dikeluarkan, atau sesi selesai: key dihapus dan akses room dicabut.
- Jejak perjalanan pribadi disimpan tersampling ke `trip_points` lewat REST batch; bukan dari setiap ping live.

### D-011 — Tidak ada kode di Fase 0

Fase 0 adalah discovery, audit, breakdown, dan fondasi rancangan. Membuat `android/` atau `backend/` kosong akan melanggar aturan "jangan hanya membuat struktur folder" dan menghasilkan klaim build yang tidak bisa diverifikasi. Fase 1 membuka dengan vertical slice autentikasi + profil yang benar-benar berjalan, diuji, dan dibangun di CI.

---

## 4. Konflik prompt vs PRD

| # | Prompt | PRD | Resolusi |
|---|---|---|---|
| 1 | Baseline menyebut LiveKit/WebRTC sebagai bagian stack | PRD 15 menempatkan PTT/voice di Fase 2; PRD 17 butir 6 masih terbuka | Ikut PRD: Fase 1 tanpa LiveKit; adapter disiapkan |
| 2 | Prompt meminta salinan PRD di dalam folder `docs/` | PRD sudah ada di root dan tidak boleh ditimpa | Ikut PRD: satu salinan di root, dirujuk dari `docs/` (D-001) |
| 3 | Prompt menyebut Hilt | PRD 9.1: "Hilt atau Koin; pilih satu" | Hilt dipilih (D-004), bukan konflik kebutuhan |
| 4 | Prompt menyebut seluruh kapabilitas (komunitas, feed, rewards, subscription) sebagai lingkup | PRD 15 membaginya ke Fase 1–4 | Ikut PRD: lingkup produk penuh, urutan pengerjaan bertahap |
| 5 | Prompt meminta aplikasi production-grade lengkap | Instruksi eksekusi pertama: hanya Fase 0 | Ikut instruksi eksekusi: Fase 0 berhenti di fondasi |

Tidak ada konflik lain yang ditemukan. Tidak ada requirement PRD yang dibatalkan.

---

## 5. Keputusan terbuka (butuh pemilik produk)

| ID | Butir PRD 17 | Status | Mengapa belum diputuskan | Default sementara |
|---|---|---|---|---|
| O-01 | 1 — nama final, logo, domain, package name, brand | Terbuka | Butuh keputusan merek dan pembelian domain | `RiderJourney`, `id.riderjourney.app` (D-002, D-003) |
| O-02 | 3 — provider tile, routing, geocoding, cuaca, dan biaya | Terbuka / **blocker exit criteria Fase 0** | Butuh evaluasi lisensi, SLA, kuota, dan anggaran | Adapter + fixture; tanpa kredensial produksi |
| O-03 | 4 — kapasitas konvoi dan harga resmi | Terbuka | 3/20/30 adalah indikasi APK (PRD 5.5, 19.2), bukan harga | Konfigurasi server, bukan komitmen komersial |
| O-04 | 5 — kebijakan lokasi dan retensi | Sebagian | Default teknis ada (D-015, D-017), validasi legal belum | Opt-in per konvoi, stale 30 detik, retensi 30 hari |
| O-05 | 7 — batas file dan kuota media | Terbuka | Butuh perhitungan biaya storage | D-018 |
| O-06 | 8 — kriteria leaderboard dan anti-cheat | Terbuka | Fase 3 | Belum dirancang |
| O-07 | 10 — usia, Terms, Privacy Policy, kontak darurat | Terbuka | Butuh penasihat hukum | Tidak ada klaim kepatuhan |
| O-08 | 2 — backend Firebase-heavy vs PostgreSQL/PostGIS | Ditutup oleh D-005 | Prompt menetapkan baseline | Modular monolith + PostGIS |

O-02 dan O-07 adalah dua hal yang tidak boleh dikarang: tidak ada nama provider, harga, atau teks kebijakan yang dicantumkan di dokumen ini sebelum diputuskan pemilik produk.

---

## 6. Biaya, dependency, lisensi, dan risiko operasional

Semua angka biaya **belum tersedia**. Tidak ada kuota, tagihan, atau kontrak yang bisa diklaim dari Fase 0.

| Kategori | Yang dibutuhkan | Status | Risiko bila salah pilih | Mitigasi |
|---|---|---|---|---|
| Tile peta | Kuota request/MAU, batas cache, atribusi | Terbuka (O-02) | Biaya membengkak, pelanggaran ToS, peta kosong saat kuota habis | Adapter + evaluasi 2–3 provider, monitoring penggunaan, cache sesuai lisensi |
| Routing | Biaya per rute/preview, SLA, cakupan motor | Terbuka | ETA salah, biaya per pencarian | Adapter, fallback, batas preview, disclaimer |
| Geocoding | Biaya per pencarian, rate limit | Terbuka | Pencarian gagal saat ramai | Adapter, cache hasil, rate limit |
| Cuaca | Kuota dan lisensi data | Terbuka | Data kadaluarsa dianggap peringatan | Tampilkan sumber + waktu, non-kritis |
| Storage/CDN | Biaya per GB, egress, lifecycle | Terbuka (O-05) | Biaya media membengkak | Kuota, kompresi, signed URL, lifecycle |
| FCM | Kuota gratis dan perilaku pengiriman | Belum diverifikasi | Notifikasi tidak sampai | Monitoring delivery, fallback in-app |
| LiveKit/voice | Biaya per participant-minute, TURN/SFU | Fase 2 | Biaya audio lebih besar dari pendapatan | Uji beban, batas durasi, monitoring |
| Google Play Billing | Komisi, pajak, refund, grace | Fase 4 | Entitlement tidak sinkron | Verifikasi server, rekonsiliasi, audit |
| Identity provider | Kuota MAU, harga | Terbuka | Login gagal saat kuota habis | Adapter `TokenVerifier`, pemantauan |

### 6.1 Dependency pihak ketiga

| Dependency | Lisensi/ketentuan | Catatan |
|---|---|---|
| MapLibre Native | Open source; atribusi wajib | Rendering; bukan penyedia tile |
| Data OpenStreetMap | ODbL dan atribusi “© OpenStreetMap contributors” | Wajib tampil; derivatif data tunduk ODbL |
| Tile/routing/geocoding provider | Kontrak komersial/ToS masing-masing | Tidak boleh diasumsikan gratis atau boleh di-cache tanpa batas |
| NestJS, PostgreSQL/PostGIS, Redis | Open source | Periksa lisensi saat mengunci versi |
| LiveKit | Open source + layanan hosted opsional | Fase 2 |
| Firebase Auth/FCM | Ketentuan Google | Data processing terms masuk kebijakan privasi |
| Google Play Billing | Ketentuan Google Play | Komisi dan kebijakan refund |

### 6.2 Risiko operasional

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Pembatasan background OEM | Tracking berhenti | FGS, panduan baterai, uji perangkat nyata, pemulihan sesi |
| GPS tidak akurat | Jarak/rute salah | Filter outlier, simpan akurasi, tampilkan gap |
| Provider peta berubah harga/down | Peta/rute gagal | Adapter, fallback, cache, monitoring, quota |
| Redis down | Posisi live berhenti | Degradasi jelas; chat/trip tetap via database |
| WebSocket fan-out | Latensi naik pada banyak konvoi | Uji beban 30 anggota, Redis pub/sub, batas koneksi |
| Moderasi kewalahan | Konten berbahaya tampil | Antrean, prioritas, rate limit, laporan pengguna |
| Billing tidak sinkron | Komplain/refund | Rekonsiliasi berkala, audit transaksi |
| Litigasi lisensi peta/aset | Takedown/denda | Audit lisensi, aset original, atribusi |

Tidak ada satu pun layanan pada tabel ini yang sudah diprovision atau diuji pada Fase 0.

---

## 7. Keputusan yang ditambahkan pada Fase 1

| ID | Status | Keputusan | Alasan / bukti | Dampak |
|---|---|---|---|---|
| D-025 | Keputusan | Fase 1 memakai autentikasi lokal email/password: bcrypt 12 round, JWT HS256 akses 15 menit, refresh token opaque acak yang di-hash dan dirotasi, reset token sekali pakai. `AUTH_MODE=local` adalah satu-satunya mode yang diterima | Prompt Fase 1 meminta auth sesuai provider yang dipilih, tetapi tidak ada kredensial OIDC/Firebase maupun environment provider. Endpoint lokal dapat dijalankan dan diuji sekarang tanpa mengarang kredensial | Menyimpang dari D-006 (OIDC/Firebase). `TokenVerifier` tetap menjadi jalur pengganti saat provider tersedia; migrasi akun perlu rencana |
| D-026 | Keputusan | Routing dan geocoding berada di balik adapter. Tanpa `ROUTING_BASE_URL`/`GEOCODING_BASE_URL`, API mengembalikan 503 `PROVIDER_NOT_CONFIGURED`; tidak ada rute, jarak, ETA, atau hasil tempat palsu. Android menampilkan state konfigurasi yang sama | Aturan kerja melarang hasil rute palsu dan mock sebagai backend final; provider produksi belum dipilih (O-02) | Peta dasar hanya tampil bila `RJ_MAP_STYLE_URL` diisi; fitur tetap dapat diuji dengan provider OSRM/Photon-compatible milik penguji |
| D-027 | Keputusan | Eksekusi Fase 1 dibatasi pada fondasi, auth, profil/privasi, garasi, peta/adapter, place search + route preview, trip personal, permission, migrasi/validasi/otorisasi/observability. Konvoi real-time, voice/PTT, feed, rewards, subscription, 3D, chat, dan hazard tidak dikerjakan | Instruksi kerja Fase 1 eksplisit; PRD menempatkan sebagian fitur tersebut di Fase 1, sehingga ini deviasi lingkup yang harus dikembalikan ke roadmap | Requirement CNV-01…06, COM-01, SAF-01…03 berstatus ditunda pada traceability; bukan klaim selesai |
| D-028 | Keputusan | OpenAPI dihasilkan dari DTO NestJS ke `docs/openapi.json` melalui `npm run openapi`; file ini adalah kontrak implementasi Fase 1, sedangkan `API_CONTRACT.md` tetap menjadi acuan produk | Melaksanakan D-023 setelah Slice 1A benar-benar ada | Perubahan DTO wajib diikuti regenerasi OpenAPI; file tidak ditulis tangan |
| D-029 | Operasional | Build Android Fase 1 diverifikasi dengan Gradle 8.13 + JDK 21 portabel di `android/.tooling/`; Android Studio JBR 25 tidak dipakai karena Gradle 8.13/AGP 8.11 menolaknya | Build pertama gagal pada JDK 25 (`25.0.4`) dan lulus setelah JDK 21; folder tooling diabaikan git | Mesin build/CI harus menyediakan JDK 17–21; dokumentasikan di pipeline |

---

## 8. Keputusan yang ditambahkan pada Fase 2

| ID | Status | Keputusan | Alasan / bukti | Dampak |
|---|---|---|---|---|
| D-030 | Keputusan | Kode undangan 10 karakter Crockford Base32, disimpan sebagai HMAC-SHA256 dengan `INVITE_HMAC_PEPPER`; default expiry 24 jam dan `maxUses` 20 | D-016 menetapkan 8 karakter tanpa angka operasional; 10 karakter memberi ~50 bit dan tetap mudah diketik. Pepper terpisah mencegah hash dapat dihitung ulang dari kode bila secret JWT bocor | Menggantikan panjang pada D-016; produksi wajib mengisi pepper dan tidak boleh memakai fallback secret |
| D-031 | Keputusan | Status konvoi `draft/lobby/active/paused/completed/cancelled`; `completed` dan `cancelled` terminal. `end` dipertahankan sebagai alias `complete` | Menyelaraskan PRD/UI dengan model data; `ended` pada rancangan lama tidak dipakai | Event dan API memakai `completed`; dokumen yang menyebut `ended` adalah rancangan lama |
| D-032 | Keputusan | Bila semua socket seorang leader terputus, server segera memindahkan peran leader ke co-leader atau anggota aktif terlama, menjadikan leader lama `co_leader`, menaikkan versi, menulis audit, dan menyiarkan `convoy.member.updated`. Bila leader menekan keluar, co-leader/anggota aktif terlama juga dipromosikan dan `convoys.leader_id` diperbarui; bila sendirian, konvoi dibatalkan | BR-07/CNV-07 membutuhkan kelangsungan kepemimpinan; menunggu tanpa batas membuat konvoi tidak dapat dikelola | Handoff dapat terjadi saat koneksi jaringan putus atau leader keluar; klien harus memproses perubahan peran |
| D-033 | Keputusan | Kapasitas efektif = 1 leader + anggota `active` + permintaan `requested`. Default gratis 3, maksimum server 30, nilai dari `user_entitlements`; `capacity` klien di-clamp dan ditolak bila di atas maksimum | CNV-08/BR-10 melarang mempercayai kapasitas klien; permintaan pending harus memesan tempat agar tidak overbook | Pengguna gratis dibatasi 3 kursi termasuk leader; upgrade paket belum tersedia sampai billing |
| D-034 | Keputusan | `REDIS_URL` tersedia → `RedisRealtimeStore`; tidak tersedia di development/test → store memori satu proses. `NODE_ENV=production` menolak start tanpa Redis. Buffer event memakai list Redis 2000 entri/24 jam, bukan Stream | Menjaga test dapat berjalan tanpa Docker tanpa menyamarkan produksi; Stream belum dibutuhkan untuk replay terbatas | Fallback memori tidak tahan restart dan tidak lintas proses; multi-instance belum didukung |
| D-035 | Keputusan | Join tidak langsung aktif; semua permintaan `requested` harus disetujui leader/co-leader. Satu pengguna hanya punya satu membership `active/requested` | CNV-02 dan BR-02; mencegah satu pengguna masuk dua konvoi atau melewati persetujuan | Perlu aksi leader; pembatalan permintaan lewat `POST /leave` |
| D-036 | Sebagian / batasan | Klien konvoi Android berbagi lokasi selama proses aplikasi dan ViewModel aktif; belum memakai foreground service khusus konvoi | Tracking trip sudah memiliki FGS, tetapi menambah FGS kedua menuntut desain notifikasi dan lifecycle terpisah; emulator tidak tersedia untuk menguji | Berbagi berhenti saat proses dibunuh; belum memenuhi janji background penuh dan harus diselesaikan sebelum beta |
| D-037 | Keputusan | Rate posisi 1 pesan/detik per koneksi; koordinat/akurasi/waktu divalidasi; posisi duplikat/lebih lama ditolak `OUT_OF_ORDER`; stale default 30 detik dicek berkala | Implementasi awal memakai 1/detik untuk test dan responsivitas; angka dapat dikonfigurasi. Deduplikasi mencegah posisi mundur | Berbeda dari rancangan 1/2 detik di `REALTIME_EVENTS.md`; kontrak aktual menang |
| D-038 | Keputusan | Perubahan konvoi menulis `convoy_audit_logs` (insert-only) dengan actor, action, target, metadata, request ID bila tersedia | CNV-03 dan PRD 5.14; investigasi sengketa anggota | Tidak ada endpoint aplikasi untuk mengubah/menghapus audit; retensi belum ditetapkan |
| D-039 | Keputusan | Hanya leader/co-leader yang boleh mengubah rute, dan `route_id` harus milik actor. Setiap perubahan menaikkan `version` dan `route_version`, lalu menyiarkan `convoy.route.updated` | BR-03; mencegah anggota menyuntikkan rute orang lain | Rute yang dihapus menjadi `NULL`; klien harus menangani `routeId: null` |
| D-040 | Keputusan | Chat, voice/PTT, hazard, billing, push konvoi, dan deep link undangan Android tidak termasuk eksekusi Phase 2 | Instruksi kerja hanya meminta CNV-01…CNV-08; mengerjakan sisanya akan memperluas fase tanpa test yang memadai | Requirement terkait tetap belum selesai; jangan mengklaim Phase 2 PRD penuh |
