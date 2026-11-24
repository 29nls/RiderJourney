# API CONTRACT — RiderJourney v1

Kontrak REST tingkat implementasi untuk Fase 1, memperluas tabel endpoint PRD 10.1. Ini rancangan baru, bukan endpoint aplikasi referensi. Perubahan yang merusak kompatibilitas menaikkan versi ke `/v2`; perubahan aditif dicatat di dokumen ini.

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

Response 202: `{ "exportId": "...", "status": "queued" }`; status di `GET /v1/me/export/{id}`. Ekspor tidak memuat posisi live atau token.

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
| POST | `/v1/media/upload-intents` ✓ | `{purpose, mimeType, sizeBytes, checksumSha256, visibility}` → `{mediaId, uploadUrl, expiresAt}` |
| POST | `/v1/media/{id}/complete` ✓ | Verifikasi metadata, MIME sniffing, antre moderasi |
| GET | `/v1/media/{id}/url` | Signed GET berumur pendek; cek kepemilikan/visibilitas |
| DELETE | `/v1/media/{id}` | Hapus objek dan metadata akses |

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

### `POST /v1/routes/{id}/recalculate`

Memakai waypoint tersimpan; menghasilkan route baru dengan `id` baru. Hanya pemilik atau leader konvoi.

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

Transisi tidak valid → 409 `INVALID_TRIP_STATE`. Sesi `recovered` dibuat saat klien melaporkan sesi lokal yang belum ditutup.

## 8. Konvoi

| Method | Path | Keterangan |
|---|---|---|
| POST | `/v1/convoys` ✓ | `{name, meetingPoint, destination, waypoints?, scheduledAt?, capacity?, routeId?}` |
| POST | `/v1/convoys/join` ✓ | `{code}`; validasi kapasitas, status, expiry, blokir |
| GET | `/v1/convoys/{id}` | Anggota aktif; memuat `version`, `status`, `role` |
| GET | `/v1/convoys/{id}/members` | Anggota aktif; pagination |
| PATCH | `/v1/convoys/{id}/members/{userId}` | Leader: `{role?, status?}`; audit |
| POST | `/v1/convoys/{id}/leave` ✓ | Menghapus posisi live dan akses room |
| POST | `/v1/convoys/{id}/start` ✓ | `lobby → active`; `If-Match` |
| POST | `/v1/convoys/{id}/pause` ✓ | Leader/co-leader |
| POST | `/v1/convoys/{id}/resume` ✓ | Leader/co-leader |
| POST | `/v1/convoys/{id}/end` ✓ | `active/paused → ended`; lokasi live dihentikan |
| PATCH | `/v1/convoys/{id}/route` ✓ | `{routeId}`; hanya leader/co-leader; menaikkan `version` |
| POST | `/v1/convoys/{id}/invites` ✓ | `{expiresInSeconds?, maxUses?}` → kode mentah **satu kali** |
| DELETE | `/v1/convoys/{id}/invites/{inviteId}` | Revoke |
| GET | `/v1/convoys/{id}/positions` | Snapshot posisi terakhir untuk anggota aktif |

Aturan:

- Kapasitas dicek ulang saat join dan saat start; nilai berasal dari entitlement server (CNV-08, BR-10).
- Anggota yang tidak memberi `sharingConsent` tetap melihat peta sesuai kebijakan, tetapi statusnya `not_sharing`.
- `GET /positions` mengembalikan `lastSeenAt` dan `stale: true|false`; bukan posisi lama tanpa label (CNV-04, BR-06).

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

`POST /v1/realtime/ticket` ✓ — `{ "convoyId": "uuid" }` → `{ "ticket": "...", "expiresInSeconds": 60 }`.

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

## 17. Yang belum ada di kontrak ini

Endpoint komunitas, feed, voice, poin, leaderboard, redeem, dan website komunitas menyusul pada fase 2–4 sesuai PRD 15. Endpoint tersebut tidak dibuat sekarang agar tidak ada kontrak yang tidak diimplementasikan.
