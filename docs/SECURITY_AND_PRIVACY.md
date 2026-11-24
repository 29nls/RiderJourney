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

Tidak ada hasil uji yang diklaim pada Fase 0 karena belum ada kode.
