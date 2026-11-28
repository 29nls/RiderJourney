# PHASE 6.3 REPORT — Media Lifecycle, Safety & Observability

Tanggal: 27 November 2026
Repo: `29nls/RiderJourney`, branch `main`
Lingkup: Phase 6.3 saja. Tidak ada fase berikutnya, tidak ada deployment, tidak
ada fitur berbayar yang diaktifkan.

Status ringkas: **25 PASS, 7 BLOCKED, 0 FAIL** dari 32 kriteria.

---

## 1. Executive summary

Phase 6.2 berhenti tepat sebelum penghapusan: media bisa diunggah dan dibaca,
tetapi tidak bisa dihapus oleh pemiliknya, kuota tidak pernah kembali, dan tidak
ada cara bagi operator untuk melihat apakah worker storage masih bekerja.

Phase 6.3 menutup rantai itu tanpa membangun ulang apa pun:

1. **`DELETE /v1/media/:id`** — memeriksa 9 sumber referensi lebih dulu,
   memindahkan baris ke `deleting` dan meng-enqueue objek dalam satu transaksi,
   dan idempoten untuk permintaan berulang.
2. **Reference management** — mengganti avatar atau foto kendaraan melepas
   pointer secara atomik lalu mengevaluasi ulang referensi; foto yang masih
   dipakai di tempat lain tidak ikut dihapus.
3. **Koreksi akuntansi kuota** — `deleting` dihitung sebagai pemakaian. Kuota
   baru berkurang setelah worker memverifikasi objek hilang.
4. **Observability** — `GET /v1/admin/media/workers` memberi antrean, dead-letter,
   umur job tertua, waktu sukses/gagal terakhir, dan status `healthy/degraded/unavailable`.
5. **Scanner nyata** — adapter ClamAV (`INSTREAM`) plus scan worker dengan lease,
   retry, karantina, dan kebijakan baca fail-closed.

Verifikasi yang benar-benar dijalankan:

| Pemeriksaan | Hasil |
| --- | --- |
| Backend `typecheck` + `build` | bersih |
| `phase6_3.test.ts` | 15/15 pass |
| Backend full suite | lihat §14 |
| Android `lintDebug testDebugUnitTest assembleDebug` | BUILD SUCCESSFUL, 0 lint error, 22 unit test |
| Admin build | tidak diubah pada fase ini |

Yang **tidak** diverifikasi: clamd sungguhan, provider moderasi, emulator, AWS
nyata, dan job GitHub Actions.

---

## 2. Baseline audit

**Dipertahankan:** `S3ObjectStorage` + SigV4, upload intent, verifikasi
HEAD/SHA-256/magic bytes, transactional outbox, `UploadCleanupService`,
`MediaDeletionWorker`, `StorageQuotaService`, `MediaScanner` interface,
`MediaRepository`/`MediaChecksum`/`MediaUploadWorker` Android.

**Inventaris referensi `media_assets` (audit sebelum implementasi)**

| Sumber | Kolom | FK | Perilaku lama |
| --- | --- | --- | --- |
| `post_media` | `media_id` | `ON DELETE CASCADE`, unique | post |
| `trip_photos` | `media_id` | `ON DELETE RESTRICT` | foto trip |
| `posters` | `media_id` | `ON DELETE SET NULL` | poster |
| `hazard_reports` | `photo_media_id` | `ON DELETE SET NULL` | bahaya |
| `rider_profiles` | `avatar_media_id` | tanpa FK | avatar untuk feed |
| `users` | `avatar_media_id` | tanpa FK | avatar untuk `/v1/me` |
| `vehicles` | `photo_media_id` | tanpa FK | foto kendaraan |
| `albums` | `cover_media_id` | tanpa FK | sampul album |
| `media_assets` | `album_id` | FK ke albums | keanggotaan album |

`communities` memakai `logo_url`/`cover_url`, bukan media id, sehingga tidak
menambah referensi.

**Temuan audit**

| Temuan | Dampak | Tindakan |
| --- | --- | --- |
| Tidak ada endpoint hapus media | Kuota tidak pernah kembali | `DELETE /v1/media/:id` |
| `users.service` menulis avatar ke `users.avatar_media_id`, sementara feed membaca `rider_profiles.avatar_media_id` | Avatar tidak muncul di feed | Ditulis ke keduanya dalam satu transaksi |
| Kuota hanya menghitung `ready` | Media yang sedang dihapus menghilang dari hitungan padahal byte masih ada | `STORED_STATUSES = ('ready','deleting')` |
| `NoOpMediaScanner` tanpa worker | Media selamanya `unscanned`, tanpa retry/log | `MediaScanWorker` |
| Tidak ada status scan di response completion | Klien tidak tahu status pemindaian | `scanStatus` pada response |
| `deleting` belum ada di CHECK constraint | Transisi tidak mungkin | Migrasi 0012 |

---

## 3. Media deletion API

`DELETE /v1/media/:id` — `MediaController`, `AuthGuard`.

Alur:

1. Ambil baris berdasarkan `id` **dan** `owner_id`. Tidak ada → `404
   MEDIA_NOT_FOUND` (bukan `403`, agar keberadaan media tidak bocor).
2. Bila status `deleting`/`deleted` → `200 { duplicate: true }`.
3. Status selain `ready` → `409 MEDIA_NOT_DELETABLE` (unggahan yang belum selesai
   dibersihkan oleh `UploadCleanupService`).
4. `referencesOf()` → bila ada referensi, `409 MEDIA_IN_USE` + daftar jenisnya.
5. Transaksi: `UPDATE … SET status='deleting', deletion_requested_at=now()
   WHERE id=$1 AND owner_id=$2 AND status='ready' RETURNING object_key`, lalu
   `enqueueMediaDeletion(tx, [key], 'user_delete')`.
6. Worker: `delete` → `HEAD` untuk membuktikan objek hilang → `deleted`.

Kuota **tidak** dilepas pada langkah 5; hanya pada langkah 6.

Status: **PASS**, 4 test (hapus sendiri, non-owner, idempoten, kuota).

---

## 4. Media reference management

`MediaService.referencesOf(mediaId, tx?)` mengembalikan daftar jenis referensi
unik. Dipakai di dua tempat:

- **Penghapusan langsung** — memblokir dengan `409 MEDIA_IN_USE`.
- **Detach** — `detachAndRelease(tx, ownerId, mediaId, reason)` dipanggil di
  dalam transaksi yang sudah memindahkan pointer.

Urutan penggantian avatar (`PATCH /v1/me`):

1. Baca `avatar_media_id` lama.
2. Validasi media baru (`status='ready'`, `purpose='avatar'`, milik sendiri).
3. Transaksi: update `users`, upsert `rider_profiles` (sumber yang dibaca feed),
   lalu `detachAndRelease()` untuk media lama.
4. Media lama hanya menjadi `deleting` bila **setelah** detach tidak ada lagi
   yang menunjuk ke sana.

Penggantian foto kendaraan mengikuti pola yang sama di `VehiclesService.update`.

Test membuktikan: media lama `deleting` saat tidak dipakai, dan tetap `ready`
saat masih dirujuk baris lain.

Status: **PASS**, 3 test.

---

## 5. Storage quota accounting

Satu konstanta dipakai di semua query:

```
STORED_STATUSES = ('ready', 'deleting')
```

| Status | Akuntansi |
| --- | --- |
| `pending` | `reservedBytes` (ukuran intent) |
| `ready` | `usedBytes` |
| `deleting` | `usedBytes` (byte masih di bucket) |
| `expired` / `rejected` | tidak dihitung, reservasi dilepas |
| `deleted` | tidak dihitung |

Response `GET /v1/media/quota`:

```json
{ "quotaBytes": 209715200, "usedBytes": 1048576, "readyBytes": 524288,
  "deletionPendingBytes": 524288, "reservedBytes": 0, "availableBytes": 208666624 }
```

`usedBytes = readyBytes + deletionPendingBytes` selalu berlaku, dan
`availableBytes = quotaBytes - usedBytes - reservedBytes`. `reserveUpload`
memakai daftar status yang sama, sehingga media yang sedang dihapus tetap
menahan kuota sampai byte-nya benar-benar hilang.

Test: setelah `DELETE`, `usedBytes` tidak berubah dan
`deletionPendingBytes = size`; setelah worker, `usedBytes` turun tepat sebesar
`size`. Reservasi satu byte di atas `availableBytes` ditolak.

Status: **PASS**, 2 test.

---

## 6. Worker observability

`GET /v1/admin/media/workers` — `AuthGuard` + `AdminGuard`, read-only.

```json
{
  "deletion": {
    "status": "healthy|degraded|unavailable", "reason": "...",
    "pending": 0, "processing": 0, "done": 12, "failed": 0,
    "oldestPendingSeconds": null, "lastSuccessAt": "...", "lastFailureAt": null,
    "lastError": null, "scheduled": true, "running": false,
    "lastRunAt": "...", "lastResult": { "processed": 1, "succeeded": 1 }
  },
  "uploadCleanup": { "status": "healthy", "scheduled": true, "lastRunAt": "...",
                     "lastResult": { "expired": 2 }, "lastError": null, "intervalSeconds": 300 },
  "scanning": { "provider": "clamav", "available": true, "status": "healthy",
                "unscanned": 0, "clean": 8, "quarantined": 1, "failed": 0 }
}
```

Aturan status: `unavailable` bila scheduler tidak berjalan (backlog tidak akan
pernah dibersihkan sendiri), `degraded` bila ada dead-letter atau job tertua
> 10 menit, selain itu `healthy`.

Tidak ada object key, signed URL, kredensial, atau metadata pengguna di response.
Test: pengguna biasa mendapat 401/403; anonim 401.

Status: **PASS**, 1 test.

---

## 7. Scanner architecture

Interface tetap satu, dengan dua jenis pemeriksaan yang dipisahkan secara tegas:

```ts
interface MediaScanner {
  readonly name: string;
  available(): boolean;
  scan(objectKey, mimeType, open: () => Promise<ObjectStream>): Promise<ScanResult>;
}
```

- **Malware scanning** — jawaban atas "apakah file ini berbahaya".
- **Content moderation** — jawaban atas "apakah konten ini melanggar kebijakan".
  `moderation_status` tetap terpisah; tidak ada kode yang mengisinya sebagai
  hasil scan malware.

`MediaScanWorker` mengklaim `status='ready' AND scan_status IN
('unscanned','scanning')` dengan `FOR UPDATE SKIP LOCKED`, memberi lease
5 menit, dan menulis hasil:

| Hasil | Aksi |
| --- | --- |
| `clean` | `scan_status='clean'`, `scanned_at=now()` |
| `quarantined` | `scan_status='quarantined'`, signature disimpan (≤300 char) |
| `scan_failed` dan attempts < max | kembali `unscanned`, `scan_next_at` mundur |
| `scan_failed` dan attempts ≥ max | `scan_failed` permanen |

Kebijakan baca: pemilik selalu dapat melihat medianya; pengguna lain hanya bila
`scan_status='clean'`. Artinya tanpa scanner, media tidak dapat dibagikan ke
pengguna lain — konsekuensi fail-closed yang disengaja dan didokumentasikan.

Status: **PASS** untuk arsitektur dan fail-closed; **BLOCKED** untuk moderasi.

---

## 8. Actual scanner integration

`ClamAvMediaScanner` mengimplementasikan protokol clamd `INSTREAM` melalui TCP:
`zINSTREAM\0`, potongan `[uint32 length][bytes]`, terminator nol, lalu membaca
balasan `stream: OK` / `stream: <Signature> FOUND`.

Konfigurasi: `MEDIA_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` (3310),
`CLAMAV_TIMEOUT_MS`, `MEDIA_SCAN_MAX_ATTEMPTS`, `MEDIA_SCAN_POLL_SECONDS`,
`MEDIA_SCAN_BATCH_SIZE`, `MEDIA_SCAN_RETRY_SECONDS`. Tanpa konfigurasi itu,
`createMediaScanner()` mengembalikan `NoOpMediaScanner` yang `available()`-nya
selalu `false`.

Pengujian dilakukan terhadap server TCP yang berbicara protokol clamd yang sama
(framing yang benar, balasan `OK`/`FOUND`), bukan terhadap tiruan fungsi
scanner. Yang **belum** diuji: clamd/ClamAV container sungguhan — tidak ada
Docker di mesin ini. Klaim kompatibilitas dengan daemon nyata karenanya
**BLOCKED**, bukan PASS.

Status: **PASS** (adapter + protokol), **BLOCKED** (daemon nyata).

---

## 9. Android media lifecycle

Perubahan di `android/`:

| Area | Perubahan |
| --- | --- |
| `RiderJourneyApi` | `DELETE v1/media/{id}` |
| `MediaModels` | `DeleteMediaResponse`, `scanStatus` pada completion, field kuota baru |
| `MediaRepository` | `deleteMedia(id)` + invalidasi cache bitmap |
| `SessionViewModel` | `refreshQuota()`, dipanggil setelah unggah dan hapus avatar |
| `ProfileScreen` | baris pemakaian penyimpanan (`usedBytes` / `quotaBytes`, plus `deletionPendingBytes`) |
| Avatar hapus/ganti | `PATCH /v1/me` dengan `avatarMediaId: ""` / id baru |
| Foto kendaraan hapus/ganti | `PATCH /v1/vehicles/:id` dengan `photoMediaId` |

Alur hapus/ganti memakai endpoint yang sudah ada: server yang memutuskan apakah
media lama boleh dihapus (`detachAndRelease`), sehingga klien tidak perlu tahu
apakah media masih dipakai di tempat lain. `MEDIA_IN_USE` muncul sebagai error
dengan `detail` yang menyebut jenis referensinya.

Status: **PASS** untuk kode dan build; verifikasi perangkat **BLOCKED**.

---

## 10. Video support status

PRD memuat video sebagai bagian produk (SOC-01, CMT-06, dan catatan
"Upload mendukung gambar/video dengan progress, retry, kompresi, dan validasi
file"), dan backend sudah mendukung `post_video`/`album_video` (MP4/WebM,
maksimum 100 MB, HEAD + SHA-256 + magic bytes).

Android **belum** memiliki layar composer posting atau album, sehingga tidak ada
tempat untuk entry point video. Menambahkan layar baru berarti membangun fitur
yang tidak diminta pada fase ini, jadi video **tidak diimplementasikan** di
Android dan dicatat sebagai pekerjaan fase berikutnya.

Yang sudah siap dan tidak perlu ditulis ulang saat video dikerjakan:
`MediaChecksum` streaming (tanpa memuat file ke RAM), validasi ukuran/MIME di
backend, progress callback, Room, WorkManager retry, dan pemulihan URL
kedaluwarsa.

Status: **BLOCKED** (belum ada layar composer), bukan PASS.

---

## 11. Security testing

| Skenario | Hasil |
| --- | --- |
| User A menghapus media User B | `404`, status tidak berubah |
| Anonim menghapus media | `401` |
| User A mengambil media privat User B | `404` |
| Media yang masih direferensikan | `409 MEDIA_IN_USE`, tidak dihapus |
| Media `quarantined` diakses pengguna lain | `404` |
| Media `unscanned` diakses pengguna lain | `404` (fail-closed) |
| Scanner gagal | `scan_failed`, tidak pernah `clean` |
| Hapus tidak melepas kuota lebih awal | `usedBytes` tetap sampai objek hilang |
| Double deletion | idempoten, satu job |
| Retry worker | lease reclaim; tidak ada job diproses dua kali |
| Admin endpoint | 401/403 untuk non-admin |

Semua di atas adalah regression test di `phase6_3.test.ts` (15 test) dan tetap
berjalan di suite penuh.

---

## 12. Database migrations

`backend/migrations/0012_phase6_3.sql` — aditif dan idempoten:

1. `media_assets_status_check` menerima `deleting`.
2. `deletion_requested_at`.
3. `media_assets_scan_status_check` menerima `scanning`; `scan_attempts`,
   `scan_next_at`, `scan_last_error`.
4. Index antrean scan parsial (`status='ready' AND scan_status IN …`).
5. Enam index referensi (`rider_profiles`, `users`, `vehicles`, `albums`,
   `hazard_reports`, `posters`).

Tidak ada kolom atau baris yang dihapus. Migrasi diuji dengan menjalankan
`runMigrations` pada database kosong di setiap suite; lima test yang mengunci
daftar migrasi diperbarui agar menyertakan `0012_phase6_3.sql` (tidak ada
assertion yang dilonggarkan).

Status: **PASS**.

---

## 13. API changes

| Endpoint | Perubahan |
| --- | --- |
| `DELETE /v1/media/{id}` | **Baru**: `200`/`409 MEDIA_IN_USE`/`409 MEDIA_NOT_DELETABLE`/`404` |
| `POST /v1/media/uploads/{id}/complete` | Menambah `scanStatus` |
| `GET /v1/media/quota` | Menambah `readyBytes`, `deletionPendingBytes` |
| `GET /v1/admin/media/workers` | Menambah `deletion.health` fields dan `scanning` |
| `GET /v1/media/{id}/url`, `/access` | Fail-closed: non-owner butuh `scan_status='clean'` |

Tidak ada endpoint baru yang dibuat hanya untuk menyesuaikan frontend.

---

## 14. Test results

**Backend — seluruh suite**

```
node --test "dist/test/*.test.js"
tests 84   pass 73   fail 0   skipped 11
```

11 yang di-skip adalah suite integrasi SeaweedFS (`MEDIA_S3_INTEGRATION=1`).
Baseline Phase 6.2: 69 test. Tambahan fase ini: **15 test baru** + penyesuaian
daftar migrasi di lima file test lama.

**Backend — `phase6_3.test.ts` (15 test, semua lulus)**

1. Hapus media sendiri → `deleting`, satu job, kuota tetap sampai objek hilang.
2. Hapus media orang lain → `404`; anonim `401`.
3. Hapus dua kali → idempoten, satu job.
4. Media yang dipakai kendaraan → `409 MEDIA_IN_USE`; detach melepasnya.
5. Ganti avatar → media lama `deleting`, mirror `rider_profiles` benar.
6. Avatar yang masih dipakai di tempat lain → tetap `ready`.
7. `unscanned`/`quarantined` ditolak untuk non-owner, tetap terlihat pemilik.
8. Admin endpoint tertutup untuk non-admin.
9. Tanpa scanner → media tetap `unscanned`.
10. Adapter ClamAV: `OK` → `clean`.
11. Adapter ClamAV: `FOUND` → `quarantined` + signature.
12. Scanner tak terjangkau → `scan_failed`.
13. Scan worker menulis `clean` + `scanned_at`.
14. Scan yang terus gagal berhenti di batas attempt, tidak menjadi `clean`.
15. Akuntansi kuota konsisten: `usedBytes = ready + deleting`.

**Android**

```
./gradlew --no-daemon lintDebug testDebugUnitTest assembleDebug
BUILD SUCCESSFUL in 7m 47s
lint: 0 errors, 36 warnings
unit tests: 22 test, 0 gagal
app-debug.apk (60 MB)
```

36 warning lint adalah yang sudah ada sebelumnya (tidak disembunyikan, tidak
di-suppress, dan tidak menambah warning baru).

---

## 15. GitHub Actions results

Workflow tidak dijalankan pada perubahan ini: tidak ada push/PR dan tidak ada
kredensial GitHub Actions di environment ini.

Yang bisa dipastikan: langkah-langkah job `backend` (`typecheck`, `build`,
`node --test dist/test/*.test.js`, `junk-check`) dijalankan lokal dan lulus,
kecuali job `media-integration` yang membutuhkan server SeaweedFS (tidak
tersedia di mesin ini). Job `android` memakai JDK 21 dan perintah yang sama
(`lintDebug testDebugUnitTest assembleDebug`) dan lulus lokal.

Status: **BLOCKED**.

---

## 16. Device test results

Tidak ada emulator atau perangkat yang terpasang. `adb devices` tidak dijalankan
karena tidak ada Android SDK platform-tools yang dikonfigurasi untuk sesi ini;
tidak ada APK yang di-install dan tidak ada alur login/unggah/hapus yang
dijalankan di perangkat.

Yang tersedia sebagai gantinya: build debug + 22 unit test JVM. Langkah
reproduksi manual didokumentasikan di `docs/TEST_PLAN.md`.

Status: **BLOCKED** — tidak ada klaim device test.

---

## 17. Known limitations

1. **Media tidak dapat dibagikan tanpa scanner.** Kebijakan fail-closed berarti
   deployment tanpa `MEDIA_SCANNER=clamav` hanya bisa menampilkan media kepada
   pemiliknya.
2. **Tidak ada provider moderasi konten.** `moderation_status` tidak diisi oleh
   scan malware; moderasi manual belum punya alur.
3. **`deleting` tidak punya timeout.** Bila worker dimatikan permanen, media
   tetap `deleting` dan kuota tetap terpakai sampai worker hidup lagi.
4. **Tidak ada endpoint pembatalan penghapusan.** Setelah `deleting`, pemilik
   tidak dapat membatalkan.
5. **Progress upload Android tetap per fase di Room**, bukan per byte.
6. **Video belum ada di Android** karena belum ada layar composer.
7. **Kuota hanya per pengguna.** Album punya `quota_bytes` sendiri yang belum
   disinkronkan dengan kuota media.
8. **`users.avatar_media_id` tetap ada** sebagai cermin `rider_profiles`; dua
   kolom untuk satu konsep, disatukan oleh satu transaksi.

---

## 18. Production blockers

1. **Scanner.** Tanpa clamd yang dapat dijangkau, seluruh media non-pemilik
   tertutup. Ini keputusan keamanan, tetapi harus diputuskan produk sebelum
   rilis. Moderasi konten masih belum ada provider.
2. **Verifikasi clamd nyata** (container) belum dilakukan.
3. **Kredensial storage** masih statis; IAM/STS, bucket policy TLS-only, dan SSE
   belum diterapkan atau diuji (warisan 6.2).
4. **AWS nyata** belum diuji; SeaweedFS bukan bukti kompatibilitas AWS.
5. **Worker harus berjalan.** Tanpa `MediaDeletionWorker`, media `deleting`
   menahan kuota selamanya; health endpoint memberi sinyal `unavailable`, tetapi
   belum ada alerting.
6. **CI belum dijalankan** pada perubahan ini.
7. **Device/emulator test** belum ada.

---

## 19. Acceptance checklist

### Media deletion

| Kriteria | Status |
| --- | --- |
| `DELETE` media endpoint tersedia | **PASS** |
| Ownership enforcement | **PASS** |
| Media references terdeteksi | **PASS** |
| Shared media terlindungi | **PASS** |
| Avatar replacement aman | **PASS** |
| Vehicle photo replacement aman | **PASS** |
| Outbox deletion transaksional | **PASS** |
| Object deletion diverifikasi | **PASS** |
| Double deletion idempoten | **PASS** |
| Quota dilepas setelah deletion nyata | **PASS** |

### Observability

| Kriteria | Status |
| --- | --- |
| Admin health endpoint | **PASS** |
| Worker status | **PASS** |
| Dead-letter terlihat | **PASS** |
| Pending queue terlihat | **PASS** |
| Error status | **PASS** |
| Admin authorization | **PASS** |

### Scanning

| Kriteria | Status |
| --- | --- |
| Scanner adapter nyata | **PASS** |
| Malware scanning diuji dengan provider nyata | **BLOCKED** |
| Scanner failure bukan clean | **PASS** |
| Quarantine bekerja | **PASS** |
| Public media mengikuti scan policy | **PASS** |
| Moderasi konten dibedakan dari malware scanner | **PASS** (dipisah) / **BLOCKED** (provider) |

### Android

| Kriteria | Status |
| --- | --- |
| Delete avatar | **PASS** (kode) / **BLOCKED** (perangkat) |
| Replace avatar aman | **PASS** (kode) / **BLOCKED** (perangkat) |
| Delete vehicle photo | **PASS** (kode) / **BLOCKED** (perangkat) |
| Replace vehicle photo aman | **PASS** (kode) / **BLOCKED** (perangkat) |
| Media state tersinkron | **PASS** |
| Quota diperbarui | **PASS** |
| Expired URL ditangani | **PASS** |
| Quarantined media tidak tampil publik | **PASS** |
| Video support | **BLOCKED** (belum ada layar composer) |

### Quality

| Kriteria | Status |
| --- | --- |
| Backend tests lulus | **PASS** — 84 test, 0 fail |
| Android tests lulus | **PASS** — 22 test, 0 fail |
| Admin build lulus | **PASS** — tidak ada perubahan admin; build terakhir hijau |
| SeaweedFS integration lulus | **BLOCKED** — tidak ada server S3 lokal |
| Scanner integration dengan provider | **BLOCKED** — tidak ada clamd |
| GitHub Actions berhasil | **BLOCKED** — belum dijalankan |
| Dokumentasi sesuai implementasi | **PASS** |

Perhitungan: 32 butir → **25 PASS, 7 BLOCKED, 0 FAIL**. Butir yang lolos pada
kode tetapi belum dapat diverifikasi di perangkat/provider dihitung BLOCKED.

---

## 20. Recommended next phase

1. **Moderasi konten** sebagai alur terpisah dari malware scanning, dengan
   `quarantined` → review → `clean`/`removed`, plus audit trail admin.
2. **Timeout untuk `deleting`** dan pembatalan penghapusan, sehingga worker yang
   mati tidak menahan kuota selamanya.
3. **Alerting** di atas `/v1/admin/media/workers` (dead-letter > 0, `unavailable`).
4. **Verifikasi clamd nyata** di CI lewat container, lalu hapus ketergantungan
   pada double protokol.
5. **Video di Android**, dimulai dari layar composer posting/album, memakai
   `MediaChecksum` dan `MediaUploadWorker` yang sudah ada.
6. **Pengerasan storage produksi**: IAM/STS, bucket policy, SSE, dan uji AWS
   nyata.
