# PHASE 6.2 REPORT — Storage Lifecycle & Android Media Integration

Tanggal: 27 November 2026
Repo: `29nls/RiderJourney`, branch `main`
Lingkup: Phase 6.2 saja. Tidak ada phase berikutnya yang dikerjakan, tidak ada
production deployment, dan tidak ada fitur berbayar yang diaktifkan.

Status ringkas: **19 dari 29 kriteria PASS, 10 BLOCKED, 0 FAIL.**

Delapan butir berstatus PASS pada implementasi tetapi BLOCKED pada verifikasi
(butuh perangkat, provider, atau kredensial AWS); butir itu dihitung sebagai
BLOCKED.

---

## 1. Executive summary

Phase 6.1 membangun pipeline media (S3ObjectStorage, SigV4, upload intent,
verifikasi HEAD + SHA-256, transactional outbox). Phase 6.1 meninggalkan dua
lubang: upload yang tidak pernah diselesaikan tidak pernah dibersihkan, dan
worker penghapusan hanya dapat dijalankan manual lewat CLI. Android sama sekali
belum memakai pipeline itu.

Phase 6.2 menutup keduanya tanpa menulis ulang apa pun dari 6.1:

1. **Pembersihan upload kedaluwarsa.** `UploadCleanupService` memeriksa objek
   dengan `HEAD` sebelum membuka transaksi, lalu memindahkan baris `pending` yang
   lewat jendela unggah ke `expired` lewat CAS yang juga menjaga `object_key`,
   dan meng-enqueue penghapusan objek orphan di transaksi yang sama.
2. **Worker terjadwal.** `MediaDeletionWorker.startScheduled()` sekarang
   dijalankan dari `main.ts` dengan `FOR UPDATE SKIP LOCKED`, lease 10 menit,
   backoff eksponensial, dead-letter, health report, dan graceful shutdown.
3. **Kuota penyimpanan.** Tabel `storage_quotas` menyimpan kuota dan reservasi;
   `used_bytes` selalu diturunkan dari media `ready`, sehingga tidak ada
   pembukuan kedua yang bisa menyimpang. Reservasi memakai satu UPDATE bersyarat
   yang menolak permintaan yang tidak muat.
4. **Android.** `MediaRepository` melakukan intent → presigned PUT → complete
   dengan `clientMediaId` yang stabil, checksum SHA-256 streaming, state di Room,
   retry WorkManager, serta avatar profil dan foto kendaraan.

Verifikasi yang benar-benar dijalankan:

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run typecheck` (backend) | bersih |
| `npm run build` (backend) | bersih |
| `node --test "dist/test/*.test.js"` | 69 test, 58 pass, 0 fail, 11 skip |
| `node tools/junk-check.mjs` | 0 baris mencurigakan |
| Gradle `lintDebug testDebugUnitTest assembleDebug` | BUILD SUCCESSFUL, 0 lint error, 22 unit test lulus |
| Admin `npm run build` | bersih (Next.js build, 5 rute) |

Yang **tidak** diverifikasi: AWS nyata (S3/IAM/STS/SSE), provider
antivirus/moderation, emulator/instrumented test, dan job CI (belum dijalankan
di GitHub; hasil di atas berasal dari mesin lokal).

---

## 2. Baseline audit

Audit dilakukan pada source aktual, bukan pada laporan fase sebelumnya.

**Yang dipertahankan tanpa perubahan arsitektur**

- `S3ObjectStorage` + SigV4 (`backend/src/media/object-storage.ts`).
- Verifikasi `complete()`: HEAD → panjang → content type → SHA-256 streamed →
  magic bytes.
- `enqueueMediaDeletion` sebagai transactional outbox.
- SeaweedFS 4.55 sebagai environment integrasi.
- Migrasi 0011 (`media_assets` status `expired`, `scan_status`, `storage_quotas`,
  `vehicles.photo_media_id`, `users.avatar_media_id`).

**Temuan audit**

| Temuan | Dampak | Tindakan |
| --- | --- | --- |
| Intent `pending` tanpa objek tidak pernah dibersihkan | Objek orphan menumpuk; reservasi kuota tidak pernah dilepas | Dibuat `UploadCleanupService` |
| Worker penghapusan hanya CLI | Tidak ada eksekusi periodik di deployment | `startScheduled()` dari `main.ts` |
| Klaim job memakai `SKIP LOCKED` tetapi belum ada lease reclaim | Job bisa macet selamanya bila proses mati | Lease 10 menit + test |
| Tidak ada kuota per pengguna | Satu akun dapat memenuhi bucket | `StorageQuotaService` + migrasi |
| `signGet` menerbitkan capability URL | Perlu audit otorisasi/expiry | Diverifikasi + test |
| `MediaUploadRequest` mengirim header persis | Benar, tetapi belum ada test | Ditambah unit test |
| Android memanggil Room dari callback PUT | **Compile error** (suspending call di non-suspend lambda) | Diperbaiki |
| `HazardViewModel` membaca `lastLocation` tanpa penanganan `SecurityException` | Lint error `MissingPermission`, build CI gagal | Diperbaiki |

Tidak ditemukan bug pada verifikasi `complete()`, pada outbox, atau pada
perhitungan checksum; bagian itu tidak disentuh.

---

## 3. Expired upload cleanup

**Implementasi** — `backend/src/media/upload-cleanup.ts`

```
SELECT id, object_key, owner_id, size_bytes
FROM media_assets
WHERE status = 'pending' AND upload_expires_at <= now()
ORDER BY upload_expires_at ASC LIMIT $1
```

Untuk setiap baris:

1. `storage.head(object_key)` **di luar transaksi**. Kegagalan HEAD melewati
   baris tersebut; baris tetap `pending` dan dicoba lagi pada putaran berikutnya
   (objek tidak hilang diam-diam).
2. Transaksi tunggal:
   ```sql
   UPDATE media_assets SET status = 'expired'
   WHERE id = $1 AND status = 'pending' AND object_key = $2
     AND upload_expires_at <= now()
   RETURNING id
   ```
   `object_key` ikut dijaga karena retry klien dapat me-re-*arm* baris yang sama
   dengan key baru; hasil HEAD yang basi tidak boleh meng-expire intent baru.
   Bila objek ada, `enqueueMediaDeletion(tx, [key], 'expired_upload')` berjalan
   di transaksi yang sama.
3. Setelah commit, `releaseReservation(owner_id, size_bytes)`.

**Idempotensi.** CAS membuat baris yang sudah `expired` tidak cocok lagi, dan
`media_deletion_outbox` memiliki `ON CONFLICT (object_key) DO NOTHING`.

**Media `ready` tidak tersentuh.** Query hanya memilih `status = 'pending'`.

**Transaksi tidak menahan streaming.** HEAD dan (nanti di worker) delete terjadi
di luar transaksi; transaksi hanya berisi dua statement pendek.

Status: **PASS** + 3 test.

---

## 4. Scheduled deletion worker

**Implementasi** — `backend/src/media/deletion-outbox.ts`, `backend/src/main.ts`

| Persyaratan | Implementasi |
| --- | --- |
| Eksekusi periodik | `startScheduled(pollSeconds, batchSize)` dari `main.ts` bila storage lengkap |
| Konkurensi aman | `FOR UPDATE SKIP LOCKED` pada sub-select klaim |
| Multi-instance | Klaim per baris; tidak ada state proses bersama |
| Graceful shutdown | `stopScheduled()` menandai `stopping`, menunggu batch (maks 30 s) |
| Retry + backoff | `min(base * 2^(attempts-1), 3600)` detik |
| Dead-letter | `status = 'failed'` setelah `MEDIA_DELETION_MAX_ATTEMPTS`, `last_error` disimpan |
| Health | `status()`: `pending`, `processing`, `done`, `failed`, `nextAttemptAt`, `scheduled`, `running`, `lastRunAt`, `lastResult` |
| Batch size | `MEDIA_DELETION_BATCH_SIZE` (default 20) |
| Poll interval | `MEDIA_DELETION_POLL_SECONDS` (default 60) |

Worker juga memverifikasi hasil: setelah `delete`, `head` dipanggil lagi dan job
dianggap sukses hanya bila objek benar-benar hilang. Bila tidak, job di-retry.

CLI `npm run media:purge` tetap ada untuk inspeksi manual.

Status: **PASS** + 3 test (scheduler, dua instance, reclaim, dead-letter).

---

## 5. Storage quota

**Implementasi** — `backend/src/media/storage-quota.ts`, migrasi `0011`

- `storage_quotas(user_id PK, quota_bytes, used_bytes, reserved_bytes, updated_at)`.
- `used_bytes` **tidak pernah ditulis manual**: nilainya selalu
  `SUM(media_assets.size_bytes) WHERE status='ready'` pada saat dibaca. Baris
  `used_bytes` di tabel disimpan untuk kompatibilitas skema tetapi bukan sumber
  kebenaran.
- `reserveUpload` memakai satu UPDATE bersyarat:
  ```sql
  UPDATE storage_quotas q SET reserved_bytes = reserved_bytes + $2
  WHERE q.user_id = $1
    AND (SELECT SUM(size_bytes) FROM media_assets ... status='ready') + q.reserved_bytes + $2 <= q.quota_bytes
  ```
  Hanya permintaan yang muat yang berhasil; sisanya nol baris →
  `409 STORAGE_QUOTA_EXCEEDED`. Tidak ada read-then-write race.
- `commitUpload` melepas reservasi setelah `complete` sukses (ruang menjadi
  `used` karena baris berubah ke `ready`).
- `releaseReservation` dipanggil saat reject, expire, dan gagal; memakai
  `GREATEST(0, ...)`, jadi aman dipanggil dua kali.
- `reconcile(userId)` menghitung ulang `reserved_bytes` dari baris `pending`.

Ukuran yang dipercaya selalu berasal dari server: `complete()` memakai panjang
objek hasil HEAD, bukan `sizeBytes` klien.

Status: **PASS** + 2 test (6 intent paralel pada kuota 25 MB; rekonsiliasi).

---

## 6. Download security

| Pertanyaan audit | Jawaban |
| --- | --- |
| Endpoint butuh autentikasi? | `/v1/media/:id/url` **ya**. `/access` **tidak** — capability URL, sesuai desain |
| Ownership divalidasi? | `accessible()` dijalankan sebelum URL diterbitkan |
| Visibility ditentukan bagaimana? | `owner` atau post published dengan audience (`public`/`followers`/`community`), album dengan visibility, trip dengan `shared_with`, atau purpose bersama (`avatar`, `community_logo`, `community_cover`, `vehicle_photo`, `hazard_photo`, `poster`) |
| Capability URL dapat dibagikan? | Ya, sampai `expires` (default 300 s). Ini diterima: URL hanya berlaku untuk satu media |
| URL bocor lewat log? | Logger request mencatat `path` tanpa query string |
| Expiration ditegakkan? | `401 SIGNED_URL_EXPIRED` bila `expires*1000 <= now()`; presigned GET turunan hanya 60 s |

Tanda tangan adalah `HMAC-SHA256(secret, id + '.' + expires)`, dibandingkan
dengan `timingSafeEqual`, sehingga signature untuk media lain tidak berlaku.
Baris harus `status='ready'`, jadi media yang sudah dihapus berhenti dapat
diakses meski signature belum kedaluwarsa.

Endpoint mengembalikan `Cache-Control: private, max-age=60` dan
`Referrer-Policy: no-referrer`.

Status: **PASS** + 4 test (lintas media, kedaluwarsa, non-owner, anonim).

---

## 7. Media scanning architecture

`backend/src/media/media-scanner.ts` mendefinisikan:

```ts
interface MediaScanner {
  scan(objectKey: string, mimeType: string): Promise<ScanResult>;
  available(): boolean;
}
```

`ScanResult.status` mencakup `clean | quarantined | scan_failed`, dan migrasi
0011 menambahkan `scan_status` (`unscanned | clean | quarantined | scan_failed`)
serta `scanned_at`.

Yang **tidak** dikerjakan: tidak ada provider malware/CSAM/moderation yang
terhubung. `NoOpMediaScanner.available()` mengembalikan `false` dan
`scan()` mengembalikan `scan_failed`, sehingga media tetap `unscanned`. Media
tidak pernah ditandai `clean` tanpa pemindaian nyata, dan tidak ada alur
quarantine yang aktif.

Status: **PASS untuk interface**, **BLOCKED untuk integrasi provider**.

---

## 8. Android media architecture

Posisi komponen di `android/app/src/main/java/id/riderjourney/app/`:

```
data/MediaRepository.kt      intent → PUT → complete, signed URL, image cache
data/MediaChecksum.kt        SHA-256 & byte count streaming (bebas tipe Android)
data/MediaUploadRequest.kt   request PUT dengan header persis
data/local/MediaUpload*.kt   entity + DAO Room untuk state upload
work/MediaUploadWorker.kt    retry background (hilt-work + WorkManager)
data/api/NetworkModule.kt    OkHttp tanpa auth interceptor untuk storage
ui/MediaImage.kt             pemuat gambar dari signed URL
```

Keputusan yang mengikat:

- **Dua OkHttp client.** Client API punya auth interceptor; client storage
  (`@Named("storage")`) tidak punya dan tidak punya `TokenAuthenticator`,
  sehingga tidak ada header tak bertanda tangan yang merusak SigV4.
- **Tidak memakai Coil.** `loadImage` memakai OkHttp + `BitmapFactory` +
  `LruCache(12)`; signed URL selalu dimintakan ulang saat cache miss, sehingga
  URL kedaluwarsa tidak pernah dipakai ulang.
- **checksum dihitung dari file**, bukan dari metadata provider.

Tidak ada endpoint baru yang dibuat untuk Android.

---

## 9. Android integration details

| Alur | Implementasi |
| --- | --- |
| Upload intent | `POST /v1/media/uploads` dengan `purpose`, `contentType`, `sizeBytes`, `clientMediaId`, `checksumSha256` |
| Presigned PUT | `MediaUploadRequest.build()` — hanya `Content-Type` dan `If-None-Match: *` |
| Completion | `api.completeUpload(intent.id)` **tanpa body**, sesuai kontrak |
| Signed URL | `getSignedUrl` → `resolveDownloadUrl` memecah `expires`/`signature` lalu memanggil `/access` |
| Avatar | `ProfileScreen`/`SessionViewModel` mengunggah dengan purpose `avatar`, lalu `PATCH /v1/me` |
| Foto kendaraan | `GarageScreen`/`GarageViewModel` mengunggah dengan purpose `vehicle_photo` lalu menyimpan `photoMediaId` |
| Tampilan | `MediaImage` menampilkan loading/error; akses ditolak menjadi pesan galat, bukan crash |

Kontrak backend vs Android telah dicocokkan dengan controller aktual
(`media.controller.ts`), DTO (`media.dto.ts`), dan `media.service.ts`; tidak ada
bentuk response yang ditebak.

---

## 10. Upload lifecycle

```
idle → preparing → uploading → completing → ready
                       ↘ failed → (retry) → preparing
                       ↘ expired → (retry, clientMediaId sama) → preparing
                       ↘ cancelled
```

- **Progress.** Callback per chunk (0.1 → 0.8) dilaporkan ke UI. Room menyimpan
  fase (0.1 sebelum PUT, 0.85 saat completing, 1.0 saat ready), bukan setiap
  tick.
- **Duplicate prevention.** `clientMediaId` dibuat sekali per upload dan dipakai
  ulang pada retry; indeks unik `(owner_id, client_media_id)` mencegah baris
  ganda.
- **URL kedaluwarsa.** Retry **selalu** meminta intent baru. URL lama tidak
  pernah dipakai ulang; `needsNewIntent(expiresAt, now, margin = 60 s)` menjadi
  sinyal untuk re-issue.
- **Recovery.** `MediaUploadWorker` (WorkManager, `NetworkType.CONNECTED`,
  backoff eksponensial 30 s) memindai `pendingUploads()` dari Room; state
  bertahan setelah proses mati.
- **Pembatalan.** `cancel()` menandai `cancelled`; worker melewati baris itu.
- **Retry cap.** Maksimum 3 percobaan per upload.

Status: **PASS**; batasan progress di Room dijelaskan di bagian 16.

---

## 11. API changes

Tidak ada endpoint baru. Perubahan yang terlihat oleh klien:

| Endpoint | Perubahan |
| --- | --- |
| `POST /v1/media/uploads` | Intent `expired` di-re-arm dengan **object key baru**; `pending` memakai key lama dengan jendela diperpanjang |
| `POST /v1/media/uploads/{id}/complete` | `410 MEDIA_UPLOAD_EXPIRED` untuk jendela lewat; tidak menerima body |
| `GET /v1/media/{id}/url` | Otorisasi berbasis visibility; `404` bila tidak berhak |
| `GET /v1/media/{id}/access` | Hanya mengembalikan presigned GET 60 s; header cache diperketat |
| `GET /v1/media/quota` | `quotaBytes`, `usedBytes`, `reservedBytes`, `availableBytes` |

Kode error yang dipakai: `STORAGE_QUOTA_EXCEEDED`, `MEDIA_TOO_LARGE`,
`MEDIA_TYPE_UNSUPPORTED`, `MEDIA_RATE_LIMITED`, `MEDIA_UNAVAILABLE`,
`MEDIA_NOT_FOUND`, `MEDIA_NOT_PENDING`, `MEDIA_UPLOAD_EXPIRED`,
`MEDIA_OBJECT_MISSING`, `MEDIA_SIZE_MISMATCH`, `MEDIA_CONTENT_MISMATCH`,
`MEDIA_CHECKSUM_MISMATCH`, `MEDIA_CHECKSUM_MISSING`, `SIGNED_URL_EXPIRED`,
`SIGNED_URL_INVALID`.

`docs/API_CONTRACT.md` diperbarui dengan bentuk response dan kode error di atas.

---

## 12. Migration changes

`backend/migrations/0011_phase6_2.sql`:

1. `media_assets_purpose_check` diperluas dengan `vehicle_photo`.
2. `media_assets_status_check` menerima `expired`.
3. `scan_status` + `scanned_at` pada `media_assets`.
4. `users.avatar_media_id`, `vehicles.photo_media_id` (uuid, nullable).
5. Tabel `storage_quotas` (PK `user_id`, FK cascade, check non-negatif).
6. Index parsial `media_assets_expired_pending_idx` pada `upload_expires_at`
   untuk `status='pending'`.

Migrasi bersifat aditif dan idempoten (`IF NOT EXISTS`, `DROP CONSTRAINT IF
EXISTS`). Setiap suite test membuat PGlite kosong lalu menjalankan
`runMigrations`, sehingga migrasi yang rusak menggagalkan test.

Status: **PASS**.

---

## 13. Test results

**Backend — seluruh suite** (`node --test "dist/test/*.test.js"`):

```
tests 69   pass 58   fail 0   skipped 11
```

11 test yang di-skip adalah suite integrasi SeaweedFS yang hanya berjalan dengan
`MEDIA_S3_INTEGRATION=1` (dijalankan di job CI `media-integration`).
Baseline sebelum Phase 6.2: 51 test (40 pass, 11 skip). Tambahan: **18 test**.

**Backend — suite baru** `src/test/phase6_2.test.ts` (18 test, semua lulus):

1. Intent kedaluwarsa dengan objek orphan → `expired`, 1 job outbox, reservasi dilepas.
2. Intent kedaluwarsa tanpa objek → `expired`, 0 job.
3. Cleanup tidak menyentuh media `ready`.
4. Race completion vs expiration → hanya penolakan, satu job.
5. Completion setelah worker menghapus objek → `409 MEDIA_OBJECT_MISSING`.
6. Worker terjadwal berjalan dan berhenti.
7. Dua instance worker tidak menghapus job yang sama dua kali.
8. Job yang ditinggal proses mati diklaim ulang setelah lease.
9. Job yang selalu gagal menjadi dead-letter.
10. Enam intent paralel tidak melewati kuota.
11. Rekonsiliasi memperbaiki reservasi yang menyimpang.
12. Signed GET terikat media, pemegang kunci, dan expiry.
13. Signed URL kedaluwarsa ditolak.
14. Viewer tanpa hak tidak dapat membuat signed URL.
15. Media purpose bersama (avatar) tetap terbaca pengguna lain.
16. Completion memakai objek tersimpan, bukan checksum klien.
17. Content type tidak cocok ditolak.
18. Endpoint kuota melaporkan `usedBytes` turunan.

**Android**

```
./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug
BUILD SUCCESSFUL in 4m 36s
lint: 0 errors, 36 warnings
unit tests: 22 test, 0 gagal
  MediaChecksumTest 6 · GpsFilterTest 8 · TripStateMachineTest 6 · ChatMergeTest 2
app-debug.apk dihasilkan (60 MB)
```

`MediaChecksumTest` menutup SHA-256 (vektor `abc`, payload lebih besar dari
buffer, input kosong), `countBytes`, `needsNewIntent`, dan header presigned PUT.

**Tidak dijalankan:** SeaweedFS lokal, emulator/instrumented test, AWS nyata.

---

## 14. CI results

`.github/workflows/ci.yml` diperluas tanpa menghapus job lama:

| Job | Isi |
| --- | --- |
| `backend` | `npm ci` → audit → **typecheck** → **build** → **unit + migration tests** → `junk-check` |
| `admin` | `npm ci` → audit → `npm run build` |
| `android` | JDK 21 → **`lintDebug testDebugUnitTest assembleDebug`** → unggah laporan lint |
| `media-integration` | SeaweedFS 4.55 → `npm run test:media` dengan env storage |

- Tidak ada production secret. Nilai `PLATE_ENCRYPTION_KEY` dan `AUTH_JWT_SECRET`
  adalah placeholder test yang memang sudah dipakai job lama.
- `MEDIA_S3_*` pada job `backend` adalah placeholder agar `assertStorage()` tidak
  menolak; tidak ada koneksi jaringan.
- Migration test tercakup: setiap suite menjalankan `runMigrations` dari database
  kosong.

**Status CI: BLOCKED** — workflow belum dijalankan di GitHub pada perubahan ini.
Semua langkahnya sudah dijalankan secara lokal, kecuali job SeaweedFS
(`media-integration`) yang tidak dapat dijalankan di mesin ini.

Admin build lokal: `npm run build` berhasil (`EXIT=0`, 5 rute ter-render).

---

## 15. Security findings

| Temuan | Tingkat | Status |
| --- | --- | --- |
| Kredensial storage statis, belum IAM/STS least privilege | Tinggi untuk production | **BLOCKED** — didokumentasikan di `SECURITY_AND_PRIVACY.md` §19.1 |
| Bucket policy, TLS-only, SSE belum diterapkan/diuji | Tinggi untuk production | **BLOCKED** |
| Capability URL dapat dibagikan sampai `expires` | Rendah (by design) | Diterima; TTL 300 s, presigned GET 60 s |
| Media belum dipindai malware/CSAM | Sedang | **BLOCKED** — `NoOpMediaScanner`, media tetap `unscanned` |
| Tidak ada endpoint DELETE media; avatar lama tetap `ready` dan memakan kuota | Sedang | Known limitation |
| `used_bytes` kolom tabel tidak dipakai sebagai sumber kebenaran | — | Dikurangi risikonya: selalu diturunkan dari `media_assets` |
| Log tidak memuat query string capability URL | Rendah | Diverifikasi dari logger request |

Perbaikan yang dilakukan selama Phase 6.2: penanganan `SecurityException` pada
pembacaan lokasi terakhir (temuan lint `MissingPermission`), dan penghapusan
pemanggilan Room yang bersifat suspending dari callback tulis OkHttp.

---

## 16. Known limitations

1. **Progress upload di Room bersifat per fase**, bukan per chunk: Room mencatat
   0.1 / 0.85 / 1.0. Progress per byte hanya ada di memori (UI). Alasannya,
   callback tulis OkHttp berjalan di thread blocking tempat pemanggilan
   suspending tidak diizinkan.
2. **Tidak ada endpoint penghapusan media.** Mengganti avatar atau foto kendaraan
   meninggalkan aset lama berstatus `ready` yang tetap dihitung pada kuota.
3. **`used_bytes` pada tabel `storage_quotas` tidak dipakai**; nilainya selalu
   diturunkan. Kolom itu dipertahankan agar skema tidak berubah dua kali.
4. **Pembersihan bergantung pada `upload_expires_at`**; intent lama dari sebelum
   migrasi 0011 yang tidak memiliki nilai itu tidak akan pernah dibersihkan.
5. **Worker hanya jalan bila storage terkonfigurasi penuh.** Tanpa
   `MEDIA_S3_*`, tidak ada pembersihan otomatis.
6. **Android hanya mengunggah gambar.** Video (MP4/WebM) didukung backend tetapi
   belum ada alur unggah video di aplikasi.
7. **Tidak ada UI pemilihan progress/retry manual yang lengkap**; retry terjadi
   otomatis lewat WorkManager dan tombol ulangi per layar.
8. **SeaweedFS bukan AWS.** Kecocokan perilaku S3 (khususnya `If-None-Match` dan
   presigned GET) belum diverifikasi pada AWS.

---

## 17. Production blockers

1. **Kredensial storage.** Ganti kredensial statis dengan IAM least privilege
   (atau STS/role), aktifkan bucket policy yang menolak akses anonim dan
   `aws:SecureTransport = false`, dan aktifkan SSE.
2. **Pengujian terhadap AWS nyata.** Presigned PUT/GET, `If-None-Match`, dan
   penghapusan harus diverifikasi pada bucket AWS, bukan hanya SeaweedFS.
3. **Provider scanning/moderation.** Tanpa provider, media publik tidak boleh
   dianggap aman. Perlu keputusan produk: tahan media `unscanned` atau terima
   risiko dengan pelaporan pengguna.
4. **Job CI belum dijalankan** pada perubahan ini (khususnya `media-integration`).
5. **Monitoring worker.** `status()` tersedia sebagai method, tetapi belum
   diekspos sebagai endpoint health atau metrik; dead-letter hanya terlihat lewat
   `npm run media:purge`.
6. **Endpoint penghapusan media** belum ada, sehingga kuota tidak dapat
   dikembalikan oleh pengguna.

---

## 18. Acceptance checklist

### Storage

| Kriteria | Status |
| --- | --- |
| Expired upload intents terdeteksi | **PASS** |
| Orphan objects dibersihkan | **PASS** |
| Complete/expiration race aman | **PASS** |
| Deletion worker berjalan periodik | **PASS** |
| Multi-instance worker aman | **PASS** |
| Dead-letter dapat dimonitor | **PASS** |
| Storage quota konsisten | **PASS** |
| Download authorization tervalidasi | **PASS** |
| Credential strategy terdokumentasi | **PASS** (dokumentasi) / **BLOCKED** (penerapan IAM/STS) |
| Media scanning limitations terdokumentasi | **PASS** (dokumentasi) / **BLOCKED** (provider) |

### Android

| Kriteria | Status |
| --- | --- |
| Media upload menggunakan backend aktual | **PASS** |
| SHA-256 dihitung dari file | **PASS** |
| Signed headers dikirim dengan benar | **PASS** |
| Upload completion berhasil | **PASS** (kompilasi + unit test; belum dijalankan di perangkat) |
| Upload progress berfungsi | **PASS** (callback UI; persistensi per fase) |
| Retry aman dan idempotent | **PASS** |
| Expired URL dapat dipulihkan | **PASS** |
| State upload dipulihkan dari Room | **PASS** (kode + DAO; belum diuji dengan proses mati nyata) |
| Avatar upload berfungsi | **PASS** (kode + build) / **BLOCKED** (verifikasi perangkat) |
| Vehicle photo upload berfungsi | **PASS** (kode + build) / **BLOCKED** (verifikasi perangkat) |
| Media preview berfungsi | **PASS** (kode + build) / **BLOCKED** (verifikasi perangkat) |
| Media access mengikuti authorization | **PASS** |

### Quality

| Kriteria | Status |
| --- | --- |
| Backend tests lulus | **PASS** — 69 test, 0 fail |
| Android tests lulus | **PASS** — 22 test, 0 fail |
| Storage integration tests lulus | **BLOCKED** — butuh server S3-compatible; dijalankan di CI |
| Android debug build lulus | **PASS** — `app-debug.apk` 60 MB |
| Admin build lulus | **PASS** — `npm run build` EXIT=0 |
| CI seluruhnya hijau | **BLOCKED** — workflow belum dijalankan di GitHub |
| Dokumentasi diperbarui | **PASS** — 7 dokumen + README |

Perhitungan: 29 butir → 19 PASS, 10 BLOCKED, 0 FAIL. Butir yang lolos pada
implementasi tetapi belum dapat diverifikasi (perangkat, provider scanning,
kredensial AWS, job CI) dihitung BLOCKED, bukan PASS.

---

## 19. Recommended next phase

Tidak dikerjakan pada Phase 6.2. Urutan yang disarankan:

1. **Media deletion endpoint + kuota kembali.** `DELETE /v1/media/{id}` yang
   memindahkan status dan meng-enqueue outbox dalam satu transaksi memakai
   mekanisme yang sudah ada. Ini menutup known limitation nomor 2 dan membuat
   kuota dapat dikelola pengguna.
2. **Worker health endpoint.** Ekspos `MediaDeletionWorker.status()` dan
   `UploadCleanupService.status()` lewat endpoint admin read-only agar
   dead-letter terlihat tanpa CLI.
3. **Provider scanning.** Pilih provider malware/moderation, implementasikan
   `MediaScanner` nyata, dan aktifkan alur `quarantined` → `clean` sebelum media
   tampil di feed publik.
4. **Pengerasan storage production.** IAM least privilege / STS, bucket policy
   TLS-only, SSE, rotasi kredensial, lalu jalankan suite integrasi terhadap AWS
   nyata.
5. **Unggah video di Android**, memakai `MediaChecksum` streaming yang sudah ada
   (batas 100 MB sudah ditangani di backend dan klien).
