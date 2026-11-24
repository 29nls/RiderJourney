# ARCHITECTURE — RiderJourney

Rancangan arsitektur untuk implementasi bertahap. Mengikuti PRD 9 dan batas fase PRD 15. Keputusan yang belum final dicatat di `DECISIONS.md`.

## 1. Prinsip yang mengikat

1. Backend adalah sumber kebenaran untuk hak akses, keanggotaan, kapasitas, paket, kuota, dan entitlement.
2. Semua mutasi melewati autentikasi, validasi, otorisasi, rate limit, dan idempotency bila relevan (PRD 9.4).
3. Provider peta, routing, geocoding, cuaca, storage, voice, push, dan billing berada di balik adapter (PRD 9.2, 9.4).
4. Posisi live adalah data sementara di Redis, bukan baris database transaksional (PRD 8 catatan, 9.4).
5. Modular monolith lebih dulu; tidak ada microservices, event bus eksternal, atau abstraksi tanpa use case (prompt 4 butir 11).
6. Tidak ada secret, service-role key, atau kredensial database di aplikasi mobile maupun repository.

## 2. Bentuk sistem

Tiga klien/proses dan satu backend:

| Komponen | Teknologi | Tanggung jawab |
|---|---|---|
| Aplikasi Android | Kotlin, Compose M3, Hilt, Room, WorkManager, MapLibre | UI, tracking lokal, cache, sinkronisasi |
| API backend | NestJS + TypeScript (modular monolith) | REST `/v1`, otorisasi, transaksi, WebSocket |
| Worker | Proses Node terpisah dari image yang sama | Push, media, moderasi, ekspor, rekonsiliasi billing |
| Admin web | Next.js + TypeScript | Operasional dan moderasi dengan RBAC |
| PostgreSQL + PostGIS | Data transaksional dan geospasial | Akun, trip, konvoi, konten, audit |
| Redis | Live position, presence, rate limit, pub/sub, idempotency | Data sementara ber-TTL |
| Object storage S3-compatible | Media dan poster | Signed URL berbatas waktu |
| LiveKit SFU | Voice/PTT Fase 2 | Media audio real-time |

## 3. Batas modul backend

Satu aplikasi NestJS, modul berbatas. Aturan dependensi:

- Modul boleh bergantung pada `core` (konfigurasi, database, redis, auth guard, audit, outbox).
- Modul domain tidak mengimpor repositori modul lain; komunikasi lewat service publik atau event internal.
- Tidak ada tipe entitas database yang bocor ke controller; semua input/output memakai DTO.

| Modul | Isi | Requirement |
|---|---|---|
| `identity` | Verifikasi token, pemetaan `sub` → user, sesi, consent | ACC-01…ACC-05 |
| `profiles` | Profil, privasi, pengaturan | RID-01, RID-02 |
| `vehicles` | Garasi, kendaraan utama, plat terenkripsi | VEH-01…VEH-03 |
| `places` | Pencarian, nearby, favorit | MAP-02, MAP-05 |
| `routing` | Preview rute, waypoint, fallback provider | MAP-03, MAP-04 |
| `trips` | Sesi, titik, agregasi, riwayat, pemulihan | TRP-01…TRP-05 |
| `convoys` | Siklus konvoi, anggota, undangan, kapasitas | CNV-01…CNV-08 |
| `realtime` | Gateway WebSocket, ticket, room, presence | PRD 10.2 |
| `chat` | Pesan konvoi, pagination, idempotensi | COM-01, COM-02 |
| `hazards` | Laporan, TTL, konfirmasi, confidence | SAF-01…SAF-04 |
| `communities` | Klub, role, agenda, channel, album | CMT-01…CMT-07 |
| `social` | Feed, komentar, reaksi, follow, blokir | SOC-01…SOC-06 |
| `media` | Unggah, validasi, signed URL, moderasi | PRD 5.10 |
| `billing` | Verifikasi Google Play, entitlement, rekonsiliasi | PRD 5.12 |
| `rewards` | Ledger poin, badge, leaderboard, redeem | RWD-01…RWD-05 |
| `notifications` | Push, preferensi, badge unread | PRD 5.13 |
| `moderation` | Laporan, tindakan, audit | PRD 5.14 |
| `admin` | Endpoint operasional dengan RBAC | PRD 5.14 |
| `config` | Remote config, minimum version, feature flag | PRD 9.4 |

## 4. Pipeline permintaan

Urutan tetap untuk setiap endpoint:

```text
TLS → requestId → authn (TokenVerifier) → validasi DTO → otorisasi resource
    → rate limit → idempotency (bila mutasi retryable) → handler dalam transaksi
    → outbox event → respons
```

- **Otorisasi** selalu memeriksa kepemilikan atau keanggotaan di server, bukan hanya role. Contoh: `PATCH /v1/vehicles/{id}` memeriksa `vehicles.owner_id = auth.user.id`.
- **Idempotency** menyimpan hash body + kunci di Redis 24 jam; hasil pertama diputar ulang untuk kunci yang sama. Untuk pesan, unique index `(convoy_id, sender_id, client_message_id)` menjadi lapisan kedua.
- **Transaksi** membungkus perubahan multi-tabel (mis. konvoi + anggota + audit). Efek eksternal (push, FCM) dipicu setelah commit lewat outbox.
- **Audit** menulis `admin_audit_logs` untuk tindakan admin dan perubahan entitlement (PRD 5.14, 11.4).

## 5. Adapter

```ts
export interface RoutingProvider {
  preview(input: RouteRequest): Promise<RouteResult>;
  health(): Promise<ProviderHealth>;
}

export interface GeocodingProvider {
  search(query: string, near?: LatLng, limit?: number): Promise<PlaceResult[]>;
  reverse(point: LatLng): Promise<PlaceResult | null>;
}

export interface WeatherProvider {
  at(point: LatLng): Promise<WeatherSnapshot>;
}

export interface ObjectStorage {
  createUploadUrl(input: UploadIntent): Promise<SignedUpload>;
  createReadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface PushSender {
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

export interface BillingVerifier {
  verifyPurchase(token: string, productId: string): Promise<PurchaseState>;
}

export interface TokenVerifier {
  verify(jwt: string): Promise<AuthenticatedSubject>;
}
```

Aturan adapter: setiap adapter punya implementasi `fake` untuk test dan implementasi produksi yang dipilih lewat konfigurasi. Kegagalan provider mengembalikan error terklasifikasi (`PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `NO_ROUTE`), bukan ETA palsu (PRD 5.3).

## 6. Data dan state

### PostgreSQL

- Skema, tabel, indeks, dan retensi: `DATA_MODEL.md`.
- PostGIS dipakai untuk geometri rute, titik trip, laporan bahaya, dan pencarian radius (PRD 8).
- Semua waktu `timestamptz`; ID UUIDv7 (D-012).
- Migrasi versioned, tidak ada perubahan manual (prompt 3).

### Redis

| Key | Tipe | TTL | Isi |
|---|---|---|---|
| `convoy:{id}:pos:{userId}` | hash | 300 s | lat, lng, accuracy, heading, speed, recorded_at, seq |
| `convoy:{id}:presence` | hash | 120 s | userId → last_heartbeat |
| `convoy:{id}:members` | set | selama sesi | cache keanggotaan aktif |
| `ws:ticket:{jti}` | string | 60 s | userId, convoyId, sekali pakai |
| `rl:{scope}:{subject}` | counter | per jendela | rate limit |
| `idem:{userId}:{key}` | string | 24 jam | hash body + respons |
| `convoy:{id}:seq` | counter | selama sesi | urutan event |

Kunci posisi dihapus saat anggota keluar, dikeluarkan, atau konvoi berakhir (PRD 5.5 aturan lokasi). Tidak ada key posisi tanpa sesi aktif.

### Object storage

- Unggah langsung dari klien memakai signed PUT berbatas waktu; server memverifikasi metadata dan melakukan MIME sniffing setelah unggah.
- Media privat dibaca lewat signed GET berumur pendek; tidak ada URL publik permanen (PRD 5.10, 11.4).

## 7. Arsitektur Android

### 7.1 Modul

```text
:app                        # navigasi, DI graph, Application
:core:common                # Result, error model, dispatcher, formatter
:core:designsystem          # tema, komponen, token warna/teks
:core:network               # Retrofit, interceptor auth, serialisasi
:core:database              # Room: cache, draft, antrean trip
:core:location              # FusedLocation, filter akurasi, sampling adaptif
:core:maps                  # MapLibre, style, marker, kamera
:core:realtime              # WebSocket, reconnect, backoff, envelope
:feature:auth
:feature:home
:feature:routes
:feature:trips
:feature:convoy
:feature:chat
:feature:hazards
:feature:profile
:feature:settings
```

Aturan: `feature` tidak bergantung pada `feature` lain; `feature` bergantung pada `domain` miliknya dan `core`. Implementasi `data` berada di dalam modul fitur atau modul data terpisah saat dibutuhkan, dan mengimplementasikan antarmuka repositori domain.

### 7.2 Lapisan per fitur

```text
presentation (Compose, ViewModel, UiState)
      ↓ memanggil use case
domain (model, repository interface, use case, aturan bisnis)
      ↑ diimplementasikan oleh
data (Retrofit/Room/WebSocket, mapper, cache)
```

ViewModel mengekspos `StateFlow<UiState>` dengan state: loading, content, empty, error(retryable), permissionDenied, offline/degraded, stale. Tidak ada akses langsung ke Retrofit atau Room dari Composable.

### 7.3 Tracking dan foreground service

State machine sesi:

```text
IDLE → PREPARING → RUNNING ⇄ PAUSED → FINISHING → FINISHED
             ↘ PERMISSION_DENIED        ↘ RECOVERABLE (app dibunuh OS)
```

- `PREPARING` meminta izin bertahap; `RUNNING` menjalankan `ForegroundService` bertipe `location` dengan notifikasi permanen (PRD 12).
- Sampling: 5 detik saat bergerak, 30 detik saat diam, adaptif saat hemat baterai; setiap perubahan akurasi diberi indikator (PRD 5.4, 11.3).
- Titik disimpan ke Room lebih dulu, lalu dikirim batch ke backend; kegagalan jaringan tidak menghapus data (PRD 11.2).
- Filter: tolak titik dengan akurasi di atas ambang, lompatan yang menghasilkan kecepatan tidak wajar, dan tandai `gap` saat GPS hilang tanpa interpolasi agresif (TRP-03, aturan pencatatan).
- Sesi yang tidak ditutup dipulihkan sebagai draft dan dikonfirmasi pengguna (BR-15, TRP-04).

### 7.4 Jaringan dan realtime

- Retrofit + OkHttp; header `Authorization` dari interceptor; token di Android Keystore/secure storage (PRD 11.4).
- WebSocket memakai envelope yang sama dengan `REALTIME_EVENTS.md`; reconnect exponential backoff dengan jitter, resubscribe, dan `since_seq` untuk menutup celah.
- Saat offline, UI menandai degraded dan tidak menampilkan posisi lama sebagai live (BR-14).

### 7.5 Peta

- MapLibre Native; style dan tile URL berasal dari konfigurasi, atribusi provider ditampilkan (MAP-06).
- Marker anggota hanya dirender dari event yang lolos otorisasi server; posisi stale diberi label waktu, bukan animasi menyamar sebagai live.
- Semua panggilan routing/geocoding lewat backend agar kunci provider tidak ada di perangkat (9.4).

## 8. Admin web

- Next.js + TypeScript, server-side session, RBAC di API admin.
- Fase 1: dashboard ringkas, pencarian akun, tindakan suspend/ban dengan alasan, review laporan bahaya, konfigurasi paket/feature flag/minimum version, audit log.
- Setiap tindakan sensitif menyimpan actor, target, waktu, alasan, before/after, request ID (PRD 5.14).

## 9. Worker dan pekerjaan asinkron

| Job | Pemicu | Idempotensi |
|---|---|---|
| Kirim push | Outbox `notification.created` | Kunci `notification_id + token` |
| Validasi media | Setelah unggah selesai | `media_asset_id` |
| Moderasi otomatis | Media/posting baru | `target_type + target_id + versi` |
| Ekspor poster/video | Permintaan pengguna | `export_job_id` |
| Rekonsiliasi billing | Terjadwal | `provider_txn_id` |
| Kedaluwarsa laporan bahaya | Terjadwal | `hazard_id + expires_at` |
| Pembersihan posisi live | Terjadwal + event keluar | TTL Redis, bukan job kritis |

Retry memakai backoff eksponensial dengan batas; pekerjaan yang gagal permanen masuk dead-letter dan memicu alert.

## 10. Observability

- Log JSON terstruktur dengan `requestId`, `userId` (ID internal, bukan email), `route`, `status`, `latency`; tidak ada token, koordinat presisi, plat, atau isi pesan.
- Metrik: latency p50/p95 per endpoint, error rate, reconnect WebSocket, stale location rate, kegagalan provider, kegagalan upload, status push, mismatch entitlement (PRD 13.2).
- Trace OpenTelemetry dari API ke database/Redis/provider.
- Crash reporting Android tanpa data sensitif; event analytics sesuai PRD 13.1.
- Audit log tidak boleh diedit atau dihapus lewat API aplikasi.

## 11. Deployment

- API dan worker dari image yang sama, dijalankan sebagai proses berbeda; migrasi dijalankan sebagai job sebelum rilis.
- Minimal dua replika API saat staging/production; WebSocket gateway memakai Redis pub/sub agar replika dapat menyiarkan event.
- Health check: `/health/live` (proses hidup) dan `/health/ready` (database + Redis).
- Backup PostgreSQL harian dan uji restore berkala (PRD 11.2); object storage memakai lifecycle policy.
- Region, ukuran instance, dan penyedia hosting ditentukan saat deployment; dokumen ini tidak mengarang angka kapasitas.

## 12. Mode kegagalan

| Kegagalan | Perilaku |
|---|---|
| Routing provider down | Coba fallback sesuai konfigurasi; bila gagal, tampilkan error transparan tanpa ETA |
| Redis down | Tolak update posisi live dengan error yang jelas; chat dan trip tetap berjalan lewat database |
| WebSocket terputus | Klien reconnect dengan backoff; UI menampilkan status; pesan diantrekan lokal |
| GPS hilang | Simpan `gap`, hentikan penambahan jarak, tampilkan status akurasi |
| Storage penuh/quota | Tolak unggah dengan kode `QUOTA_EXCEEDED`; tidak menghapus media lama otomatis |
| Billing verification gagal | Entitlement tidak berubah; status `pending` dan rekonsiliasi |
| Leader disconnect | Co-leader mengambil alih sesuai BR-07; bila tidak ada, konvoi menunggu leader |

## 13. Yang belum diputuskan

- Provider tile/routing/geocoding/cuaca dan biayanya (PRD 17 butir 3) — memblokir exit criteria Fase 0.
- Identitas merek, domain, dan package name final (PRD 17 butir 1).
- Kebijakan retensi dan legal (PRD 17 butir 5, 10).
- Kapasitas dan harga paket resmi (PRD 17 butir 4).

Detail kontrak: `API_CONTRACT.md`, `REALTIME_EVENTS.md`, `DATA_MODEL.md`, `SECURITY_AND_PRIVACY.md`.
