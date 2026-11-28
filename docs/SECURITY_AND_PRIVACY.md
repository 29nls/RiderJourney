# SECURITY AND PRIVACY — RiderJourney

Dokumen ini adalah threat model dan baseline keamanan Fase 0. Mewujudkan PRD 11.4, 11.5, 5.5, dan 5.1 ACC-04/ACC-05. Tidak ada kontrol yang diklaim sudah berjalan; kolom verifikasi menunjukkan cara membuktikannya saat implementasi.

## 1. Aset yang dilindungi

| Aset | Mengapa sensitif | Lokasi |
|---|---|---|
| Posisi live anggota konvoi | Risiko keselamatan fisik bila bocor | Redis (TTL), WebSocket |
| Riwayat trip dan titik GPS | Pola perjalanan, rumah, rutinitas | PostgreSQL |
| Nomor polisi | Identitas kendaraan | Kolom terenkripsi |
| Kontak darurat | Data pribadi pihak ketiga | Kolom terenkripsi |
| Pesan konvoi | Komunikasi privat | PostgreSQL |
| Token akses dan refresh | Pengambilalihan akun | Perangkat (Keystore), transport |
| Kode undangan | Akses ke konvoi | Hash di PostgreSQL |
| Bukti pembelian | Fraud dan entitlement | Terenkripsi, log redaksi |
| Audit admin | Investigasi dan akuntabilitas | PostgreSQL append-only |
| Kredensial provider | Biaya dan akses layanan | Secret manager, bukan repo |

## 2. Aktor ancaman

- Pengguna anonim yang mencoba mengakses data tanpa akun.
- Pengguna terautentikasi yang mencoba IDOR (membaca konvoi/trip/pesan pengguna lain).
- Anggota konvoi yang mencoba melihat posisi anggota yang tidak berbagi, atau setelah sesi berakhir.
- Pemilik akun yang menyalahgunakan fitur (spam laporan, invite brute force, upload berbahaya).
- Admin dengan hak berlebih atau akun admin yang diambil alih.
- Pihak ketiga penyedia layanan yang gagal atau disusupi.
- Penyerang yang memegang perangkat pengguna (akses fisik).

## 3. Threat model ringkas

| # | Ancaman | Vektor | Kontrol | Verifikasi |
|---|---|---|---|---|
| T-01 | IDOR pada trip/kendaraan/pesan | Menebak UUID di path | Otorisasi kepemilikan di service; UUIDv7 tidak dapat ditebak; 404 untuk resource tak berhak | Test dua akun, akses lintas user |
| T-02 | Melihat posisi tanpa hak | Join room atau query posisi langsung | Tiket terikat keanggotaan; cek status konvoi + consent; room ditentukan server | Test koneksi ketiga tanpa tiket |
| T-03 | Posisi tetap tersedia setelah sesi | Key Redis tertinggal | TTL 300 s, hapus saat keluar/end, cabut langganan | Test keluar konvoi + inspeksi Redis |
| T-04 | Brute force kode undangan | Menebak 8 karakter | Kode acak 40-bit, hash HMAC, rate limit 5/menit, expiry, revoke, audit percobaan | Test beban dan lockout |
| T-05 | Eskalasi role konvoi/komunitas | Mengubah `role` di body | Role dari server; hanya leader yang boleh mengubah; audit | Test anggota biasa mengubah role |
| T-06 | Kebocoran lokasi lewat analitik/log | Event membawa koordinat | Skema event tanpa koordinat; redaksi log; review sebelum rilis | Audit payload dan log |
| T-07 | Penyalahgunaan upload | File berbahaya, MIME palsu, ukuran besar | Signed URL, batas ukuran, MIME sniffing, moderasi, kuota | Test file salah tipe dan oversize |
| T-08 | Pengambilalihan akun | Token dicuri dari storage/log | Keystore, TLS, token berumur pendek, revoke saat logout, tidak ada token di log | Inspeksi storage dan log |
| T-09 | Akses admin tanpa jejak | Tindakan langsung ke database | RBAC, audit wajib, larangan akses rutin ke pesan/trip | Test audit dan akses moderator |
| T-10 | Spam laporan bahaya | Laporan palsu massal | Rate limit, TTL, confidence, moderasi, reputasi | Test rate limit dan moderasi |
| T-11 | Penyalahgunaan billing | Token pembelian dipalsukan/diulang | Verifikasi server ke Google Play, idempotensi `provider_txn_id`, rekonsiliasi | Test token invalid dan replay |
| T-12 | Akses fisik perangkat | Perangkat tidak terkunci | Kunci biometrik perangkat, sesi dapat dicabut, tidak menyimpan sandi | Test logout dan revoke |
| T-13 | Secret bocor di repo | Commit `.env` atau kunci | `.gitignore`, `.env.example` tanpa nilai, secret scanning, review | Scan repo sebelum rilis |
| T-14 | DoS endpoint mahal | Spam preview rute/upload | Rate limit per pengguna, timeout provider, kuota | Load test terbatas |
| T-15 | Spam dan harassment | Pesan massal, mention, posting/komentar berulang, undangan komunitas | Rate limit per aksi, batas mention, mute/blokir, moderasi, deteksi pola | Uji dua akun: blokir, mute, laporan, rate limit |
| T-16 | Retensi berlebihan / penghapusan tidak tuntas | Data lokasi, pesan, media, akun dihapus tetap tersimpan | Retensi terjadwal, partisi trip_points, hard delete media, anonimisasi, audit permintaan | Uji hapus akun dan media; periksa backup dan turunan |

## 4. Klasifikasi data

| Kelas | Contoh | Aturan |
|---|---|---|
| Public | Nama komunitas publik, posting publik | Boleh di-cache CDN; tetap melalui moderasi |
| Internal | Konfigurasi fitur, metrik agregat | Tidak untuk klien kecuali field yang diizinkan |
| Confidential | Profil privat, riwayat trip, pesan, media privat | Otorisasi per resource, signed URL, tanpa log |
| Restricted | Posisi live, plat, kontak darurat, token, bukti pembelian, audit | Enkripsi, akses minimum, tanpa ekspor massal, audit akses |

Posisi live adalah Restricted: tidak masuk analytics, tidak masuk crash report, tidak masuk notifikasi, dan tidak pernah ditulis ke database transaksional.

## 5. Autentikasi dan sesi

- Token diverifikasi backend lewat JWKS: tanda tangan, `iss`, `aud`, `exp`, `nbf`, `alg` yang diizinkan (tolak `none` dan algoritma simetris yang tidak disepakati).
- `sub` dipetakan ke `users.auth_uid`; ID internal dipakai di seluruh relasi.
- Tidak ada endpoint yang menerima `userId` klien untuk otorisasi.
- Logout mencabut refresh token dan `device_tokens` perangkat tersebut; sesi lain tetap dapat dicabut terpisah.
- Token di perangkat disimpan di Android Keystore/EncryptedSharedPreferences, bukan `SharedPreferences` biasa atau file teks (PRD 11.4).
- Akun yang `suspended` atau `deletion_pending` ditolak pada guard, kecuali endpoint pemulihan yang diizinkan.

## 6. Otorisasi

- RBAC platform: `rider`, `platform_moderator`, `super_admin`.
- Role konvoi: `leader`, `co_leader`, `member`; role komunitas: `owner`, `admin`, `moderator`, `member`.
- Setiap handler memeriksa resource, bukan hanya role: kepemilikan kendaraan/trip, keanggotaan konvoi, keanggotaan komunitas, status laporan.
- Moderator hanya dapat membaca konten yang terkait laporan; tidak ada penelusuran bebas ke pesan atau trip.
- Aksi admin sensitif (suspend, ban, ubah entitlement, ubah konfigurasi, hapus konten) menulis `admin_audit_logs` dengan actor, target, alasan, before/after, request ID.
- Prinsip least privilege: service account worker hanya memiliki izin tabel yang dibutuhkan; migration memakai peran terpisah.

## 7. Privasi lokasi

Aturan yang tidak boleh dilanggar implementasi:

1. Berbagi lokasi **opt-in** per sesi konvoi; default `user_settings.location_sharing_default = false` kecuali pengguna mengubahnya (PRD 11.5).
2. Hanya anggota konvoi `active` yang berhak menerima posisi; anggota yang tidak berbagi tetap dapat melihat bila kebijakan konvoi mengizinkan, dengan status jelas (PRD 5.5).
3. Lokasi tidak dikirim ketika tidak ada sesi aktif (PRD 11.3).
4. Lokasi lebih tua dari ambang ditandai stale, bukan ditampilkan sebagai posisi terkini (BR-06).
5. Berhenti berbagi tersedia dari layar konvoi dan dari notifikasi foreground; efeknya langsung (hapus key, event `member.updated`).
6. Saat konvoi selesai atau anggota keluar, stream berhenti dan akses room dicabut (PRD 6.2 langkah 7).
7. Riwayat trip default privat; pembagian hanya atas tindakan pemilik (PRD 11.5).
8. Tidak ada penggunaan koordinat presisi untuk iklan atau profiling tanpa consent terpisah (PRD 11.5).
9. Ekspor dan penghapusan akun tersedia; status permintaan tercatat (ACC-04, 11.5).

## 8. Data sensitif saat disimpan

| Data | Perlakuan |
|---|---|
| Plat nomor | AES-256-GCM di aplikasi, key version disimpan, hanya pemilik yang dapat meminta |
| Kontak darurat | Terenkripsi; tidak pernah tampil di profil/komunitas |
| `purchase_token_ref` | Terenkripsi; tidak dikembalikan API |
| Pesan konvoi | Enkripsi at-rest database; akses via otorisasi |
| Backup | Terenkripsi; restore diuji (PRD 11.2) |
| Audit log | Append-only; retensi 2 tahun |

Enkripsi at-rest database dan storage adalah baseline infrastruktur; enkripsi kolom dipakai untuk nilai yang tidak perlu dicari (plat, kontak, token pembelian).

## 9. Media

- Unggah memakai signed PUT berumur pendek dengan `content-length` dan tipe yang dibatasi.
- Server memeriksa signature file (magic bytes), bukan hanya header klien.
- Gambar/video diproses ulang untuk membuang metadata lokasi EXIF sebelum dipublikasikan.
- Media privat hanya lewat signed GET berumur pendek; tidak ada URL publik permanen (PRD 5.10).
- Moderasi: status `pending` tidak tampil di feed publik sampai `approved`.
- Kuota per pengguna/komunitas ditegakkan server.

## 10. Undangan dan redeem

- Kode 8 karakter Crockford Base32, 40 bit entropi; disimpan sebagai HMAC-SHA-256 dengan pepper server (D-016).
- Kode mentah hanya dikembalikan sekali saat dibuat; tidak dapat dibaca ulang.
- Validasi join: hash cocok, belum kedaluwarsa, `used_count < max_uses`, konvoi belum selesai, kapasitas tersedia, pengguna tidak diblokir.
- Percobaan join gagal dicatat untuk deteksi brute force; rate limit 5/menit.
- Redeem code memakai hash dan unique `(redeem_code_id, user_id)` agar tidak dapat dipakai ulang (RWD-05, Fase 4).

## 11. Rate limit dan anti-abuse

Rate limit per pengguna dan per IP untuk login, join, chat, upload, redeem, laporan, preview rute, dan tiket realtime (lihat `API_CONTRACT.md` bagian 16 dan `REALTIME_EVENTS.md` bagian 8). Aksi yang dicurigai (laporan massal, lompatan GPS ekstrem, pola invite) ditandai untuk review, bukan langsung memban pengguna (BR-08).

## 12. Logging, analytics, dan crash reporting

- Log terstruktur tanpa token, password, koordinat, plat, isi pesan, nomor telepon, atau `purchaseToken`.
- `requestId` menghubungkan log API dengan audit tanpa menyimpan payload sensitif.
- Analytics memakai daftar event PRD 13.1; properti dibatasi pada ID dan nilai non-sensitif.
- Crash report tidak mengirim isi pesan, koordinat, atau token; stack trace dipetakan ke build yang diunggah.
- Akses ke log produksi dibatasi dan diaudit.

## 13. Ketergantungan pihak ketiga

- Setiap SDK pihak ketiga ditinjau sebelum ditambahkan: izin, data yang dikirim, retensi, dan cara menonaktifkan.
- Firebase/OIDC, FCM, LiveKit, storage, dan provider peta diperlakukan sebagai pemroses data; daftar ini masuk kebijakan privasi final (PRD 17 butir 10).
- Tidak ada SDK iklan pada MVP.
- Kunci klien yang memang publik (mis. API key peta dengan pembatasan domain/aplikasi) dibatasi; kunci rahasia tetap di server.

## 14. Kepatuhan dan kebijakan yang belum selesai

- Terms, Privacy Policy, kebijakan usia, dan kontak darurat belum tersedia; ini keputusan pemilik produk dan penasihat hukum (PRD 17 butir 10).
- Kebijakan retensi default ada di `DATA_MODEL.md` bagian 18, tetapi belum ditinjau legal (PRD 17 butir 5).
- Google Play: deklarasi background location dan foreground service harus disiapkan sebelum rilis; lihat `ANDROID_PERMISSIONS.md`.
- Tombol SOS tidak boleh mengklaim menghubungi layanan darurat resmi tanpa integrasi nyata (PRD 5.7 SAF-07).

## 15. Verifikasi keamanan yang direncanakan (belum dijalankan)

| Uji | Target | Fase |
|---|---|---|
| Dua akun tidak dapat saling membaca trip/kendaraan/pesan | T-01 | 1 |
| Koneksi WebSocket tanpa keanggotaan ditolak | T-02 | 1 |
| Posisi hilang dari Redis setelah keluar/end | T-03 | 1 |
| Brute force kode undangan terkena rate limit | T-04 | 1 |
| Anggota biasa tidak dapat mengubah role | T-05 | 1 |
| Audit log tercatat untuk suspend dan perubahan config | T-09 | 1 |
| Upload MIME palsu ditolak | T-07 | 1 |
| Token tidak muncul di log/crash report | T-06, T-08 | 1 |
| Replay token pembelian tidak menambah entitlement | T-11 | 4 |
| Blokir dan mute mencegah pesan/mention | T-15 | 2 |
| Hapus akun memproses data turunan dan media | T-16 | 1 |
| Backup tidak menghidupkan kembali data yang dihapus | T-16 | 1 (uji restore) |

Tidak ada hasil uji yang diklaim pada Fase 0 karena belum ada kode.

## 16. Fase 4 — sosial, album, replay, poster, dan engagement

Kontrol yang sekarang diimplementasikan dan diuji:

- **Satu aturan visibilitas** (`backend/src/social/audience.sql.ts`) dipakai oleh feed, detail post, album, dan akses media. Urutannya: penulis selalu boleh; `private` hanya penulis; `followers` butuh follow yang diterima; `community` butuh keanggotaan aktif; `public` tetap menyembunyikan konten yang dihapus/dimoderasi.
- **Blokir bersifat dua arah** untuk feed, pencarian post langsung, komentar, follow, dan media. **Mute hanya menyaring feed** dan tidak menghalangi akses langsung.
- **Signed URL media** memakai HMAC-SHA256 yang terikat pada satu `mediaId` dan satu `expires`; tanda tangan tidak valid atau kedaluwarsa ditolak 401. Penerbitan URL memakai pemeriksaan akses yang sama dengan feed/album/trip.
- **Unggahan** memakai intent + completion. Completion memeriksa magic bytes (JPEG/PNG/WebP/MP4/WebM), ukuran yang dijanjikan, dan batas per purpose; video memakai batas terpisah dan tidak dapat menyamar sebagai foto.
- **Idempotensi** dijaga oleh kunci klien dan constraint database: `client_media_id`, `client_post_id`, `client_id` komentar/reaksi, `client_report_id`, `client_album_id`, `client_poster_id`, dan `UNIQUE (user_id, reason, reference_id)` pada point ledger.
- **Moderasi album**: media album komunitas masuk `pending`; hanya pemilik album atau moderator komunitas yang dapat menyetujui/menolak; media `rejected` tidak tampil untuk pengguna lain. Kuota dihitung di dalam transaksi dengan `SELECT ... FOR UPDATE`.
- **Penghapusan data sosial** menghapus post, album, media (metadata), trip photo, notifikasi, perangkat push, poin, dan badge; object key dikembalikan agar lifecycle storage menghapus byte-nya. Akun pengguna tetap ada.
- **Push**: token FCM disimpan terenkripsi dengan `CONTACT_ENCRYPTION_KEY` (fallback `PLATE_ENCRYPTION_KEY`) dan hanya hash yang unik; tanpa `FCM_SERVER_KEY` pengiriman dilaporkan nonaktif, bukan gagal.
- **Engagement aman**: alasan poin dibatasi oleh CHECK database ke checklist keselamatan, RSVP kegiatan, laporan bahaya, komentar baik, dan badge. Kecepatan, jarak, atau penggunaan ponsel saat berkendara tidak dapat direpresentasikan. Leaderboard hanya menjumlahkan ledger akun yang opt-in.

Batasan yang masih terbuka (tidak diklaim selesai):

- Permukaan API komunitas minimal sekarang tersedia: create, join/request, approve/decline, daftar anggota, dan perubahan role. Semua mutasi memeriksa role/permission di server, menolak perubahan owner, dan menulis `community_audit_logs`. Test `community.test.ts` membuktikan alur create → request → approve → role → post audience komunitas → album komunitas tanpa baris database manual.
- Signed GET mengembalikan metadata + grant, bukan aliran byte dari bucket. Adapter storage produksi harus menerjemahkan grant ini menjadi SigV4 asli atau proxy Worker; kredensial storage tidak pernah dikirim ke klien.
- FCM belum diuji dengan kredensial nyata; hanya jalur in-app, preferensi, dan registrasi perangkat yang diuji.
- Story/status sengaja belum dibuat karena prioritas produk dan kebijakan retensi belum disetujui (PRD butir 6).

## 17. Fase 5 — langganan, admin, dan operasi

Kontrol yang sekarang diimplementasikan dan diuji:

- **Dua kill switch** untuk fitur berbayar: environment `BILLING_ENABLED`/`PAID_FEATURES_ENABLED` dan `admin_config.features`. Pembelian, grant manual, dan entitlement premium hanya aktif bila keduanya true. Default semua false.
- **Verifikasi provider**: backend memanggil Android Publisher `purchases.subscriptionsv2`; state klien tidak dipercaya. Token di-hash untuk lookup dan disimpan terenkripsi hanya untuk rekonsiliasi. Token yang sudah terikat akun lain ditolak `PURCHASE_ALREADY_BOUND`.
- **Status langganan** disimpan server-side dengan expiry, grace, auto-renew, dan status provider. `paused`/`on_hold` tidak memberi entitlement. Kill switch mengembalikan akun ke paket free tanpa menghapus riwayat.
- **Admin RBAC**: support, moderator, admin, superadmin. Izin diperiksa di service. MFA TOTP wajib untuk step-up; token step-up ber-audience admin, berumur pendek, dan terikat pada user.
- **Audit**: setiap tindakan sensitif menyimpan aktor, aksi, target, alasan wajib, nilai before/after, dan request id. Audit tidak dihapus oleh UI.
- **Redeem**: kode HMAC dengan pepper, plaintext hanya sekali, kuota/expiry/status dikunci dalam transaksi, satu kode sekali per akun, idempotency key unik. Ledger poin immutable.
- **Privacy**: export memakai job dan masa berlaku; penghapusan memakai konfirmasi, grace period, pencabutan refresh token, penghapusan konten, dan penyamaran PII. Catatan billing/audit yang wajib disimpan dipertahankan secara pseudonim.
- **Rate limit**: 120 request/menit global; login/register 10/menit; reset 5/menit; MFA 5-10/menit; redeem 5/menit; billing verify 10/menit; restore 5/menit.
- **Redaksi log**: filter error menyamarkan token, secret, password, authorization, dan signature. Log request tidak memuat body, query, atau koordinat.
- **Admin web** memakai cookie `HttpOnly`, `SameSite=Lax`, `Secure` di produksi, proxy server-side, refresh rotation, dan CSP. Step-up token hanya di `sessionStorage` tab, bukan cookie permanen.

Batasan keamanan yang masih terbuka:

- RTDN memakai shared secret header; Pub/Sub memerlukan gateway OIDC yang belum dibuat. Jangan aktifkan RTDN sebelum gateway ada.
- CSP admin masih mengizinkan `'unsafe-inline'` untuk script; ini perlu nonce atau edge proxy.
- Rate limit login admin dilihat backend sebagai IP server Next.js, bukan IP operator. Edge rate limit per operator belum ada.
- Belum ada uji penetrasi, review dependency, atau alerting produksi.
- Secret manager, rotasi key, dan uji restore belum dijalankan.
- Kebijakan retensi dan pengecualian penghapusan akun belum ditinjau legal.

## 18. Penyimpanan media — kontrol Phase 6.1

- Bucket privat; tidak ada ACL publik, tidak ada URL permanen. Akses baca hanya lewat URL SigV4 berumur 60 detik yang diterbitkan setelah tanda tangan aplikasi diverifikasi.
- Kredensial storage hanya ada di environment server. Tidak ada akses key, session token, atau endpoint internal di respons API maupun aplikasi Android.
- Key objek 100% dibuat server (`media/{ownerId}/{mediaId}.{ext}`); klien tidak dapat memilih path, dan presigned URL terikat pada satu key sehingga perubahan prefix menghasilkan `403 SignatureDoesNotMatch`.
- Presigned PUT menandatangani `content-type` dan `if-none-match`. Unggahan dengan tipe berbeda ditolak storage; unggahan ulang ke key yang sudah terisi ditolak `412`.
- Penyelesaian unggahan tidak mempercayai `sizeBytes`, `contentType`, atau checksum dari body permintaan. Ukuran dan tipe diambil dari `HEAD`, sedangkan SHA-256 dihitung server dari stream objek; magic bytes diperiksa terpisah.
- `checksumSha256` wajib pada pembuatan intent. Tanpa checksum, unggahan tidak dapat diselesaikan.
- Batas ukuran ditegakkan dua kali: aplikasi (per tujuan) dan constraint tabel (100 MB absolut).
- Penghapusan objek tidak pernah diasumsikan berhasil. Outbox mencatat niat, worker menghapus dan memverifikasi ketiadaan objek, dan kegagalan berulang berakhir di dead-letter yang terlihat lewat `npm run media:purge` (status) atau `--run`.
- Respons galat tidak memuat nama bucket, key, atau pesan dari storage; kode galat stabil (`MEDIA_OBJECT_MISSING`, `MEDIA_SIZE_MISMATCH`, `MEDIA_CHECKSUM_MISMATCH`, dan seterusnya).

Yang belum diverifikasi: bucket policy produksi AWS (Block Public Access, TLS, IAM least-privilege), masa retensi objek `pending` yang ditinggalkan klien, dan pemindaian malware.

## 19. Storage lifecycle — audit Phase 6.2

### 19.1 Kredensial storage

Backend memakai kredensial statis dari environment
(`MEDIA_S3_ACCESS_KEY`, `MEDIA_S3_SECRET_KEY`) dan tidak pernah mengirimkannya ke
Android. Android hanya menerima presigned URL berumur pendek.

Temuan: kredensial statis adalah **known limitation**, bukan PASS untuk
production. Yang dibutuhkan sebelum production:

- IAM policy least privilege per bucket/prefix (`PutObject`, `GetObject`,
  `HeadObject`, `DeleteObject` pada `media/*` saja; tanpa `ListBucket` global).
- Bucket policy yang menolak akses anonim dan menolak `aws:SecureTransport = false`.
- Server-side encryption (SSE-S3 atau SSE-KMS) diaktifkan pada bucket.
- Rotasi kredensial, atau sesi sementara STS bila backend dapat memakainya.

Adapter `createObjectStorage()` memakai klien AWS SDK, sehingga kredensial
sementara/role-based dapat dipakai tanpa mengubah kode bila environment
menyediakannya. Semua ini **belum diuji terhadap AWS nyata**.

### 19.2 Akses unduh

| Pemeriksaan | Hasil |
| --- | --- |
| Endpoint `/access` butuh autentikasi? | Tidak — capability URL, sesuai desain |
| Ownership divalidasi? | Ya, sebelum URL diterbitkan (`/url`) dan saat verifikasi baris |
| Visibilitas media? | Post/album/trip/follow/community + purpose bersama (`avatar`, `vehicle_photo`, dst.) |
| URL dapat dibagikan? | Ya, sampai `expires` (default 300 detik) — diterima sebagai capability |
| URL bocor lewat log? | Log request hanya mencatat `path`, bukan query string penuh |
| Expiration ditegakkan? | Ya — `401 SIGNED_URL_EXPIRED`; presigned GET turunan hanya 60 detik |

Catatan: `media_assets` tidak memiliki `deleted_at`; penghapusan mengubah status
sehingga signature lama berhenti bekerja karena baris harus `ready`.

### 19.3 Media yang belum dipindai

Tidak ada provider malware/CSAM/moderation. Media tetap `unscanned` dan
`NoOpMediaScanner.available()` selalu `false`. Media `unscanned` **tidak**
ditampilkan sebagai sudah aman, dan tombol "lapor" tetap menjadi kontrol utama.
Kebijakan moderasi (auto-quarantine, rescan) belum dapat dijalankan.

## 20. Penghapusan media, kuota, dan scanning (Phase 6.3)

### 20.1 Otorisasi penghapusan

| Pemeriksaan | Implementasi |
| --- | --- |
| Autentikasi | `AuthGuard` pada seluruh `MediaController` |
| Kepemilikan | `WHERE id = $1 AND owner_id = $2`; pemilik lain mendapat `404`, bukan `403`, agar keberadaan media tidak bocor |
| Referensi aktif | `referencesOf()` memeriksa 8 tabel + keanggotaan album sebelum izin diberikan |
| Idempotensi | Status `deleting`/`deleted` mengembalikan `duplicate: true` tanpa enqueue kedua |
| Race | CAS `status = 'ready'` di dalam transaksi yang sama dengan insert outbox |

Media yang masih dipakai post, album, trip, poster, hazard, avatar, atau
kendaraan **tidak dapat dihapus**. Penggantian avatar/foto kendaraan memakai
transaksi: pointer dilepas dulu, referensi dihitung ulang, baru media lama
dijadwalkan hapus. Ini mencegah penghapusan foto yang dipakai di tempat lain.

### 20.2 Akuntansi kuota (anti double-counting)

Satu aturan dipakai di baca, reservasi, dan rekonsiliasi:

- `pending` → `reservedBytes`
- `ready` dan `deleting` → `usedBytes`
- `expired`, `rejected`, `deleted` → tidak dihitung

Konsekuensinya, **permintaan hapus tidak membebaskan kuota**. Ruang baru kembali
setelah worker memverifikasi objek hilang (`HEAD` setelah `delete`) dan baris
menjadi `deleted`. Tidak ada kolom `used_bytes` yang ditulis manual, sehingga
tidak ada pembukuan ganda yang bisa menyimpang.

### 20.3 Scanning dan karantina

- Scanner malware (`ClamAV`) dan moderasi konten adalah dua hal berbeda;
  ClamAV **tidak** mendeteksi CSAM dan tidak menggantikan moderasi. Moderasi
  masih BLOCKED karena belum ada provider.
- Scanner yang tidak tersedia atau gagal tidak pernah menghasilkan `clean`.
  `NoOpMediaScanner.available()` selalu `false`.
- Media `quarantined` tidak dapat diakses pengguna lain; pemilik masih dapat
  melihatnya.
- Kebijakan publik fail-closed: pengguna lain hanya menerima media
  `scan_status = 'clean'`. Media `unscanned` juga ditolak, sehingga tidak ada
  media yang tampil ke publik hanya karena belum dipindai.

### 20.4 Endpoint admin

`GET /v1/admin/media/workers` memakai `AuthGuard` + `AdminGuard`. Response hanya
berisi angka antrean, waktu, dan pesan error yang dipotong 300 karakter. Object
key, presigned URL, kredensial storage, dan metadata pengguna tidak dikembalikan.

## 21. Reliability, moderasi, dan alerting (Phase 6.4)

**Fail-closed dipertahankan.** Tidak ada jalur yang menandai media `clean` tanpa
hasil scanner, dan tidak ada jalur yang menyajikan media `quarantined` sebagai
unduhan — termasuk endpoint pratinjau admin, yang menolak (`409`) bila
`scan_status !== 'clean'`. Reviewer melihat metadata dan alasan blokir, bukan
file berbahaya.

**Pemisahan wewenang.** Scanner hanya menulis `scan_status*`; reviewer hanya
menulis `moderation_status*`. `media_moderation_log` mencatat aktor, alasan, dan
transisi status; `admin_audit_logs` mencatat `media.approve`, `media.reject`,
`media.hide`, `media.reopen`, `media.deletion.retry`, dan
`media.deletion.reconcile`. Keduanya append-only dalam praktik.

**Izin baru.** `media.read` (antrean, riwayat, pratinjau, alert) untuk moderator
ke atas; `media.moderate` untuk moderator ke atas; `media.ops` hanya admin dan
superadmin. `support` sengaja tidak dapat membaca antrean karena isinya konten
pengguna yang belum ditinjau. Regresi diuji di `phase6_4.test.ts`.

**Pembatalan penghapusan.** Pembatalan memakai `FOR UPDATE` pada baris media dan
outbox, sehingga tidak ada balapan dengan klaim worker. Setelah klaim, atau
setelah objek hilang, permintaan ditolak. Ini mencegah janji palsu "dibatalkan"
atas objek yang sudah tiada.

**Alerting tanpa kebocoran.** `ops_alert_events.details` hanya memuat angka,
nama kind, dan pesan galat storage yang sudah dipotong. Tidak ada object key,
URL bertanda tangan, token, atau kredensial. Endpoint alert tidak memerlukan
step-up karena hanya membaca.

**Backup Android.** `android:allowBackup="false"` dipertahankan, ditambah
`dataExtractionRules` yang mengecualikan seluruh `sharedpref` dari cloud backup
maupun device transfer, agar token sesi tidak ikut tersalin ke perangkat lain.

**Catatan privasi moderasi.** Antrean moderasi menampilkan `ownerId` (UUID),
bukan email atau nama. Preview memakai URL berumur 120 detik.

## Status verifikasi (PHASE 6.5)

- Dependency audit backend/admin: PASS (0 vulnerability).
- Karantina EICAR tidak dapat diakses pengguna lain: PASS (terbukti).
- Notifikasi eksternal: BLOCKED (tidak ada provider).
