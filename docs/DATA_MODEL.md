# DATA MODEL — RiderJourney

Rancangan skema PostgreSQL + PostGIS untuk Fase 1 dan tabel yang disiapkan bagi fase berikutnya. Diturunkan dari PRD 8, dilengkapi kolom operasional yang dibutuhkan kontrak API dan keamanan. Nama boleh berubah saat implementasi, tetapi keputusan yang mengubah arti data harus dicatat di `DECISIONS.md`.

Ketentuan umum:

- ID `uuid` versi 7 (D-012). Waktu `timestamptz` UTC.
- Semua tabel memiliki `created_at default now()`; `updated_at` diisi trigger.
- Penghapusan lunak (`deleted_at`) hanya untuk konten yang wajib diaudit; data pribadi yang dihapus mengikuti kebijakan retensi.
- Kolom sensitif disimpan terenkripsi di level aplikasi (AES-256-GCM, key version terpisah) atau memakai enkripsi disk + akses terbatas bila kolom tidak perlu dicari.
- Tidak ada `convoy_positions` di PostgreSQL. Posisi live ada di Redis (D-008).
- Migrasi versioned; Fase 1 memulai `0001_core_identity`, `0002_vehicles`, `0003_places_routes`, `0004_trips`, `0005_convoys_chat`, `0006_hazards`, `0007_admin_config`.

## 1. Identitas dan profil

### `users`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK | ID internal, dipakai di seluruh relasi |
| `auth_uid` | text unique not null | `sub` dari identity provider |
| `username` | citext unique not null | 3–24 karakter, validasi format dan profanity (ACC-03) |
| `display_name` | text not null | |
| `bio` | text null | maksimum 300 karakter |
| `city` | text null | |
| `avatar_media_id` | uuid null → media_assets | |
| `cover_media_id` | uuid null → media_assets | |
| `visibility` | enum `public`,`followers`,`private` | default `public` |
| `status` | enum `active`,`suspended`,`deletion_pending`,`deleted` | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indeks: `lower(username)` unik, `status`, `city`.

### `user_settings`

`user_id` PK → users, `location_sharing_default` bool default false, `trip_history_visibility` enum `private`,`followers`,`public` default `private`, `notification_preferences` jsonb, `audio_preferences` jsonb, `map_preferences` jsonb, `updated_at`.

### `user_consents`

`id`, `user_id`, `kind` enum `terms`,`privacy`,`location_disclosure`,`microphone_disclosure`, `version` text, `context` text, `granted_at`, `revoked_at` null. Indeks `(user_id, kind, granted_at desc)`. Tidak ada consent yang ditimpa; versi baru membuat baris baru (ACC-05).

### `device_tokens`

`id`, `user_id`, `fcm_token` unique, `platform` enum `android`, `app_version`, `last_seen_at`, `revoked_at`. Token dicabut saat logout (ACC-02).

## 2. Kendaraan

### `vehicles`

`id`, `owner_id` → users, `type` enum `motorcycle`,`car`,`other`, `brand`, `model`, `year` smallint null, `engine_cc` int null, `nickname` text null, `photo_media_id` uuid null, `plate_ciphertext` bytea null, `plate_key_version` smallint null, `is_primary` bool default false, `created_at`, `updated_at`.

- `plate_ciphertext` tidak pernah dikembalikan pada feed, peta, atau profil publik (VEH-03, RID-02).
- Unique partial index `(owner_id) where is_primary and deleted_at is null`.
- Batas jumlah kendaraan per paket divalidasi server (VEH-02).

### `emergency_contacts`

`id`, `user_id`, `name_ciphertext` bytea, `phone_ciphertext` bytea, `relationship` text null, `key_version` smallint, `created_at`, `updated_at`. Hanya pemilik yang dapat membaca; tidak pernah masuk profil publik, feed, atau komunitas (SAF-06). Direncanakan Fase 3, tabel disiapkan agar model tidak berubah bentuk.

## 3. Sosial dasar

- `follows(follower_id, followed_id, status enum pending/accepted, created_at, pk(follower_id, followed_id))`.
- `friend_requests(id, requester_id, recipient_id, status, responded_at)` — hanya dipakai bila model pertemanan diaktifkan; belum dipakai Fase 1.
- `blocks(blocker_id, blocked_id, created_at, pk)`; feed dan pesan memfilter keduanya (BR-12).

## 4. Tempat, favorit, dan rute

### `favorite_places`

`id`, `user_id`, `place_name`, `category`, `location geography(Point,4326)`, `provider`, `provider_ref`, `created_at`. Indeks GIST `location`, indeks `(user_id, created_at desc)`.

### `routes`

`id`, `owner_id`, `name` null, `origin geography(Point,4326)` null, `destination geography(Point,4326)` null, `route_geometry geometry(LineString,4326)`, `waypoints jsonb`, `distance_m` int, `duration_s` int, `provider` text, `created_at`, `updated_at`. Indeks GIST `route_geometry`; route disimpan sebagai snapshot agar preview yang disetujui konvoi tidak berubah diam-diam. `POST /v1/routes/{id}/recalculate` membuat baris baru, bukan menimpa snapshot lama. Route lama tanpa `origin`/`destination` memakai `ST_StartPoint`/`ST_EndPoint` geometri saat dihitung ulang.

### `route_waypoints`

`id`, `route_id`, `seq` smallint, `label` null, `location geography(Point,4326)`, unique `(route_id, seq)`. Maksimum 7 titik singgah divalidasi aplikasi dan server (MAP-03).

## 5. Konvoi dan chat

### `convoys`

`id`, `leader_id`, `name`, `status` enum `lobby`,`active`,`paused`,`ended`,`cancelled`, `capacity` smallint, `route_id` null, `meeting_point geography(Point,4326)` null, `destination geography(Point,4326)` null, `scheduled_at` null, `started_at` null, `ended_at` null, `version` int default 1, `created_at`, `updated_at`.

`version` naik pada setiap perubahan status/rute untuk deteksi konflik dan indikator perubahan rute (PRD 5.3, 10.2).

### `convoy_members`

`convoy_id`, `user_id`, `role` enum `leader`,`co_leader`,`member`, `status` enum `invited`,`requested`,`active`,`left`,`removed`, `sharing_consent` bool default false, `joined_at`, `last_seen_at`, `pk(convoy_id, user_id)`.

Indeks unik parsial: satu user hanya punya satu keanggotaan `active`/`requested` pada satu waktu (BR-02), misalnya unique `(user_id) where status in ('active','requested')`.

### `convoy_invites`

`id`, `convoy_id`, `code_hash` bytea unique, `created_by`, `expires_at`, `max_uses` smallint, `used_count` smallint default 0, `revoked_at` null, `created_at`. Kode asli tidak disimpan (BR-04, D-016).

### `convoy_messages`

`id`, `convoy_id`, `sender_id`, `client_message_id` uuid, `type` enum `text`,`location`,`system`, `body` text null, `attachment_media_id` uuid null, `created_at`, `seq` bigint.

- Unique `(convoy_id, sender_id, client_message_id)` mencegah duplikasi saat retry (BR-13, COM-01).
- Indeks `(convoy_id, seq)` untuk pagination keyset.
- Pesan tidak dihapus fisik saat konvoi berakhir; retensi mengikuti kebijakan privasi dan dapat dihapus bersama konvoi.

### Redis (bukan tabel)

`convoy:{id}:pos:{userId}` TTL 300 s; `convoy:{id}:presence` TTL 120 s; `convoy:{id}:seq`; `ws:ticket:{jti}` TTL 60 s. Dihapus saat keluar/selesai (D-008, D-020).

## 6. Perjalanan

### `trips`

`id`, `user_id`, `vehicle_id` null, `route_id` null, `status` enum `active`,`paused`,`finished`, `started_at`, `ended_at` null, `paused_at` null, `paused_seconds` int default 0, `distance_m` int default 0, `duration_s` int default 0, `moving_seconds` int default 0, `avg_speed_kph` numeric(5,1) null, `max_speed_kph` numeric(5,1) null, `start_point geography(Point,4326)` null, `end_point geography(Point,4326)` null, `point_count` int default 0, `data_quality` jsonb null, `created_at`, `updated_at`.

- Unique parsial `(user_id) where status in ('active','paused')` menegakkan BR-01.
- `data_quality` menyimpan `{gaps, rejected_points, avg_accuracy}` agar UI dapat menampilkan kualitas data (TRP-03).

### `trip_points`

`trip_id`, `seq` int, `location geography(Point,4326)`, `accuracy_m` real, `speed_mps` real null, `heading_deg` real null, `recorded_at` timestamptz, `quality` enum `ok`,`low_accuracy`,`spike`,`gap`, pk `(trip_id, seq)`.

- Dipartisi bulanan berdasarkan `recorded_at`; partisi lama dihapus sesuai retensi (D-017).
- Titik mentah tidak dipakai untuk analitik lintas pengguna tanpa agregasi.

## 7. Bahaya jalan

### `hazard_reports`

`id`, `reporter_id`, `convoy_id` null, `type` enum `road_damage`,`accident`,`congestion`,`police`,`weather`,`obstacle`,`other`, `location geography(Point,4326)`, `note` text null, `media_id` uuid null, `status` enum `active`,`expired`,`removed`, `confidence` numeric(4,3) default 0.5, `created_at`, `expires_at`. Indeks GIST `location`, indeks `(status, expires_at)`.

### `hazard_confirmations`

`hazard_id`, `user_id`, `verdict` enum `still_there`,`not_relevant`, `created_at`, pk `(hazard_id, user_id)`. Satu pengguna satu suara; confidence dihitung server dari konfirmasi dan reputasi, bukan klik mentah (SAF-03).

## 8. Komunitas

- `communities(id, owner_id, name, slug citext unique, description, visibility enum public/private, avatar_media_id, cover_media_id, storage_quota_bytes bigint, rules text, created_at, deleted_at)`.
- `community_members(community_id, user_id, role enum owner/admin/moderator/member, status enum requested/active/left/banned, joined_at, pk)`.
- `community_channels(id, community_id, name, type enum text/voice, visibility enum members/moderators, created_at)`.
- `community_events(id, community_id, title, description, meeting_point geography(Point,4326), start_at, capacity int, status enum draft/published/cancelled/completed)`.
- `community_event_rsvps(event_id, user_id, status enum going/interested/cancelled, created_at, pk)`.
- `community_albums(id, community_id, owner_id, title, visibility, created_at)`; `album_media(album_id, media_id, position, pk)`.

Role komunitas ditegakkan lewat `community_members.role` dan dicek di service, bukan disimpulkan dari klien (PRD 3.2).

## 9. Media

### `media_assets`

`id`, `owner_id`, `storage_key` text unique, `mime_type`, `size_bytes` bigint, `checksum_sha256`, `width` int null, `height` int null, `duration_s` int null, `moderation_status` enum `pending`,`approved`,`rejected`, `visibility` enum `private`,`convoy`,`community`,`public`, `created_at`, `deleted_at`.

- Metadata diverifikasi setelah unggah; MIME asli diperiksa, bukan hanya `Content-Type` klien.
- Signed URL diterbitkan per permintaan dengan TTL pendek; penghapusan media menghapus objek dan metadata akses (PRD 5.10).

## 10. Feed dan interaksi

- `feed_posts(id, author_id, community_id null, type enum text/photo/video/recap, caption, audience enum public/followers/community/private, status enum published/hidden/removed, created_at, deleted_at)`.
- `post_media(post_id, media_id, position, pk)`.
- `post_comments(id, post_id, author_id, body, parent_id null, created_at, deleted_at)`; indeks `(post_id, created_at, id)`.
- `post_reactions(post_id, user_id, reaction_type, created_at, pk)`.
- `saved_posts(user_id, post_id, created_at, pk)`.

Interaksi unik per pengguna per posting agar retry tidak menghitung ganda (SOC-02).

## 11. Notifikasi

`notifications(id, user_id, type, payload jsonb, read_at null, created_at)`. `payload` hanya berisi ID dan teks aman; tidak ada koordinat presisi atau isi chat. Indeks `(user_id, created_at desc)` dan `(user_id) where read_at is null`.

## 12. Langganan dan entitlement

- `plans(code pk, name, price_amount bigint, currency, interval enum month/year, trial_days int, active bool, features jsonb, version int, updated_at)`. Harga dan fitur diubah server tanpa pembaruan aplikasi (PRD 5.12).
- `plan_entitlements(plan_code, key, value jsonb, pk)`.
- `subscriptions(id, user_id, plan_code, status enum active/grace/expired/cancelled/refunded, provider enum google_play, provider_subscription_ref, purchase_token_ref bytea, started_at, expires_at, auto_renew, updated_at)`.
- `billing_transactions(id, user_id, provider, provider_txn_id unique, product_id, amount, currency, status, raw_receipt_ref, verified_at)`.
- `entitlement_overrides(id, user_id, key, value jsonb, reason, expires_at null, created_by)`.

`purchase_token_ref` disimpan terenkripsi dan tidak pernah dikembalikan API. Status tidak pernah disimpulkan dari respons pembelian di perangkat (PRD 9.4, 11.4).

## 13. Reward

- `point_ledger(id, user_id, delta int, reason, reference_type, reference_id, created_at)` — append-only, tidak ada update/delete; saldo dihitung dari ledger atau tabel saldo turunan yang direkonsiliasi (RWD-01).
- `badges(code pk, title, description, criteria jsonb, active bool)`; `user_badges(user_id, badge_code, awarded_at, pk)`.
- `redeem_codes(id, code_hash bytea unique, reward_type, reward_value jsonb, quota int, redeemed_count int, expires_at, active bool)`.
- `redemptions(id, redeem_code_id, user_id, redeemed_at, unique(redeem_code_id, user_id))`.

Poin tidak diberikan atas kecepatan atau perilaku berbahaya (PRD 5.11).

## 14. Moderasi, audit, dan konfigurasi

- `reports(id, reporter_id, target_type enum user/post/comment/community/media/hazard, target_id uuid, reason, status enum open/reviewing/resolved/dismissed, moderator_id null, resolution_note null, created_at, resolved_at null)`.
- `moderation_actions(id, moderator_id, target_type, target_id, action enum warn/hide/remove/suspend/ban, reason, expires_at null, created_at)`.
- `admin_audit_logs(id, actor_id, action, target_type, target_id, before_json, after_json, reason, request_id, created_at)`. Hanya insert; tidak ada endpoint update/delete.
- `config_entries(key pk, value jsonb, version int, updated_by, updated_at)` untuk feature flag, minimum app version, kapasitas paket, kuota, dan ambang stale.

## 15. Outbox

`outbox_events(id, type, payload jsonb, occurred_at, processed_at null, attempts int default 0)`. Indeks `(processed_at) where processed_at is null`. Worker mengambil dengan `FOR UPDATE SKIP LOCKED`.

## 16. Relasi utama

```text
users 1─n vehicles
users 1─n trips 1─n trip_points
users 1─n user_consents / device_tokens / notifications
users 1─1 user_settings
convoys 1─n convoy_members n─1 users
convoys 1─n convoy_messages
convoys 1─n convoy_invites
routes 1─n route_waypoints
convoys n─1 routes
trips n─1 convoys (opsional)
communities 1─n community_members / channels / events / albums
feed_posts 1─n post_comments / post_reactions / post_media
media_assets 1─n post_media / album_media
subscriptions n─1 plans
```

## 17. Indeks geospasial dan pencarian

- `GIST` pada `routes.geometry`, `trip_points.location`, `hazard_reports.location`, `favorite_places.location`, `community_events.meeting_point`.
- Pencarian bahaya sekitar memakai `ST_DWithin(location, point, radius)` dengan radius maksimum yang dikonfigurasi; bukan `ST_Distance` pada seluruh tabel.
- Pencarian tempat dan rute tidak menyentuh database kecuali cache favorit; hasil provider disimpan sebagai referensi, bukan disalin massal.

## 18. Retensi dan penghapusan

| Data | Retensi awal | Catatan |
|---|---|---|
| Posisi live (Redis) | TTL 5 menit; dihapus saat keluar/selesai | Tidak pernah masuk PostgreSQL |
| Titik GPS mentah | 30 hari | Partisi bulanan (D-017) |
| Ringkasan trip | Sampai pengguna menghapus akun | Anonimisasi saat penghapusan |
| Pesan konvoi | Selama konvoi + 90 hari | Dapat dihapus bersama konvoi |
| Laporan bahaya | 30 hari setelah kedaluwarsa | Untuk audit moderasi |
| Audit admin | 2 tahun | Wajib untuk investigasi |
| Media | Sampai dihapus pemilik atau moderasi | Lifecycle storage mengikuti kuota |

Angka retensi adalah default engineering (D-017), bukan kepatuhan hukum. PRD 17 butir 5 dan 10 masih terbuka.

## 19. Aturan integritas yang diuji

| Aturan | Penegakan |
|---|---|
| BR-01 satu trip aktif per user | Unique partial index + transaksi start |
| BR-02 satu konvoi aktif per user | Unique partial index pada keanggotaan |
| BR-03 hanya leader/co-leader ubah rute | Otorisasi service + audit |
| BR-04 invite expiry/kuota/revoke | Kolom invite + validasi join |
| BR-05 lokasi hanya saat sesi aktif | Cek status konvoi + consent di gateway |
| BR-06 stale | `last_seen_at` + Redis TTL + event stale |
| BR-08 GPS anomali | Flag kualitas titik, bukan ban otomatis |
| BR-09 TTL laporan | `expires_at` + job |
| BR-10 entitlement server-side | Tabel entitlement + cek service |
| BR-13 media/pesan retry | Unique constraint + idempotency key |
| BR-15 pemulihan sesi | Status `recovered` + draft lokal |

## 20. Klasifikasi data per tabel

| Kategori | Tabel/kolom | Perlakuan |
|---|---|---|
| **Geospasial** | `routes.geometry`, `route_waypoints.location`, `trip_points.location`, `hazard_reports.location`, `favorite_places.location`, `convoys.meeting_point`, `convoys.destination`, `community_events.meeting_point` | PostGIS, indeks GIST, akses per resource; koordinat presisi tidak masuk analytics |
| **Sensitif** | `vehicles.plate_ciphertext`, `emergency_contacts.*_ciphertext`, `subscriptions.purchase_token_ref`, `user_consents`, `admin_audit_logs`, `reports` | Enkripsi kolom atau akses ketat, redaksi log, audit akses |
| **Ephemeral/live** | Redis `convoy:{id}:pos:*`, `presence`, `ws:ticket:*`, `rl:*`, `idem:*` | TTL, dihapus saat sesi berakhir; bukan sumber kebenaran historis |
| **Historis** | `trips`, `trip_points`, `convoy_messages`, `hazard_reports`, `point_ledger`, `admin_audit_logs`, `billing_transactions` | Retensi terjadwal, partisi untuk titik, append-only untuk ledger/audit |
| **Media** | `media_assets`, `post_media`, `album_media`, kolom `*_media_id` | Object storage + metadata; signed URL; moderasi; lifecycle storage |
| **Publik** | `communities` publik, `feed_posts` publik, `badges` | Tetap melalui moderasi dan kontrol visibilitas |
| **Internal** | `plans`, `plan_entitlements`, `config_entries`, `outbox_events` | Tidak diekspos mentah; hanya field yang diizinkan |

Data lokasi live adalah **ephemeral**: tidak boleh dipakai untuk laporan historis, analytics, atau rekomendasi tanpa consent dan dasar pemrosesan terpisah (PRD 11.5).

## 21. Implementasi Phase 2 (fakta)

Skema aktual berada di `backend/migrations/0002_convoys.sql`, bukan pecahan `0005` seperti rancangan awal. Tidak ada tabel posisi live atau pesan konvoi pada fase ini.

### `user_entitlements`

| Kolom | Tipe | Catatan |
|---|---|---|
| `user_id` | uuid PK → users | Satu baris per pengguna; bila tidak ada, default gratis dipakai service |
| `plan_code` | text | Default `free`; belum terhubung billing |
| `convoy_capacity` | smallint | 1–100; test beban memakai 30 |
| `updated_at` | timestamptz | |

### `convoys`

`id uuid PK`, `leader_id → users`, `name varchar(80)`, `meeting_point geography(Point,4326)`, `destination geography(Point,4326)`, `waypoints jsonb default '[]'`, `scheduled_at`, `capacity smallint (2–100)`, `status text` (`draft/lobby/active/paused/completed/cancelled`), `route_id → routes on delete set null`, `route_version int`, `version int`, `started_at`, `paused_at`, `completed_at`, `cancelled_at`, `created_at`, `updated_at`.

Tidak ada kolom terpisah untuk tujuan/waypoint PostGIS seperti rancangan; waypoint disimpan sebagai JSON tervalidasi. `completed` menggantikan `ended` dan merupakan status terminal. `version` naik pada perubahan status/anggota/rute dan dipakai untuk `If-Match`.

### `convoy_members`

PK `(convoy_id, user_id)`; `role` (`leader/co_leader/member`), `status` (`active/requested/left/removed`), `sharing_consent bool default false`, `invited_by`, `joined_at`, `last_seen_at`, `created_at`, `updated_at`.

Unique partial index `convoy_one_open_membership` pada `user_id WHERE status IN ('active','requested')` menegakkan BR-02. Tidak ada status `invited`; undangan diwakili baris `convoy_invites`.

### `convoy_invites`

`id`, `convoy_id`, `created_by`, `code_hash text unique`, `expires_at`, `max_uses smallint`, `used_count smallint`, `revoked_at`, `revoked_by`, `created_at`.

Kode asli tidak disimpan. Hash HMAC-SHA256 dengan `INVITE_HMAC_PEPPER`; panjang kode 10 karakter Crockford Base32 (D-030).

### `convoy_audit_logs`

`id`, `convoy_id`, `actor_id`, `action text`, `target_user_id`, `metadata jsonb`, `request_id`, `created_at`. Aksi mencakup create, join, approve/reject, role change, remove, leave, transfer, handoff, route update, invite create/revoke, dan status transition. Hanya insert; tidak ada endpoint aplikasi untuk mengubah/menghapus.

### Redis aktual

| Key | Tipe | TTL | Isi |
|---|---|---|---|
| `convoy:{id}:pos:{userId}` | string JSON | 300 s (konfigurasi) | posisi terakhir + `lastSeenAt`, `clientSeq` |
| `convoy:{id}:presence` | hash | 300 s | userId → presence JSON |
| `convoy:{id}:events` | list | 24 jam | maksimum 2000 event untuk replay |
| `ws:ticket:{sha256}` | string JSON | 60 s | tiket sekali pakai |

`convoy:{id}:seq` dan key rate limit juga memakai Redis saat tersedia. Tidak ada Redis Stream pada implementasi ini. Tanpa `REDIS_URL` di development/test, adapter memori dipakai; `NODE_ENV=production` menolak start tanpa `REDIS_URL`.

### Yang belum ada

`convoy_messages`, hazard, media konvoi, dan tabel billing belum dibuat. Klaim fitur tersebut tidak boleh merujuk ke skema ini.
