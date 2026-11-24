# REALTIME_EVENTS — RiderJourney

Kontrak WebSocket untuk event konvoi dan notifikasi dalam aplikasi. Memperluas PRD 10.2. Semua event memerlukan autentikasi, validasi keanggotaan, urutan, dan strategi reconnect.

## 1. Transport

- Endpoint: `wss://<host>/v1/realtime`
- Tiket: `POST /v1/realtime/ticket` dengan body `{ "convoyId": "uuid" }`
- Tiket dikirim sebagai query `?ticket=<opaque>` **hanya** pada handshake; tidak ada token akses jangka panjang di URL.
- Tiket berumur 60 detik, sekali pakai, terikat pada `userId`, `convoyId`, dan kemampuan (`subscribe`, `publish_location`, `publish_message`) yang ditentukan server (D-020).
- Server menolak handshake dengan `401` bila tiket tidak valid, kedaluwarsa, sudah dipakai, atau keanggotaan tidak aktif.

## 2. Amplop

```json
{
  "v": 1,
  "id": "01JC...",
  "type": "convoy.location.updated",
  "room": "convoy:8f14...",
  "seq": 412,
  "ts": "2026-11-24T10:15:30Z",
  "data": { }
}
```

| Field | Aturan |
|---|---|
| `v` | Versi protokol; saat ini `1` |
| `id` | ID event unik (UUIDv7) |
| `type` | Nama event pada katalog |
| `room` | `convoy:{id}` atau `user:{id}` |
| `seq` | Counter monoton per room dari server; tidak dikirim klien |
| `ts` | Waktu server |
| `data` | Payload sesuai tipe |

Pesan klien → server memakai amplop yang sama tanpa `seq`; `id` klien berfungsi sebagai kunci deduplikasi untuk chat.

## 3. Room dan otorisasi

| Room | Siapa yang boleh bergabung | Isi |
|---|---|---|
| `convoy:{id}` | Anggota `active` pada konvoi `lobby/active/paused` | Status, anggota, posisi, chat, rute |
| `user:{id}` | Pemilik koneksi | Notifikasi dalam aplikasi |

Server menentukan room dari tiket, **bukan** dari field `room` yang dikirim klien. Klien tidak dapat berlangganan room konvoi lain tanpa tiket baru.

Saat konvoi berakhir, anggota keluar, atau dikeluarkan: server mengirim `convoy.member.left`, mencabut langganan, menghapus key posisi, dan menutup koneksi terkait dengan kode `4003`.

## 4. Katalog event

| Event | Arah | Payload minimum | Persistensi |
|---|---|---|---|
| `convoy.snapshot` | S → C | `convoyId, status, version, role, members[], positions[], routeVersion, lastSeq` | Tidak (dibangun saat join) |
| `convoy.member.joined` | S → room | `convoyId, userId, role, joinedAt` | Audit + event |
| `convoy.member.left` | S → room | `convoyId, userId, reason` | Audit + event |
| `convoy.member.updated` | S → room | `convoyId, userId, role, status` | Audit + event |
| `convoy.location.updated` | C → S → room | `convoyId, userId, lat, lng, accuracyM, headingDeg, speedMps, recordedAt, stale` | Redis saja |
| `convoy.location.stale` | S → room | `convoyId, userId, lastSeenAt` | Tidak |
| `convoy.route.updated` | S → room | `convoyId, routeId, routeVersion, changedBy` | PostgreSQL |
| `convoy.status.changed` | S → room | `convoyId, status, actorId, version` | PostgreSQL |
| `convoy.message.created` | S → room | `messageId, clientMessageId, senderId, type, body?, createdAt, seq` | PostgreSQL |
| `convoy.message.send` | C → S | `clientMessageId, type, body?, attachmentMediaId?` | PostgreSQL setelah validasi |
| `hazard.created` | S → room/area | `hazardId, type, lat, lng, expiresAt` | PostgreSQL |
| `hazard.expired` | S → room/area | `hazardId, expiredAt` | PostgreSQL |
| `notification.created` | S → user | `notificationId, kind, title, createdAt` | PostgreSQL |
| `voice.participant.changed` | Provider → C | `roomId, participantId, state` | Fase 2 |
| `error` | S → C | `code, message, retryable` | Tidak |
| `ping` / `pong` | Keduanya | `ts` | Tidak |

Event lokasi **tidak** disiarkan ke room publik, feed, atau pengguna di luar konvoi (PRD 10.2, BR-05).

## 5. Alur posisi live

1. Klien mengirim `convoy.location.updated` dengan `lat`, `lng`, `accuracyM`, `headingDeg`, `speedMps`, `recordedAt`, `clientSeq`.
2. Server memvalidasi:
   - tiket masih berlaku dan `userId` berasal dari tiket;
   - konvoi berstatus `active`;
   - keanggotaan `active` dan `sharing_consent = true`;
   - laju kiriman ≤ 1 per 2 detik;
   - koordinat valid, `recordedAt` tidak di masa depan > 30 detik dan tidak lebih tua dari 5 menit.
3. Server menulis hash Redis `convoy:{id}:pos:{userId}` (TTL 300 s) dan menaikkan `seq` room.
4. Server menyiarkan ke anggota aktif. `userId` di payload selalu diisi server; nilai dari klien diabaikan.
5. Job stale berjalan setiap 10 detik: bila `now - lastSeenAt > staleAfterSeconds` (default 30), kirim `convoy.location.stale` satu kali sampai posisi baru masuk.
6. Saat keluar/selesai: hapus hash, kirim `convoy.member.left`, cabut akses.

Klien yang tidak mengirim posisi tetap menerima posisi anggota lain bila kebijakan konvoi mengizinkan; statusnya ditandai `not_sharing` pada snapshot, bukan ditampilkan sebagai posisi 0,0.

## 6. Chat

- Klien mengirim `convoy.message.send` dengan `clientMessageId` UUID.
- Server menyimpan pesan dalam transaksi (unique `convoy_id, sender_id, client_message_id`), lalu menyiarkan `convoy.message.created` dengan `seq` room.
- Retry dengan `clientMessageId` sama tidak membuat baris baru; server mengembalikan event yang sudah ada.
- Pengirim melihat pesan sebagai `pending` sampai event diterima; setelah reconnect, riwayat diambil lewat REST `GET /v1/convoys/{id}/messages` agar celah besar tidak bergantung pada buffer.
- Pesan `location` membawa `lat/lng` atau `routeId`; server tetap memeriksa izin sebelum menampilkan.

## 7. Reconnect dan urutan

- Heartbeat `ping` setiap 25 detik; tanpa `pong` dalam 10 detik, klien menutup dan reconnect.
- Backoff eksponensial 1, 2, 4, 8, 16, 30 detik dengan jitter.
- Klien menyimpan `lastSeq` per room dan mengirim `?ticket=...&sinceSeq=<n>` saat handshake ulang.
- Server memutar ulang event dari Redis Stream `convoy:{id}:events` (MAXLEN ± 2000, TTL 24 jam). Bila `sinceSeq` lebih lama dari buffer, server mengirim `convoy.snapshot` dan klien wajib mengambil ulang pesan/riwayat lewat REST.
- Setelah reconnect, klien tidak boleh menggandakan pesan berdasarkan `clientMessageId`.
- Kode penutupan: `4001` tiket tidak valid, `4003` akses dicabut, `4008` laju kiriman berlebih, `1012` server restart.

## 8. Rate limit dan penyalahgunaan

| Aksi | Batas |
|---|---|
| Update posisi | 1 per 2 detik per pengguna |
| Kirim pesan | 30 per menit per pengguna |
| Percobaan tiket | 10 per menit per pengguna |
| Koneksi bersamaan | 3 per pengguna |

Pelanggaran berulang menghasilkan `error` dengan `code: RATE_LIMITED`, lalu penutupan `4008`. Server mencatat anomali (mis. lompatan koordinat tidak wajar) sebagai flag kualitas, bukan ban otomatis (BR-08).

## 9. Privasi dan retensi

- Posisi live hanya di Redis dan dihapus saat sesi berakhir; tidak ada riwayat posisi konvoi yang dapat dibaca setelah sesi selesai (PRD 5.5, 11.5).
- Event chat disimpan di PostgreSQL dan tunduk pada retensi pesan konvoi.
- Payload notifikasi tidak memuat koordinat presisi atau isi pesan.
- Log koneksi tidak mencatat koordinat, tiket, atau token.

## 10. Skema validasi

```ts
type LocationUpdate = {
  lat: number; lng: number;
  accuracyM?: number; headingDeg?: number; speedMps?: number;
  recordedAt: string; // ISO 8601
  clientSeq?: number;
};

type MessageSend = {
  clientMessageId: string; // UUID
  type: "text" | "location";
  body?: string;           // wajib untuk text, maks 2000
  attachmentMediaId?: string;
};
```

Semua payload divalidasi dengan skema yang sama di gateway dan REST; tidak ada jalur yang melewati validasi.

## 11. Pengujian yang harus ada (belum dijalankan)

- Dua klien pada konvoi yang sama menerima posisi satu sama lain; koneksi ketiga tanpa keanggotaan ditolak.
- Anggota keluar: key Redis hilang, event `member.left` diterima, dan koneksi ditutup.
- Konvoi selesai: tidak ada event posisi setelah `status.changed(ended)`.
- Reconnect setelah putus 60 detik: `sinceSeq` memutar event yang hilang atau memicu snapshot.
- Retry chat dengan `clientMessageId` sama tidak menggandakan baris.
- Beban 30 anggota per konvoi sesuai PRD 11.1, diukur di lingkungan uji, bukan diklaim dari dokumen.
