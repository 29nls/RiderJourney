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
- Konvoi selesai: tidak ada event posisi setelah `status.changed(completed)`.
- Reconnect setelah putus 60 detik: `sinceSeq` memutar event yang hilang atau memicu snapshot.
- Retry chat dengan `clientMessageId` sama tidak menggandakan baris.
- Beban 30 anggota per konvoi sesuai PRD 11.1, diukur di lingkungan uji, bukan diklaim dari dokumen.

## 12. Implementasi Phase 2 (fakta, 24 November 2026)

Bagian 1–11 adalah rancangan. Bagian ini mencatat perilaku yang benar-benar diimplementasikan; bila berbeda, implementasi dan test menjadi acuan sampai kontrak direvisi.

### 12.1 Cakupan yang aktif

- Endpoint: `POST /v1/realtime/ticket` dan `WS /v1/realtime`.
- Pesan klien yang diterima: `ping` dan `convoy.location.updated`. Chat, hazard, route message, dan voice **belum** ada di kanal ini.
- Event server: `convoy.ready`, `convoy.snapshot`, `convoy.location.updated`, `convoy.location.stale`, `convoy.member.joined`, `convoy.member.left`, `convoy.member.updated` (termasuk handoff kepemimpinan), `convoy.status.changed`, `convoy.route.updated`, `pong`, dan `error`.
- Event hanya disiarkan ke room `convoy:{id}`; identitas pengirim posisi selalu diambil dari tiket.

### 12.2 Tiket dan handshake

- Respons tiket: `{ticket, expiresIn, convoyId, protocol: "v1", wsPath: "/v1/realtime", capabilities}`.
- TTL tiket dari `REALTIME_TICKET_TTL_SECONDS` (default 60 detik), disimpan sebagai hash SHA-256, diambil dan dihapus secara atomik sehingga sekali pakai.
- Tiket hanya diterbitkan untuk membership `active` pada status `lobby/active/paused`.
- Handshake gagal: `401` untuk tiket hilang/tidak valid/kedaluwarsa/sudah dipakai, `403` untuk origin CORS yang ditolak atau keanggotaan tidak aktif.
- Query `sinceSeq` memutar event dari buffer; `convoy.snapshot` selalu dikirim sesudah replay dan memuat `replayTruncated` bila buffer tidak lagi mencakup `sinceSeq`.
- Urutan saat koneksi dibuka: replay event (bila ada `sinceSeq`), lalu `convoy.snapshot`, lalu `convoy.ready`. `convoy.ready` bukan bagian urutan room (`seq: 0`) dan tidak dipakai klien untuk state.

### 12.3 Lokasi dan pembatasan

- Hanya konvoi `active`, anggota `active`, dan `sharing_consent = true` yang boleh mengirim posisi.
- Laju: maksimum **1 pesan posisi per detik per koneksi** (bukan 1 per 2 detik seperti rancangan). Pelanggaran mengembalikan `error code: RATE_LIMITED`; server tidak menutup koneksi.
- Validasi: lat −90…90, lng −180…180, `accuracyM` 0…1000, heading 0…360, speed 0…100, `recordedAt` maksimum 30 detik di masa depan dan 5 menit di masa lalu.
- Posisi duplikat atau lebih lama dari posisi terakhir ditolak dengan `error code: OUT_OF_ORDER`. Deduplikasi juga dilakukan klien berdasarkan `id` event.
- Key Redis: `convoy:{id}:pos:{userId}` TTL 300 detik (dapat dikonfigurasi), presence per anggota, dan buffer event `convoy:{id}:events` berupa **list Redis** (bukan Stream) berisi maksimum 2000 event dengan TTL 24 jam.
- Pemeriksaan stale berjalan setiap `min(10 dtk, max(0,5 dtk, staleAfter/2))`; event stale dikirim sekali per `lastSeenAt` sampai posisi baru masuk.
- Saat konvoi selesai/dibatalkan, keluar, atau dikeluarkan: key posisi/presence dan buffer event konvoi dihapus. Snapshot tidak lagi memuat posisi.

### 12.4 Kode penutupan dan error

- `4001`: tidak dipakai pada implementasi ini; handshake invalid ditolak HTTP 401/403 sebelum upgrade.
- `4003 access_revoked`: keanggotaan hilang saat koneksi dibuka ulang atau akses dicabut.
- `4008`: belum dipakai; rate limit dilaporkan sebagai `error` tanpa penutupan.
- Error aplikasi memakai `{code, detail}` di dalam `data`; bukan `{code, message, retryable}`.

### 12.5 Rate limit dan fanout

- Tiket: 20 permintaan per menit per pengguna.
- Posisi: 1 per detik per koneksi; tidak ada kuota koneksi bersamaan per pengguna pada implementasi ini.
- Fanout menggunakan hub in-process. Redis menyimpan state, bukan pub/sub lintas replika. Menjalankan lebih dari satu instance API akan memecah fanout; itu **belum didukung** dan wajib diselesaikan sebelum produksi multi-replika.

### 12.6 Verifikasi

- `backend/src/test/phase2.test.ts` menguji isolasi room, penolakan nonanggota, stale, reconnect + replay, deduplikasi/urutan, single-use ticket, pencabutan akses, handoff, dan beban 30 anggota.
- Load test memakai store memori dan satu proses Node (bukan Redis nyata). Angka aktual ada di `PHASE_2_REPORT.md`; itu bukan klaim kapasitas produksi.
