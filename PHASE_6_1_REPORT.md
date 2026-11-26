# PHASE 6.1 REPORT — Media Pipeline P0 Closure

Tanggal: 26 November 2026. Commit dasar: `7c97787`. Lingkup: backend media storage, migrasi, test integrasi, CI, dokumentasi. Tidak ada deployment produksi, tidak ada perubahan billing, tidak ada fitur baru di luar media.

## 1. Executive summary

Enam temuan P0 media dari Phase 6 sudah ditutup pada level kode dan diuji terhadap **server S3-compatible nyata**, bukan mock:

1. Presigned upload sekarang memakai SigV4 kanonikal dari AWS SDK v3.
2. `complete` tidak lagi menerima ukuran atau file dari klien.
3. Verifikasi `HEAD` memeriksa keberadaan, panjang, dan tipe objek.
4. SHA-256 dihitung server dari stream objek dan dibandingkan dengan checksum yang dijanjikan saat intent.
5. Penghapusan objek memakai transactional outbox dengan worker yang me-retry dan memverifikasi objek benar-benar hilang.
6. Uji integrasi storage berjalan pada server S3 nyata (SeaweedFS) di lokal dan di CI.

Satu hal yang tidak dapat dipenuhi: **MinIO**. Server open-source MinIO sudah diarsipkan dan tidak lagi didistribusikan; `dl.min.io` mengembalikan HTTP 410 dengan pesan bahwa proyek diarsipkan, dan repositori Docker Hub `minio/minio` mengembalikan "object not found". Karena itu uji integrasi memakai gateway S3 SeaweedFS 4.55 — server sungguhan yang memvalidasi SigV4, conditional PUT, dan object metadata — dan status kriteria MinIO dilaporkan **BLOCKED**, bukan PASS. Kompatibilitas AWS produksi juga belum diverifikasi.

Hasil: 40 unit/regresi lulus (11 uji integrasi di-skip tanpa storage), 11 uji integrasi storage lulus, typecheck bersih, admin build lulus.

## 2. Original findings

| # | Temuan Phase 6 | Bukti sebelum perubahan |
|---|---|---|
| 1 | Signature upload bukan SigV4 kanonikal | `media.service.ts` menandatangani string URL dengan `createHmac`, `X-Amz-Date` di-hardcode `${date}T000000Z`, menambah parameter non-S3 `X-Owner`, dan menaruh `If-None-Match` sebagai query |
| 2 | `complete` mempercayai `sizeBytes` klien | Controller menerima multipart `sizeBytes` + 1 KB header file; baris `size_bytes` ditimpa nilai klien |
| 3 | Tidak ada `HEAD` objek | Tidak ada pemanggilan storage sama sekali pada completion |
| 4 | Tidak ada verifikasi checksum | `checksum_sha256` disimpan tetapi tidak pernah dibandingkan |
| 5 | Tidak ada worker penghapusan | Metadata dihapus, `objectKeys` dikembalikan ke pemanggil, byte objek tidak pernah dihapus |
| 6 | Tidak ada uji integrasi storage | Semua test memakai env palsu `https://storage.example.test`; tidak ada satu pun operasi storage nyata |

Temuan tambahan saat implementasi:

- `media_assets.size_bytes` memiliki CHECK `<= 5242880` dari Phase 3, sehingga intent video di atas 5 MB gagal di database meskipun `MEDIA_MAX_VIDEO_BYTES` 100 MB.
- Presigned URL tanpa `content-type` yang ditandatangani tidak mengikat tipe unggahan; SDK juga menambahkan parameter checksum fleksibel pada presigned PUT yang ditolak server S3-compatible (`BadDigest`).
- Endpoint signed GET hanya mengembalikan metadata, tidak pernah memberi cara mengambil byte objek privat.

## 3. Architecture changes

- `backend/src/media/object-storage.ts` — antarmuka `ObjectStorage` (`presignPut`, `presignGet`, `head`, `openRead`, `delete`) dan implementasi `S3ObjectStorage`. Tidak ada modul lain yang menyentuh SDK S3.
- `backend/src/media/deletion-outbox.ts` — `enqueueMediaDeletion(tx, keys, reason)` dan `MediaDeletionWorker`.
- `backend/src/ops/media-deletion-cli.ts` — visibilitas operasional (`npm run media:purge`, `--run`).
- `media.service.ts` — intent, verifikasi, dan signed access memakai adapter; signature HMAC untuk URL aplikasi tetap dipertahankan karena itu capability token aplikasi, bukan tanda tangan storage.
- `media.module.ts` — provider `OBJECT_STORAGE` + `MediaDeletionWorker`.
- Test: `backend/src/test/fake-storage.ts` hanya untuk unit test; `media.integration.test.ts` selalu memakai adapter S3 asli.

Bucket tetap privat; tidak ada ACL publik, tidak ada URL permanen.

## 4. SigV4 implementation

```ts
getSignedUrl(client, new PutObjectCommand({
  Bucket, Key, ContentType: contentType, IfNoneMatch: '*',
}), {
  expiresIn,
  signableHeaders: new Set(['content-type', 'if-none-match']),
})
```

- Klien SDK dibuat dengan `forcePathStyle` yang dapat dikonfigurasi (default `true`, cocok untuk MinIO/S3-compatible; AWS dapat mematikan lewat `MEDIA_S3_FORCE_PATH_STYLE=false`).
- `requestChecksumCalculation` dan `responseChecksumValidation` diset `WHEN_REQUIRED`; tanpa ini SDK menambahkan checksum fleksibel yang membuat presigned PUT gagal di server S3-compatible.
- `X-Amz-SignedHeaders` terverifikasi berisi `content-type;host;if-none-match`.
- Hasil uji nyata: `PUT` valid → 200; signature diubah → 403; `content-type` berbeda → 403; key dengan prefix pengguna lain → 403; `PUT` kedua ke key yang sama → 412.
- Download memakai `GetObjectCommand` presigned 60 detik; signature diubah → 403.

## 5. Upload verification

`POST /v1/media/uploads/{id}/complete` tidak menerima body. Urutan verifikasi:

1. Baris harus milik pemanggil (`owner_id = $2`), jika tidak → 404.
2. `ready` → 200 `duplicate: true` tanpa menyentuh storage.
3. Status selain `pending` → 409 `MEDIA_NOT_PENDING`.
4. `upload_expires_at` lewat → 410 `MEDIA_UPLOAD_EXPIRED`.
5. Checksum tersimpan hilang/format salah → 409 `MEDIA_CHECKSUM_MISSING`.
6. `HEAD` → objek tidak ada → 409 `MEDIA_OBJECT_MISSING` (baris tetap `pending`, dapat dicoba lagi).
7. `ContentLength` ≠ ukuran yang dijanjikan → baris `rejected`, 409 `MEDIA_SIZE_MISMATCH`.
8. `ContentType` ≠ MIME intent → `rejected`, 409 `MEDIA_CONTENT_MISMATCH`.
9. Stream dibaca; total byte melebihi ukuran → `rejected`; total byte kurang → `rejected`.
10. SHA-256 stream ≠ checksum intent → `rejected`, 409 `MEDIA_CHECKSUM_MISMATCH`.
11. Magic bytes tidak cocok → `rejected`, 409 `MEDIA_CONTENT_MISMATCH`.
12. `UPDATE ... SET status='ready' WHERE id=$1 AND status='pending' AND upload_expires_at > now()`; bila 0 baris, status dibaca ulang: `ready` → idempoten, selain itu 409.

Ukuran yang disimpan adalah jumlah byte yang benar-benar dibaca server, bukan angka dari klien. Cross-user completion dan GET menghasilkan 404.

## 6. Checksum validation

- Intent mewajibkan `checksumSha256` 64 karakter hex.
- Server menghitung SHA-256 atas stream objek; ETag tidak dipakai karena multipart upload dapat menghasilkan ETag non-SHA-256.
- Uji nyata: body 300 byte dengan satu byte diubah (panjang sama) → 409 `MEDIA_CHECKSUM_MISMATCH`.
- Uji unit: checksum salah, checksum hilang, dan ukuran salah semuanya ditolak tanpa membuat baris `ready`.

## 7. Object deletion worker

- Mengambil satu baris due dengan `FOR UPDATE SKIP LOCKED`, menaikkan `attempts`, dan menandainya `processing`.
- Baris `processing` yang lebih tua dari 10 menit dapat diklaim lagi, sehingga proses yang mati tidak mengunci antrean.
- `DeleteObject` idempoten untuk objek yang sudah hilang; setelah itu `HEAD` wajib mengembalikan `null`, jika tidak dianggap gagal.
- Sukses → `done` + `completed_at`. Gagal → `pending` dengan `next_attempt_at = now() + backoff * 2^(attempts-1)` (maks 3600 detik). Setelah `MEDIA_DELETION_MAX_ATTEMPTS` → `failed` (dead-letter) dengan `last_error`.
- `status()` mengembalikan hitungan `pending/processing/done/failed` untuk operator.

Uji nyata: 11 objek dihapus dan diverifikasi hilang; enqueue ganda hanya membuat satu baris; objek yang tidak pernah ada berakhir `done`; kegagalan yang diinjeksi pada adapter (delegasi ke S3 asli untuk percobaan kedua) menghasilkan `attempts=1`, lalu sukses setelah `next_attempt_at` dimajukan.

## 8. Outbox implementation

`media_deletion_outbox` (migrasi `0010_phase6_1.sql`):

- `id`, `object_key` (unik), `reason`, `status` (`pending|processing|done|failed`), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `updated_at`, `completed_at`.
- Enqueue terjadi **di dalam transaksi yang sama** dengan penghapusan metadata pada:
  - `PrivacyService.runDueDeletions` (penghapusan akun),
  - `SocialService.purgeSocialData`,
  - `AlbumsService.removeMedia` dan `removeAlbum`.
- `ON CONFLICT (object_key) DO NOTHING` membuat enqueue idempoten.
- Uji penghapusan akun membuktikan urutannya: baris media hilang, outbox `pending`, objek masih ada, worker menghapus, `HEAD` → null.

## 9. MinIO setup

MinIO **tidak dapat dipakai**. Bukti pada 26 November 2026:

- `https://dl.min.io/server/minio/release/windows-amd64/` → `410 Gone`, dengan teks: "The open-source MinIO Server, MinIO Client (mc) and MinIO KES projects are archived and no longer maintained... These files are no longer served from this site."
- `https://hub.docker.com/v2/repositories/minio/minio/tags` → `{"message":"object not found"}`.
- `quay.io` manifest tanpa kredensial → 401.

Pengganti: **SeaweedFS 4.55** (`weed server -s3`), server S3 nyata yang memvalidasi SigV4 dan mendukung path-style serta conditional PUT.

Setup lokal yang dipakai:

```bash
# unduh windows_amd64.zip dari https://github.com/seaweedfs/seaweedfs/releases/tag/4.55
cat > s3.json <<'JSON'
{"identities":[{"name":"rjtest","credentials":[{"accessKey":"rjtestaccess","secretKey":"rjtestsecret123"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
./weed.exe server -dir=./data -s3 -s3.port=8333 -s3.config=./s3.json -volume.max=50 -ip=127.0.0.1
```

Catatan operasional: tanpa `-volume.max` yang cukup, volume per koleksi bucket cepat habis dan `PUT` mengembalikan `InternalError: No writable volumes`. Ini masalah konfigurasi server uji, bukan aplikasi.

## 10. Test results

Perintah dan hasil nyata:

| Perintah | Hasil |
|---|---|
| `cd backend && npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `cd backend && npm test` | **51 test: 40 lulus, 0 gagal, 11 skipped** (integrasi tanpa storage) |
| `cd backend && npm run test:media` (SeaweedFS nyata) | **11 lulus, 0 gagal** |
| `cd admin && npm run build` | sukses |
| `node tools/junk-check.mjs` (dari `backend/`) | 0 baris mencurigakan pada 223 berkas |

Kasus integrasi yang dijalankan (semua terhadap objek nyata di bucket):

1. Presigned SigV4 + `HEAD` membuat media `ready`, download SigV4 mengembalikan byte identik.
2. Signature diubah, `content-type` salah, key pengguna lain → 403.
3. Intent kedaluwarsa → 410.
4. Objek tidak ada → 409 `MEDIA_OBJECT_MISSING`.
5. Panjang salah → 409 `MEDIA_SIZE_MISMATCH`.
6. Tipe/isi salah (magic bytes) → 409 `MEDIA_CONTENT_MISMATCH`.
7. Checksum salah → 409 `MEDIA_CHECKSUM_MISMATCH`.
8. Cross-user completion dan GET → 404.
9. Penyelesaian ganda → `duplicate: true`.
10. Unggahan ulang ke key yang sama → 412.
11. Hapus via outbox, enqueue ganda → satu baris, objek hilang.
12. Objek sudah hilang → `done`.
13. Kegagalan storage transien → retry lalu sukses.
14. Penghapusan akun → outbox → worker → byte hilang, baris media hilang.

Unit test lama yang berubah hanya karena kontrak baru: helper `uploadImage` kini mengirim checksum dan menaruh objek di fake storage, dan test album membandingkan `usedBytes` dengan nilai attach sebelumnya, bukan angka 11 yang berasal dari header 11 byte.

## 11. CI results

Job baru `media-integration` di `.github/workflows/ci.yml`:

- `npm ci`
- unduh SeaweedFS 4.55 `linux_amd64.tar.gz`, jalankan `weed server -s3` pada port 8333 dengan identitas uji,
- tunggu sampai port menjawab 403 (auth aktif),
- `npm run test:media` dengan env `MEDIA_S3_*`.

Status run CI terakhir untuk commit ini dicatat di bagian akhir laporan setelah push. Job ini belum pernah dijalankan sebelumnya.

## 12. Security findings

Ditutup:

- Bucket privat; tidak ada kredensial storage di klien atau repositori.
- Key objek sepenuhnya server-generated; tidak ada input path dari klien.
- Presigned PUT mengikat tipe konten dan menolak overwrite.
- Ukuran, tipe, dan checksum diverifikasi dari objek nyata; klien tidak dapat menandai media `ready` dengan metadata palsu.
- Penyelesaian atomik mencegah dua permintaan menyelesaikan aset yang sama dengan hasil berbeda.
- Penghapusan objek diaudit lewat outbox dan diverifikasi, bukan diasumsikan.

Terbuka / belum diverifikasi:

- **P1** Tidak ada pembersihan otomatis untuk intent `pending` yang ditinggalkan; objek yatim bisa menumpuk (butuh lifecycle rule atau sweep).
- **P1** Tidak ada pemindaian malware/CSAM pada objek yang sudah `ready`; verifikasi hanya membuktikan tipe dan integritas, bukan keamanan isi.
- **P1** Kredensial storage masih berupa access key statis di environment; IAM role/STS belum dipakai.
- **P2** `downloadUrl` diterbitkan oleh endpoint yang tidak terautentikasi (signature aplikasi adalah capability). Masa berlaku 60 detik membatasi, tetapi URL dapat dibagikan selama jendela itu.
- Bucket policy AWS (Block Public Access, TLS-only, enkripsi) belum diuji.

## 13. Files changed

Baru:

- `backend/src/media/object-storage.ts`
- `backend/src/media/deletion-outbox.ts`
- `backend/src/ops/media-deletion-cli.ts`
- `backend/migrations/0010_phase6_1.sql`
- `backend/src/test/fake-storage.ts`
- `backend/src/test/media.integration.test.ts`
- `PHASE_6_1_REPORT.md`

Diubah:

- `backend/src/media/media.service.ts`, `media.controller.ts`, `media.dto.ts`, `media.module.ts`
- `backend/src/config/env.ts`
- `backend/src/ops/privacy.service.ts`, `backend/src/social/social.service.ts`, `backend/src/albums/albums.service.ts`
- `backend/src/test/app.factory.ts`, `phase4.helpers.ts`, `phase4.replay.test.ts`, `phase4.social.test.ts`, `api.test.ts`, `phase2.test.ts`, `phase4.test.ts`
- `backend/package.json`, `backend/package-lock.json` (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, skrip `media:purge`, `test:media`)
- `.github/workflows/ci.yml`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/PRODUCTION_READINESS.md`, `docs/TEST_PLAN.md`, `docs/REQUIREMENTS_MATRIX.md`

## 14. Migration changes

`0010_phase6_1.sql`:

1. Tabel `media_deletion_outbox` + unique index `object_key` + index `(status, next_attempt_at)`.
2. `media_assets_size_bytes_check` diganti: dari maksimum 5 MB untuk semua aset menjadi maksimum 100 MB absolut. Batas per tujuan tetap ditegakkan aplikasi (5 MB foto, 100 MB video). Tanpa perubahan ini, intent video > 5 MB gagal di database.

Tidak ada kolom yang dihapus dan tidak ada data yang diubah. Semua test bootstrap memverifikasi urutan migrasi sampai `0010_phase6_1.sql`.

## 15. Known limitations

- MinIO tidak tersedia; verifikasi memakai SeaweedFS.
- Verifikasi checksum membaca seluruh objek sekali lagi (GET stream). Untuk video 100 MB ini menambah egress dan waktu completion; alternatifnya checksum dari storage yang tidak universal.
- `complete` dapat dipanggil berulang saat objek masih `pending` dan akan mengulang verifikasi penuh.
- Worker dijalankan manual/CLI; belum ada scheduler di dalam proses aplikasi.
- Tidak ada lifecycle untuk objek `pending` yatim.
- Tidak ada antivirus/CSAM scanning.
- Android belum memakai kontrak baru.

## 16. Production AWS blockers

- Tidak ada akun, bucket, atau kredensial AWS untuk verifikasi nyata.
- Bucket policy produksi (Block Public Access, TLS-only, enkripsi default, versioning) belum diterapkan atau diuji.
- IAM least-privilege (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:HeadObject` pada prefix `media/*`) belum dibuat; kode memakai access key statis.
- Perilaku `If-None-Match` pada `PutObject` AWS perlu diuji pada bucket nyata; SeaweedFS mendukungnya, dan AWS S3 mendukung conditional writes, tetapi ini belum dibuktikan di akun ini.
- Biaya egress verifikasi (GET penuh per completion) belum diukur pada volume produksi.

## 17. Acceptance checklist

| Kriteria | Status | Bukti |
|---|---|---|
| Canonical AWS SigV4 works with MinIO | BLOCKED | MinIO tidak lagi didistribusikan; SigV4 diverifikasi dengan SeaweedFS (server S3 nyata) |
| Valid upload intent is created | PASS | Test integrasi & unit |
| Upload ownership is enforced | PASS | Completion/GET pengguna lain → 404 |
| Object HEAD verification works | PASS | `HEAD` diuji untuk ada/tidak ada/panjang/tipe |
| Actual object size is verified | PASS | `MEDIA_SIZE_MISMATCH` |
| Actual content type is validated | PASS | 403 pada PUT, 409 pada magic/tipe |
| SHA-256 checksum is verified | PASS | `MEDIA_CHECKSUM_MISMATCH` |
| Invalid completion is rejected | PASS | 409/410 untuk semua kasus |
| Duplicate completion is idempotent | PASS | `duplicate: true`, satu baris `ready` |
| Object deletion worker works | PASS | Objek diverifikasi hilang |
| Outbox retry works | PASS | Backoff, attempts, lalu sukses |
| Missing object deletion is handled | PASS | `done` |
| Account media purge is validated | PASS | Outbox → worker → `HEAD` null |
| MinIO integration tests pass | BLOCKED | Diganti SeaweedFS; lihat bagian 9 |
| GitHub Actions executes MinIO tests | BLOCKED | Job menjalankan uji S3-compatible, bukan MinIO; hasil dicatat di bagian 11 |
| Existing backend tests remain green | PASS | 40 lulus, 0 gagal |
| Documentation reflects actual behavior | PASS | README + 6 dokumen diperbarui |
| AWS production integration verified | BLOCKED | Tidak ada akun/bucket AWS |

## 18. Recommended next phase

1. **Lifecycle objek `pending`**: sweep intent kedaluwarsa dan enqueue penghapusan, agar unggahan yang ditinggalkan tidak menjadi byte yatim.
2. **Verifikasi AWS nyata** dengan bucket privat, IAM least-privilege, dan uji `If-None-Match` serta checksum pada AWS.
3. **Scheduler worker**: jalankan `MediaDeletionWorker` periodik di proses aplikasi atau cron, dengan metrik dead-letter.
4. **Pemindaian isi** (malware/CSAM) sebelum media boleh tampil, serta kuota per pengguna.
5. **Klien Android** untuk kontrak baru (checksum, header wajib), dengan progres unggah dan retry.

Jangan menaikkan status MinIO atau AWS menjadi PASS tanpa lingkungan nyata yang dapat dijalankan ulang.
