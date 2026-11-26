# API CONTRACT — RiderJourney v1

Kontrak REST tingkat implementasi untuk Fase 1–2, memperluas tabel endpoint PRD 10.1. Ini rancangan baru, bukan endpoint aplikasi referensi. Perubahan yang merusak kompatibilitas menaikkan versi ke `/v2`; perubahan aditif dicatat di dokumen ini.

> **Status implementasi (24 November 2026):** **`docs/openapi.json`** dihasilkan dari DTO NestJS dan memuat **151 path**. Implementasi mencakup auth, profil, kendaraan, places/routes, trip, konvoi/realtime, chat/hazard/media, voice backend, sosial/feed/album/replay/poster, komunitas, billing/redeem, admin, dan privacy. UI voice dan website komunitas belum ada. Bila dokumen ini berbeda dengan OpenAPI, OpenAPI menang untuk endpoint yang sudah ada.

## 1. Konvensi

| Aspek | Ketentuan |
|---|---|
| Base path | `/v1` |
| Format | JSON UTF-8, `application/json` |
| Autentikasi | `Authorization: Bearer <token OIDC/Firebase>`; backend memverifikasi tanda tangan, issuer, audience, `exp` |
| Identitas | Diambil dari `sub` token; tidak ada `userId` klien untuk otorisasi |
| Waktu | ISO 8601 UTC (`2026-11-24T10:15:30Z`) |
| ID | UUID string |
| Panjang halaman | `limit` default 20, maksimum 100 |
| Cursor | Opaque; jangan diurai klien |
| Idempotensi | `Idempotency-Key: <uuid>` wajib pada mutasi bertanda ✓ |
| Konkurensi | `If-Match: <version>` pada perubahan konvoi/rute |
| Bahasa error | `detail` Bahasa Indonesia; `code` stabil untuk klien |
| Request ID | `X-Request-Id` diterima atau dibuat server; dikembalikan di header dan body error |
| Rate limit | Header `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; 429 `RATE_LIMITED` |

### 1.1 Amplop daftar

```json
{ "items": [ /* ... */ ], "nextCursor": "eyJjcmVhdGVkQXQiOi..." }
```

`nextCursor` bernilai `null` pada halaman terakhir.

### 1.2 Format error (RFC 9457)

```json
{
  "type": "https://errors.riderjourney.example/validation",
  "title": "Permintaan tidak valid",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "Satu atau lebih field tidak valid.",
  "requestId": "01JC...",
  "errors": [ { "field": "username", "code": "TAKEN", "message": "Username sudah dipakai." } ]
}
```

Domain `errors.riderjourney.example` adalah placeholder; diganti bersama domain final (D-003).

### 1.3 Kode error

| HTTP | `code` | Arti |
|---|---|---|
| 400 | `BAD_REQUEST` | Body/parameter tidak terbaca |
| 401 | `UNAUTHENTICATED` | Token tidak ada, kedaluwarsa, atau gagal verifikasi |
| 403 | `FORBIDDEN` | Terautentikasi tetapi tidak berhak |
| 404 | `NOT_FOUND` | Resource tidak ada atau tidak terlihat oleh pemanggil |
| 409 | `CONFLICT` | Melanggar aturan bisnis (mis. sudah punya sesi aktif) |
| 409 | `VERSION_MISMATCH` | `If-Match` tidak cocok |
| 410 | `GONE` | Undangan/tiket kedaluwarsa |
| 413 | `PAYLOAD_TOO_LARGE` | Melebihi batas unggah |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME tidak diizinkan |
| 422 | `VALIDATION_FAILED` | Field tidak valid |
| 429 | `RATE_LIMITED` | Melebihi kuota |
| 503 | `PROVIDER_UNAVAILABLE` | Provider eksternal gagal; `retryAfterSeconds` disertakan |
| 503 | `DEPENDENCY_UNAVAILABLE` | Database/Redis tidak siap |

### 1.4 Aturan validasi umum

| Field | Aturan |
|---|---|
| `username` | 3–24 karakter, `[a-z0-9._]`, huruf kecil, tidak diawali/diakhiri titik; unik; filter profaniti |
| `displayName` | 1–60 karakter |
| `bio` | ≤ 300 karakter |
| `note` bahaya | ≤ 500 karakter |
| `body` pesan | ≤ 2000 karakter |
| Waypoint | maksimum 7 (MAP-03) |
| Titik trip per batch | maksimum 500 |
| Koordinat | latitude −90…90, longitude −180…180; tolak (0,0) |
| `accuracyM` | 0…10000; di atas ambang kualitas ditandai, bukan dibuang otomatis |
| `recordedAt` | tidak lebih dari 5 menit di masa depan; data lebih tua dari 24 jam ditolak untuk live |

## 2. Bootstrap dan konfigurasi

### `GET /v1/config/bootstrap`

Publik (tanpa token). Mengembalikan konfigurasi minimum yang aman untuk klien.

```json
{
  "minAppVersion": 1,
  "latestAppVersion": 1,
  "features": { "convoy": true, "voice": false, "feed": false, "billing": false },
  "limits": { "waypoints": 7, "convoyCapacityDefault": 3, "tripPointBatch": 500 },
  "thresholds": { "staleAfterSeconds": 30, "hazardTtlSeconds": 7200 },
  "map": { "styleUrl": "https://...", "attribution": "..." },
  "serverTime": "2026-11-24T10:15:30Z"
}
```

Nilai `styleUrl` berasal dari konfigurasi server, bukan kunci provider di perangkat. Penentuan provider final masih terbuka (O-02).

## 3. Identitas dan profil

### `POST /v1/auth/session` ✓

Membuat atau memulihkan baris `users` untuk `sub` token. Idempoten secara alami.

Request (opsional): `{ "deviceName": "Pixel 8", "appVersion": 12 }`
Response 200: `{ "user": User, "isNew": false, "requiredConsents": ["terms", "privacy"] }`

`User` ringkas: `id, username, displayName, avatarUrl, bio, city, visibility, status`.

### `GET /v1/me`

Response 200: `User` + `settings` + `activeTripId` + `activeConvoyId` (untuk pemulihan sesi).

### `PATCH /v1/me`

Request: subset `{ displayName, bio, city, visibility, avatarMediaId }`. Response 200: `User`.

### `GET /v1/me/settings` · `PATCH /v1/me/settings`

Field: `locationSharingDefault`, `tripHistoryVisibility`, `notificationPreferences` (objek per kategori), `audioPreferences`, `mapPreferences`.

### `POST /v1/me/consents` ✓

Request: `{ "kind": "terms|privacy|location_disclosure|microphone_disclosure", "version": "2026-11", "context": "onboarding" }`. Response 201: consent. Consent lama tidak dihapus; versi baru menambah baris.

### `GET /v1/me/export`

Response 202: `{ "exportId": "...", "status": "queued" }`.

`GET /v1/me/export/{id}` mengembalikan `{ status, downloadUrl?, expiresAt? }`; `downloadUrl` hanya diberikan kepada pemilik dan berumur pendek. Ekspor tidak memuat posisi live atau token.

### `DELETE /v1/me` ✓

Request: `{ "confirmation": "HAPUS AKUN", "reason": "opsional" }`. Response 202: `{ "deletionRequestId": "...", "effectiveAt": "..." }`. Autentikasi dinonaktifkan segera setelah permintaan; data dihapus/dianonimkan setelah masa tenggang (D-019).

## 4. Kendaraan

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/vehicles` | Daftar kendaraan milik pemanggil |
| POST | `/v1/vehicles` ✓ | `{type, brand, model, year?, engineCc?, nickname?, photoMediaId?, plate?}` |
| GET | `/v1/vehicles/{id}` | Pemilik atau admin |
| PATCH | `/v1/vehicles/{id}` | Field sama, semua opsional |
| DELETE | `/v1/vehicles/{id}` | Soft delete; kendaraan utama dilepas |
| POST | `/v1/vehicles/{id}/primary` | Menetapkan kendaraan utama |

Response kendaraan **tidak** memuat plat kecuali `includePlate=true` untuk pemilik; plat tidak pernah muncul di feed/peta (VEH-03). Batas jumlah kendaraan dicek terhadap entitlement.

## 5. Media

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/media/uploads` ✓ | `{purpose, contentType, sizeBytes, clientMediaId, checksumSha256?}` → `{id, status, uploadUrl, method, requiredHeaders, expiresIn}`. `clientMediaId` membuat retry memakai baris dan key yang sama |
| POST | `/v1/media/uploads/{id}/complete` ✓ | Multipart `sizeBytes`, `originalName?`, dan potongan awal file. Server memeriksa magic bytes dan ukuran yang dikirim klien; verifikasi object storage belum end-to-end |
| GET | `/v1/media/{id}/url` | Signed GET berumur pendek; cek kepemilikan/visibilitas |
| GET | `/v1/media/{id}/access` | URL bertanda tangan; saat ini mengembalikan metadata, bukan byte atau redirect ke storage |
| DELETE | `/v1/media/{id}` | Belum diimplementasikan di controller; penghapusan objek storage belum end-to-end |

MIME diizinkan: `image/jpeg`, `image/png`, `image/webp`, `video/mp4` (Fase 3 untuk video). Kuota awal D-018.

## 6. Tempat dan rute

### `GET /v1/places/search?q=&near=lat,lng&limit=`

Response: `{ items: [{ providerRef, name, category, distanceM, location: {lat,lng} }] }`. Hasil kosong mengembalikan `items: []`, bukan error.

### `GET /v1/places/nearby?lat=&lng=&radiusM=&category=`

Radius maksimum 5000 m; `category` opsional.

### Favorit

`GET /v1/favorites`, `POST /v1/favorites` ✓ `{placeName, category, lat, lng, provider, providerRef}`, `DELETE /v1/favorites/{id}`.

### `POST /v1/routes/preview` ✓

```json
{
  "start": { "lat": -6.2, "lng": 106.8 },
  "destination": { "lat": -6.9, "lng": 107.6 },
  "waypoints": [ { "lat": -6.5, "lng": 107.1, "label": "Rest area" } ],
  "alternatives": true,
  "profile": "motorcycle"
}
```

Response 200:

```json
{
  "routes": [
    {
      "id": "uuid",
      "distanceM": 148000,
      "durationS": 10800,
      "geometry": "encoded_polyline_or_geojson",
      "provider": "provider_code",
      "waypointOrder": [0],
      "disclaimer": "Data akses jalan dapat tidak lengkap; patuhi rambu dan kondisi lapangan."
    }
  ],
  "providerStatus": "ok"
}
```

Kegagalan provider: 503 `PROVIDER_UNAVAILABLE`, tanpa ETA palsu. `disclaimer` wajib ada (PRD 5.3).

### `GET /v1/routes/{id}` ✓

Membaca rute tersimpan untuk pemiliknya atau anggota aktif konvoi yang memakai rute tersebut. Respons memuat `id, ownerId, name, distanceM, durationS, provider, waypoints, geometry` dengan `geometry.type = "LineString"` dan `coordinates` berurutan `[lng, lat]`. Anggota yang tidak berhak mendapat 404 `ROUTE_NOT_FOUND`.

### `POST /v1/routes/{id}/recalculate` ✓

Memakai origin, destination, dan waypoint tersimpan; memanggil ulang provider dan menghasilkan route baru dengan `id` baru tanpa mengubah route lama (konvoi tetap memegang versi lama). Hanya pemilik atau leader konvoi aktif; pengguna lain mendapat 404 `ROUTE_NOT_FOUND`. Bila provider gagal atau tidak menemukan rute, respons 503 `PROVIDER_UNAVAILABLE` — tidak ada rute atau ETA buatan. Respons: `{id, distanceM, durationS, geometry, provider, disclaimer}`.

## 7. Perjalanan

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/trips` ✓ | `{convoyId?, vehicleId?}`; menolak bila sudah ada sesi aktif (BR-01) → 409 `ACTIVE_TRIP_EXISTS` |
| GET | `/v1/trips?status=&limit=&cursor=` | Riwayat milik pemanggil |
| GET | `/v1/trips/{id}` | Pemilik; ringkasan + kualitas data |
| POST | `/v1/trips/{id}/pause` ✓ | `active → paused` |
| POST | `/v1/trips/{id}/resume` ✓ | `paused → active` |
| POST | `/v1/trips/{id}/finish` ✓ | `{distanceM?, durationS?, endedAt?}`; server menghitung ulang dari titik |
| POST | `/v1/trips/{id}/points` ✓ | Batch titik; idempoten per `(tripId, seq)` |
| GET | `/v1/trips/{id}/points?cursor=&limit=` | Urut `seq` |

Contoh batch titik:

```json
{
  "points": [
    { "seq": 1201, "lat": -6.2, "lng": 106.8, "accuracyM": 8.4,
      "speedMps": 13.2, "headingDeg": 91.0, "recordedAt": "2026-11-24T10:15:30Z",
      "quality": "ok" }
  ]
}
```

Response: `{ "accepted": 1, "duplicates": 0, "rejected": [] }`. Titik dengan `seq` yang sudah ada dianggap duplikat, bukan error.

Ringkasan trip (`GET /v1/trips`, `/active`, `/{id}`, dan respons start/pause/resume/finish) memuat `distanceM`, `durationS`, `movingS`, `avgSpeedKph`, `maxSpeedKph`, `startLocation {lat,lng}`, `endLocation {lat,lng}`, `pointCount`, dan `dataQuality`. `movingS` hanya menjumlahkan jarak waktu antar titik `ok` yang berdekatan (≤60 detik); `maxSpeedKph` berasal dari `speedMps` titik `ok`; `startLocation`/`endLocation` adalah titik `ok` pertama dan terakhir. Semua nilai `null` bila belum ada data yang layak — tidak ada angka pengganti.

Transisi tidak valid → 409 `INVALID_TRIP_STATE`. Sesi `recovered` dibuat saat klien melaporkan sesi lokal yang belum ditutup.

## 8. Konvoi (diimplementasikan Fase 2)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/convoys` | Konvoi yang pernah diikuti pemanggil, terbaru lebih dulu |
| GET | `/v1/convoys/active` | Konvoi `lobby/active/paused` pemanggil atau `null` |
| POST | `/v1/convoys` ✓ | `{name, meetingPoint, destination, waypoints?, scheduledAt?, capacity?}`; leader otomatis, status `lobby` |
| GET | `/v1/convoys/{id}` | Detail untuk anggota; memuat `myStatus`, `myRole`, `version` |
| GET | `/v1/convoys/{id}/members` | Anggota + permintaan join; `displayName`, `role`, `status`, `sharingConsent` |
| POST | `/v1/convoys/join` ✓ | `{code}`; menghasilkan membership `requested`, bukan langsung aktif |
| POST | `/v1/convoys/{id}/members/{userId}/approve` | Leader/co-leader; `active`; `If-Match` opsional |
| POST | `/v1/convoys/{id}/members/{userId}/reject` | Leader/co-leader; `{reason?}`; `requested → left` |
| DELETE | `/v1/convoys/{id}/members/{userId}` | Leader/co-leader mengeluarkan anggota; tidak dapat mengeluarkan leader |
| PATCH | `/v1/convoys/{id}/members/{userId}` | `{role: "co_leader"|"member"}`; hanya leader |
| POST | `/v1/convoys/{id}/transfer` | `{userId}`; leader memindahkan kepemimpinan |
| POST | `/v1/convoys/{id}/leave` ✓ | `requested` dapat membatalkan; `active` keluar; leader yang keluar otomatis mempromosikan co-leader/anggota aktif terlama, atau membatalkan konvoi bila sendirian |
| PATCH | `/v1/convoys/{id}/sharing` | `{sharingConsent}`; consent per anggota |
| POST | `/v1/convoys/{id}/invites` ✓ | `{expiresInSeconds?, maxUses?}` → kode mentah **satu kali**, `code`/`link` |
| GET | `/v1/convoys/{id}/invites` | Metadata invite; hash dan kode mentah tidak dikembalikan |
| DELETE | `/v1/convoys/{id}/invites/{inviteId}` | Revoke; idempoten untuk invite yang sudah dicabut |
| PATCH | `/v1/convoys/{id}/route` | `{routeId}`; hanya leader/co-leader; `version` dan `routeVersion` naik |
| POST | `/v1/convoys/{id}/publish` | `draft → lobby` |
| POST | `/v1/convoys/{id}/start` | `lobby → active`; cek kapasitas aktif |
| POST | `/v1/convoys/{id}/pause` | `active → paused` |
| POST | `/v1/convoys/{id}/resume` | `paused → active` |
| POST | `/v1/convoys/{id}/complete` | `active/paused → completed`; posisi live dihapus |
| POST | `/v1/convoys/{id}/end` | Alias `complete` yang dipertahankan |
| POST | `/v1/convoys/{id}/cancel` | `draft/lobby/active/paused → cancelled`; posisi live dihapus |
| GET | `/v1/convoys/{id}/positions` | Snapshot posisi anggota yang consent; `stale`, `ageSeconds` |

Status: `draft → lobby → active ⇄ paused → completed`, dan `cancelled` dari status nonterminal. `completed`/`cancelled` terminal.

Aturan implementasi:

- Kode 10 karakter Crockford Base32; hanya HMAC-SHA256 dengan `INVITE_HMAC_PEPPER` yang disimpan. Default kedaluwarsa 24 jam, `maxUses` default 20.
- Join selalu `requested`. Kapasitas efektif = pemilik ditambah anggota `active` ditambah permintaan `requested`; nilai default 3, maksimum 30. Satu pengguna hanya boleh punya satu membership `active/requested`.
- Kapasitas dan entitlement dibaca di server dari `user_entitlements`; `capacity` klien di-clamp ke `[2, max]` dan ditolak bila di atas maksimum. Tidak ada paket berbayar pada fase ini.
- `POST /leave` untuk `requested` mengubah status menjadi `left`; untuk `active` menghapus posisi/presence dan mencabut room. Bila leader keluar dan masih ada anggota aktif, server mempromosikan co-leader/anggota terlama, memperbarui `convoys.leader_id`, dan menyiarkan perubahan peran; bila tidak ada anggota aktif, konvoi menjadi `cancelled`.
- Perubahan anggota, peran, rute, status, invite, dan handoff dicatat di `convoy_audit_logs`.
- `If-Match` divalidasi bila dikirim; konflik menghasilkan 409 `VERSION_MISMATCH`.
- `GET /positions` mengembalikan `lastSeenAt`, `stale`, dan `ageSeconds`; posisi anggota tanpa consent tidak pernah dikembalikan (CNV-04, BR-06).
- Bila semua socket leader terputus, server segera memindahkan kepemimpinan ke co-leader/anggota aktif terlama dan menyiarkan `convoy.member.updated`; perilaku ini spesifik Phase 2 (D-032).

## 9. Chat

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/convoys/{id}/messages?limit=&before=` | Halaman riwayat, urut `seq` menurun |
| POST | `/v1/convoys/{id}/messages` ✓ | Fallback REST saat WebSocket tidak tersedia |
| POST | `/v1/convoys/{id}/messages/{messageId}/read` | Menandai dibaca (opsional Fase 1) |

Request kirim: `{ "clientMessageId": "uuid", "type": "text|location", "body": "...", "attachmentMediaId": null }`. Pengirim diambil dari token. Retry dengan `clientMessageId` sama mengembalikan pesan yang sudah ada (200), bukan 201.

## 10. Bahaya

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/hazards` ✓ | `{type, lat, lng, note?, mediaId?}`; TTL dari konfigurasi |
| GET | `/v1/hazards/nearby?lat=&lng=&radiusM=` | Hanya `active` dan belum kedaluwarsa |
| GET | `/v1/hazards/{id}` | Detail + konfirmasi |
| POST | `/v1/hazards/{id}/confirm` ✓ | `{verdict: "still_there\|not_relevant"}`; satu suara per pengguna |

Rate limit pembuatan laporan 5 per 10 menit per pengguna. Laporan duplikat berdekatan dapat ditandai `duplicateOf` oleh server, bukan ditolak diam-diam.

## 11. Langganan

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/subscription` | Status, paket, entitlement efektif, `expiresAt` |
| POST | `/v1/billing/verify` ✓ | `{productId, purchaseToken}`; verifikasi server ke Google Play |
| POST | `/v1/billing/restore` ✓ | Memulihkan pembelian untuk akun |

`purchaseToken` tidak pernah dikembalikan API atau ditulis ke log.

## 12. Realtime

`POST /v1/realtime/ticket` ✓ — `{ "convoyId": "uuid" }` → `{ "ticket": "...", "expiresIn": 60, "convoyId": "...", "protocol": "v1", "wsPath": "/v1/realtime", "capabilities": {"subscribe": true, "publishLocation": true} }`.

Server memeriksa keanggotaan aktif dan status konvoi sebelum menerbitkan tiket. Detail protokol ada di `REALTIME_EVENTS.md`.

## 13. Admin (Fase 1 minimum)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/v1/admin/metrics/summary` | Ringkasan jumlah pengguna, trip, konvoi, laporan |
| GET | `/v1/admin/users?query=&status=&cursor=` | Pencarian akun |
| POST | `/v1/admin/users/{id}/suspend` | `{reason, expiresAt?}`; audit wajib |
| POST | `/v1/admin/users/{id}/reinstate` | Audit wajib |
| GET | `/v1/admin/hazards?status=&cursor=` | Antrean moderasi |
| POST | `/v1/admin/hazards/{id}/resolve` | `{action: "keep\|remove", reason}` |
| GET | `/v1/admin/config` · `PATCH /v1/admin/config/{key}` | Feature flag, versi minimum, ambang |
| GET | `/v1/admin/audit-logs?actorId=&targetType=&cursor=` | Baca audit |

Semua endpoint admin memerlukan role `platform_moderator` atau `super_admin`; akses sensitif dicatat (PRD 5.14).

## 14. Kesehatan

`GET /health/live` → 200 `{ "status": "ok" }` bila proses hidup.
`GET /health/ready` → 200 bila PostgreSQL dan Redis terhubung; 503 dengan `code` bila tidak. Tanpa data sensitif.

## 15. Matriks otorisasi (ringkas)

| Resource | Pemilik | Anggota konvoi | Leader/co-leader | Moderator | Super admin |
|---|---|---|---|---|---|
| Profil sendiri | Baca/tulis | — | — | Baca terbatas | Baca terbatas |
| Profil publik | Sesuai `visibility` | Sesuai `visibility` | Sesuai `visibility` | Sesuai `visibility` | Sesuai `visibility` |
| Kendaraan | CRUD | — | — | — | Baca untuk investigasi |
| Trip | CRUD | Baca ringkasan bila dibagikan | — | — | Baca untuk investigasi |
| Konvoi | Baca | Baca | Kelola | — | Baca |
| Posisi live | Milik sendiri | Anggota aktif berhak | Anggota aktif berhak | — | Tidak ada akses rutin |
| Pesan konvoi | Kirim | Baca/kirim | Baca/kirim | Baca bila dilaporkan | Baca bila dilaporkan |
| Laporan bahaya | Buat | Baca area | Baca area | Tindak | Tindak |
| Konfigurasi | — | — | — | Baca | Tulis |
| Audit log | — | — | — | Baca | Baca |

Akses moderator ke pesan dan trip hanya melalui alur laporan yang tercatat, bukan penelusuran bebas.

## 16. Rate limit awal

| Aksi | Batas |
|---|---|
| `POST /v1/auth/session` | 10/menit/IP |
| Join konvoi | 5/menit/pengguna |
| Kirim pesan | 30/menit/pengguna |
| Buat laporan bahaya | 5/10 menit/pengguna |
| Preview rute | 30/menit/pengguna |
| Upload intent | 20/jam/pengguna |
| Endpoint baca umum | 120/menit/pengguna |

Angka ini default implementasi, dapat diubah lewat konfigurasi; bukan komitmen SLA.

## 17. Komunitas

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/communities` | `{slug, name, description?, region?, visibility?}`; owner otomatis aktif dan default permission per peran di-seed |
| GET | `/v1/communities/{id}` | Detail publik + status/role membership pemanggil |
| POST | `/v1/communities/{id}/join` | Publik langsung `active`; privat menjadi `requested`; retry idempoten |
| GET | `/v1/communities/{id}/members` | Anggota aktif; khusus anggota aktif |
| GET | `/v1/communities/{id}/join-requests` | Antrean `requested`; butuh `member.approve` |
| POST | `/v1/communities/{id}/join-requests/{userId}/approve` | Menyetujui permintaan; butuh `member.approve` |
| POST | `/v1/communities/{id}/join-requests/{userId}/decline` | Menolak permintaan; status menjadi `left` dan dapat meminta ulang |
| PATCH | `/v1/communities/{id}/members/{userId}/role` | `{role: admin\|moderator\|member}`; butuh `member.set_role`; owner tidak dapat diubah |

Default permission: `member` mendapat `post.create` dan `album.create`; `moderator` mendapat keduanya plus moderasi konten, approve/remove anggota, dan event; `admin` mendapat seluruh permission komunitas. Owner selalu memiliki semua permission. Setiap create, join/request, approve/decline, dan perubahan role ditulis ke `community_audit_logs`. Endpoint album komunitas tetap `GET /v1/communities/{communityId}/albums` dan `POST /v1/albums` dengan `visibility=community`.

## 18. Yang belum ada di kontrak ini

Voice, poin, leaderboard, redeem, website komunitas, dan endpoint komunitas lain di luar alur minimal di atas belum ada di kontrak ini.

## 19. Perubahan kontrak Phase 6

Tidak ada endpoint baru. Yang berubah adalah perilaku dan error yang harus ditangani klien:

| Endpoint | Perubahan |
|---|---|
| `POST /v1/auth/login` | Setelah 10 kegagalan untuk email yang sama dalam 15 menit, respons menjadi `429` dengan `code: LOGIN_LOCKED` dan `retryAfterSeconds`. Kata sandi yang benar pun ditolak sampai kunci berakhir. Kunci dihitung per akun, bukan per IP |
| `POST /v1/auth/password/reset/confirm` | Token dikonsumsi secara atomik; pemakaian kedua mengembalikan `401 INVALID_RESET_TOKEN`. Semua refresh token akun dicabut saat berhasil |
| `POST /v1/auth/email/verify` | Token verifikasi juga dikonsumsi secara atomik |
| `GET/POST /v1/convoys/{id}/messages`, `POST /v1/convoys/{id}/messages/{messageId}/report` | `id` dan `messageId` wajib UUID; selain itu `400 INVALID_ID` |
| `POST /v1/hazards/{id}/confirm`, `POST /v1/hazards/{id}/report` | `id` wajib UUID; `400 INVALID_ID`. UUID yang tidak ada tetap `404 HAZARD_NOT_FOUND` |
| `GET /v1/media/{id}/access`, `POST /v1/media/uploads/{id}/complete`, `GET /v1/media/{id}/url` | `id` wajib UUID; `400 INVALID_ID` |

Kontrak lain, termasuk bentuk sukses, tidak berubah. `docs/openapi.json` hanya memuat path dan skema, sehingga kode error di atas tetap perlu ditangani klien secara eksplisit.
