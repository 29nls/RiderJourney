# PHASE 6.4 REPORT — Reliability & Verification Closure

Tanggal: 27 November 2026
Repository: `29nls/RiderJourney` (branch `main`, perubahan belum di-commit)

---

## 1. Executive summary

Phase 6.4 tidak menambah fitur produk. Fokusnya menutup lima celah yang
ditinggalkan 6.3:

1. Baris `media_assets` berstatus `deleting` bisa tertahan selamanya bila worker
   berhenti, dan kuota ikut tertahan.
2. Tidak ada cara membatalkan permintaan hapus, dan tidak ada jalur operator
   untuk job yang masuk dead letter.
3. ClamAV hanya diuji terhadap server TCP tiruan, bukan daemon sungguhan.
4. Tidak ada moderasi konten — `scan_status` adalah satu-satunya gerbang.
5. Tidak ada peringatan operasional; `/v1/admin/media/workers` hanya bisa
   dipantau dengan mata.

Hasil:

| Area | Status |
| --- | --- |
| Pemulihan penghapusan (reconcile + HEAD + requeue) | **PASS** |
| Pembatalan aman dengan penguncian baris | **PASS** |
| Dead-letter: daftar, retry, audit | **PASS** |
| Moderasi konten terpisah dari pemindaian | **PASS** |
| Alert dedup, cooldown, recovery | **PASS** |
| Pengiriman notifikasi eksternal | **BLOCKED** (tidak ada provider) |
| ClamAV daemon nyata | **BLOCKED** (Docker tidak tersedia di mesin ini) |
| Job CI ClamAV | **BLOCKED** (workflow ditulis, belum dijalankan) |
| Uji perangkat Android | **BLOCKED** (tidak ada emulator) |
| SeaweedFS / AWS S3 | **BLOCKED** (CI / tidak diuji) |

Angka verifikasi final ada di §11, §12, dan §20.

Backend suite final (serial, `--test-concurrency=1`):

```
tests 103   pass 86   fail 0   skipped 17   EXIT=0
```

Yang di-skip: 11 test `media.integration` (butuh `MEDIA_S3_INTEGRATION=1`) dan 6
test ClamAV ber-daemon (butuh `CLAMAV_INTEGRATION=1`).

---

## 2. Repository baseline

Audit sebelum perubahan:

- Backend NestJS + PGlite untuk test, PostgreSQL/PostGIS untuk produksi.
- `0012_phase6_3.sql` sebagai migrasi terakhir; 84 test backend (73 pass, 11
  skip karena `MEDIA_S3_INTEGRATION`).
- Android: build hijau, 22 unit test, **36 warning lint**, 0 error.
- Admin: Next.js App Router, satu halaman konsol dengan seksi per domain.
- CI: job `backend`, `admin`, `android`, `media-integration` (SeaweedFS 4.55).

Yang dipertahankan tanpa perubahan perilaku: `S3ObjectStorage` dan SigV4,
`UploadCleanupService`, `MediaDeletionWorker` (outbox transaksional),
`StorageQuotaService`, `MediaScanWorker`, `ClamAvMediaScanner`,
`MediaRepository`/`MediaUploadWorker` Android, dan endpoint
`/v1/admin/media/workers`. Tidak ada implementasi 6.1–6.3 yang dibangun ulang.

---

## 3. Deletion recovery

`MediaDeletionWorker.reconcileStale(olderThanSeconds, limit)`
(`backend/src/media/deletion-outbox.ts`):

1. Pilih baris `status='deleting'` dengan `deletion_requested_at` lebih tua dari
   `MEDIA_DELETION_STALE_SECONDS` (default 900) **dan** tanpa job
   `pending`/`processing` untuk `object_key` yang sama.
2. Untuk setiap baris, `HEAD` ke storage:
   - objek ada → job lama di-reset ke `pending` (attempts 0, `last_error` NULL)
     atau dibuat baru bila belum ada, lalu dicatat di `media_deletion_ops_log`
     dengan aksi `reconcile`;
   - objek tidak ada → baris menjadi `deleted` dan `deletion_requested_at`
     dikosongkan, sehingga kuota baru dilepas di titik ini;
   - storage tidak dapat dihubungi → baris dibiarkan, dihitung sebagai
     `deferred`, dan dicoba lagi pada pass berikutnya.
3. Baris **tidak pernah** kembali ke `ready`. Timeout worker bukan alasan untuk
   menghidupkan kembali konten yang sudah diminta dihapus.

Endpoint operator: `POST /v1/admin/media/deletions/reconcile` (`media.ops` +
step-up), dengan catatan audit `media.deletion.reconcile`.

Bukti: `phase6_4.test.ts` — dua test (objek masih ada → requeue, kuota tetap
ditahan; objek hilang → `deleted`, kuota berkurang tepat sebesar `size_bytes`).

---

## 4. Cancellation behaviour

`POST /v1/media/:id/cancel-deletion` (`MediaService.cancelDeletion`):

- Baris media dibaca dengan kepemilikan (`owner_id`); bukan pemilik → `404`.
- `ready` → `200` dengan `duplicate: true` (idempoten).
- `deleted` → `409 MEDIA_DELETION_COMPLETED`.
- Status lain → `409 MEDIA_NOT_DELETING`.
- Di dalam transaksi, baris outbox dikunci `FOR UPDATE`. Job hanya boleh
  dibatalkan bila `status='pending'` dan `attempts = 0`. `attempts > 0` berarti
  worker sudah pernah mengklaim, sehingga objek mungkin sudah hilang.
- Bila syarat terpenuhi: baris media kembali ke `ready`, job dihapus, dan
  `media_deletion_ops_log` mencatat aksi `cancel` beserta aktor. Menghapus job
  dari tabel kerja tidak menghapus riwayat, karena riwayat tinggal di ops log.
- Bila worker memenangkan balapan, `UPDATE ... WHERE status='deleting'` tidak
  mengenai baris dan hasilnya `race` → `409`.

Bukti: tiga test — berhasil sebelum klaim, `409` setelah klaim (`attempts=2`),
`404` untuk media asing, dan `409` setelah objek benar-benar terhapus.

---

## 5. ClamAV real integration

Adapter `ClamAvMediaScanner` sudah memakai protokol clamd `INSTREAM`
(`zINSTREAM\0` + chunk `uint32` + terminator nol). Yang baru di 6.4:

- `backend/src/test/clamav.integration.test.ts` — 10 test, di-skip kecuali
  `CLAMAV_INTEGRATION=1`.
- `.github/workflows/ci.yml` job `clamav-integration` dengan container
  `clamav/clamav:1.4.2` (tag rilis dipin, bukan `latest`), health check
  `clamdcheck.sh`, start period 180 detik.
- Konfigurasi `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`,
  `MEDIA_SCAN_MAX_ATTEMPTS`, `MEDIA_SCAN_POLL_SECONDS`,
  `MEDIA_SCAN_BATCH_SIZE` didokumentasikan di `docs/SCANNER_INTEGRATION.md`.

**Docker tidak terpasang di mesin pengembangan ini** (`docker: command not
found`), sehingga daemon nyata tidak dapat dijalankan. Hasil yang jujur:

- 4 test non-daemon lulus lokal (daemon mati, timeout, size limit, balasan tak
  terduga).
- 6 test ber-daemon **BLOCKED** di lokal.

---

## 6. Malware scan test results

| Kasus | Media | Hasil |
| --- | --- | --- |
| File bersih 64 KB | daemon nyata | BLOCKED lokal, dijalankan CI |
| EICAR | daemon nyata | BLOCKED lokal, dijalankan CI |
| Payload 512 KB multi-chunk | daemon nyata | BLOCKED lokal, dijalankan CI |
| Daemon tidak dapat dihubungi | TCP tertutup | PASS — `scan_failed`, bukan clean |
| Daemon tidak menjawab | server TCP diam | PASS — `scan_failed` + `clamd reply timeout` |
| `INSTREAM size limit exceeded` | server TCP | PASS — `scan_failed` |
| Balasan tak terduga | server TCP | PASS — `scan_failed` |
| Quarantine EICAR dari storage + blokir pengguna lain | daemon nyata | BLOCKED lokal |
| Retry lalu clean hanya dengan daemon hidup | daemon + TCP mati | BLOCKED lokal |
| Lease `scanning` kedaluwarsa diambil ulang | daemon nyata | BLOCKED lokal |

Perbaikan yang ditemukan saat menulis test ini: helper test sebelumnya
menutup server TCP tanpa memutus koneksi yang masih terbuka, sehingga
`server.close()` menggantung dan seluruh proses test tidak pernah selesai.
Helper sekarang melacak socket dan memutusnya sebelum menutup server. Ini bug
pada test harness, bukan pada adapter, tetapi tetap dilaporkan karena sempat
membuat suite tampak "hang".

EICAR adalah string uji antivirus standar yang tidak berbahaya. Tidak ada
malware aktif di repositori ini.

---

## 7. Content moderation architecture

Sumbu kedua yang terpisah dari pemindaian:

| Pertanyaan | Kolom | Penulis |
| --- | --- | --- |
| Apakah file berbahaya? | `scan_status` (+ `scan_attempts`, `scan_last_error`) | Scan worker |
| Apakah konten melanggar aturan? | `moderation_status` (+ reason, reviewer, waktu) | Reviewer |

Status: `not_required`, `pending_review`, `approved`, `rejected`, `hidden`.
Migrasi `0013_phase6_4.sql` memperluas CHECK lama (`pending`, `approved`,
`rejected`), memindahkan data `pending` → `pending_review`, dan menambah
`media_moderation_log` (append-only, berisi aktor, alasan, status sebelum dan
sesudah).

Kebijakan:

- `post_photo`, `post_video`, `album_photo`, `album_video`, `poster`,
  `hazard_photo`, `community_logo`, `community_cover` → `pending_review` saat
  upload selesai.
- `avatar`, `vehicle_photo` → `not_required`.
- Media dapat dibaca non-pemilik hanya bila `status='ready'` **dan**
  `scan_status='clean'` **dan** `moderation_status IN ('approved','not_required')`
  **dan** aturan audiens induknya lolos.

Keputusan reviewer tidak pernah menulis `scan_status`, dan sebaliknya. Ini diuji
eksplisit: setelah `approve`, `scan_status` tetap `clean`; setelah `reject`,
media tetap `clean` tetapi tidak dapat diakses pengguna lain.

---

## 8. Admin moderation workflow

Backend (`media.read` / `media.moderate`):

| Method | Path | Catatan |
| --- | --- | --- |
| GET | `/v1/admin/media/moderation` | filter status/purpose, cursor, ringkasan |
| GET | `/v1/admin/media/moderation/:id/history` | 50 entri terakhir |
| GET | `/v1/admin/media/moderation/:id/preview` | URL 120 detik, hanya bila `scan_status='clean'`; selain itu `409 MEDIA_PREVIEW_BLOCKED` |
| POST | `/v1/admin/media/moderation/:id/decision` | `approve`/`reject`/`hide`, alasan wajib untuk dua yang terakhir, step-up MFA |
| POST | `/v1/admin/media/moderation/:id/reopen` | kembali ke `pending_review` dengan alasan |

Setiap keputusan juga menulis `admin_audit_logs`
(`media.approve`/`media.reject`/`media.hide`/`media.reopen`).

Frontend: tab **Media** di seksi Moderasi (`admin/components/sections/
MediaModerationPanel.tsx`) — ringkasan angka, tabel antrean, panel tinjauan
dengan pratinjau aman, form keputusan, dan riwayat. Semua aksi lewat proxy admin
yang ada, dengan `X-Step-Up-Token`. Tidak ada data browser yang dipercaya:
keputusan dikirim sebagai `action` + `reason`, dan backend memvalidasi ulang.

Izin:

| Permission | support | moderator | admin | superadmin |
| --- | --- | --- | --- | --- |
| `media.read` | — | ✓ | ✓ | ✓ |
| `media.moderate` | — | ✓ | ✓ | ✓ |
| `media.ops` | — | — | ✓ | ✓ |

Support sengaja tidak dapat membaca antrean karena isinya konten pengguna yang
belum ditinjau.

---

## 9. Worker alerting

`backend/src/media/alerting.ts`.

Kondisi yang dievaluasi: `deletion_worker_unavailable`,
`upload_cleanup_unavailable`, `deletion_dead_letter`, `deletion_backlog`,
`scan_backlog`, `scanner_unavailable`, `scan_failures`.

Mekanisme:

- Satu baris per jenis di `ops_alert_events` (`UNIQUE(kind)`). Kondisi berulang
  menaikkan `occurrences` dan memperbarui `last_seen_at` — inilah deduplikasi.
- Notifikasi dikirim paling sering sekali per `MEDIA_ALERT_COOLDOWN_SECONDS`
  (default 1800), dilacak `last_notified_at`.
- Kondisi yang hilang menjadi `resolved` dengan `resolved_at`, dan percobaan
  notifikasi pemulihan dilakukan.
- `details` hanya berisi angka, nama kind, dan pesan galat storage yang sudah
  dipotong: tidak ada object key, URL bertanda tangan, token, atau kredensial.

**Pengiriman eksternal: BLOCKED.** `AlertNotifier` diimplementasikan oleh
`NoopAlertNotifier` dengan `available() === false`. API admin dan laporan ini
menyatakan hal yang sama; tidak ada klaim bahwa notifikasi terkirim.

Evaluasi berjalan otomatis saat storage dikonfigurasi (`main.ts`), dan dapat
dipicu manual: `POST /v1/admin/media/alerts/evaluate` (`media.ops`).

Bukti: `phase6_4.test.ts` — dedup (occurrences naik pada evaluasi kedua), alert
kritis dead-letter, recovery (`resolved` + `resolved_at`), `notifier.available =
false`, dan `403` untuk peran support.

---

## 10. Operational runbook

`docs/MEDIA_OPERATIONS_RUNBOOK.md` mencakup: daftar endpoint dan izin, tabel
ambang alert, enam skenario kegagalan (worker mati, dead letter, media tertahan
di `deleting`, scanner mati/backlog, investigasi karantina, backlog moderasi),
prosedur pemulihan langkah demi langkah, pemeriksaan kuota, dan batas eskalasi
(tidak menyunting tabel secara manual, tidak menandai `clean` manual).

---

## 11. Android lint audit

Sebelum: 36 warning, 0 error. Sesudah: **28 warning, 0 error**.

| Kategori | Jumlah awal | Tindakan | Sisa |
| --- | --- | --- | --- |
| Correctness — `InlinedApi` (`ACCESS_BACKGROUND_LOCATION` pada minSdk 26) | 1 | Guard `SDK_INT >= 29` | 0 |
| Correctness — `ObsoleteSdkInt` (`SDK_INT < 26` pada minSdk 26) | 1 | Hapus cabang mati | 0 |
| Security/privacy — backup | 1 (`DataExtractionRules`) | `dataExtractionRules` mengecualikan seluruh `sharedpref`; `allowBackup=false` dipertahankan | 0 |
| Correctness — ikon aplikasi | 1 (`MissingApplicationIcon`) | Vector `ic_launcher.xml` + `android:icon` | 0 |
| Deprecated API / modernisasi | 4 (`UseKtx`) | `toUri()`, `toColorInt()`, `edit {}` | 0 |
| Cosmetic — versi dependency | 25 (`GradleDependency`, `NewerVersionAvailable`, `AndroidGradlePluginVersion`) | Tidak diubah: upgrade mayor (Retrofit 3, OkHttp 5, MapLibre 13) di luar lingkup fase dan berisiko | 25 |
| UX — orientasi | 2 (`LockedOrientationActivity`, `DiscouragedApi`) | Dipertahankan: aplikasi navigasi dikunci portrait; mengubahnya butuh verifikasi visual yang tidak tersedia | 2 |

Tidak ada warning yang disembunyikan dengan `@Suppress` atau `lint.xml`. Sisa 28
warning seluruhnya bersifat kosmetik/versi atau keputusan UX yang didokumentasikan.

---

## 12. Android test results

```
cd android && export JAVA_HOME="$PWD/.tooling/jdk-21.0.13.1+2"
./gradlew.bat --no-daemon lintDebug testDebugUnitTest assembleDebug assembleDebugAndroidTest
```

Hasil: **BUILD SUCCESSFUL in 8m 19s**, 90 task (34 dieksekusi).
Backend suite pada saat yang sama: **103 test, 86 pass, 0 fail, 17 skip**.

- `lintDebug`: 0 error, 28 warning.
- `testDebugUnitTest`: **22 test, 0 failure, 0 error** (dibaca dari XML hasil).
- `assembleDebug`: APK debug terbentuk.
- `assembleDebugAndroidTest`: APK instrumented test terbentuk
  (`app-debug-androidTest.apk`).

Tambahan: `MediaContentUriTest` (instrumented) memverifikasi pembacaan content
URI lewat `ContentResolver` + SHA-256 dan aturan margin kedaluwarsa presigned
intent. Test ini **belum dijalankan** karena tidak ada emulator/perangkat.

---

## 13. Emulator/device test results

**BLOCKED.** Tidak ada emulator atau perangkat terpasang di mesin ini
(`connectedDebugAndroidTest` tidak dapat dijalankan). Sesuai instruksi:

- Instrumented test disiapkan dan berhasil dikompilasi.
- Langkah reproduksi untuk 12 skenario (login, unggah/ganti/hapus avatar,
  unggah/ganti/hapus foto kendaraan, kuota, gangguan jaringan, status
  penghapusan, pembatasan akses) ditulis di
  `docs/MEDIA_OPERATIONS_RUNBOOK.md` §5.
- Tidak ada klaim bahwa alur perangkat berhasil. Build Gradle bukan bukti
  perangkat.

---

## 14. SeaweedFS test results

**BLOCKED di lokal.** Suite `MEDIA_S3_INTEGRATION=1` hanya berjalan di CI dengan
SeaweedFS 4.55 (job `media-integration`, tidak diubah). Test tersebut mencakup
SigV4 PUT, HEAD, SHA-256, signed GET, delete, retry, dan verifikasi objek.

AWS S3 produksi **tidak** diuji dan **tidak** diklaim PASS. SeaweedFS bukan bukti
kesiapan AWS.

---

## 15. GitHub Actions results

Workflow `ci.yml` setelah perubahan:

| Job | Perubahan |
| --- | --- |
| `backend` | `node --test` dijalankan serial (`--test-concurrency=1 --test-timeout=120000`) karena tiap file memakai PGlite + PBKDF2 dan paralel membuat test migrasi melewati timeout di runner 2 core |
| `admin` | tidak diubah |
| `android` | tidak diubah |
| `media-integration` | tidak diubah (SeaweedFS 4.55) |
| `clamav-integration` | **baru** — container `clamav/clamav:1.4.2`, health check, EICAR + clean file |

**BLOCKED:** workflow belum dijalankan pada commit ini. Tidak ada hasil CI yang
dibuat-buat. Yang dilaporkan hanya isi workflow dan hasil lokal yang setara.

---

## 16. Database migration

`backend/migrations/0013_phase6_4.sql`, additive dan idempoten:

- `media_assets`: perluasan CHECK `moderation_status` menjadi lima nilai,
  pemindahan data `pending` → `pending_review`, default baru, kolom
  `moderation_reason`, `moderation_requested_at`, `moderation_reviewed_at`,
  `moderation_reviewer_id` (FK `users`, `ON DELETE SET NULL`).
- `media_moderation_log` (baru) + index `(media_id, created_at DESC)`.
- Index parsial antrean `(moderation_requested_at) WHERE
  moderation_status='pending_review'`.
- `ops_alert_events` (baru) + `UNIQUE(kind)` + index status.
- `media_deletion_ops_log` (baru) + index.
- Index parsial `(deletion_requested_at) WHERE status='deleting'`.

Tidak ada tabel atau kolom yang dihapus. Migrasi dijalankan dari database kosong
di setiap suite (`runMigrations`), termasuk PGlite dan PostgreSQL/PostGIS di CI;
lima test yang mengunci daftar migrasi diperbarui agar menyertakan
`0013_phase6_4.sql`.

Catatan kompatibilitas: nilai `moderation_status='pending'` tidak lagi valid
setelah migrasi. `albums.service.ts` diperbarui menulis `pending_review`.

---

## 17. API changes

Lihat `docs/API_CONTRACT.md` §23. Ringkas:

- Baru (pemilik): `POST /v1/media/:id/cancel-deletion`.
- Baru (admin): `GET /v1/admin/media/moderation`,
  `GET /v1/admin/media/moderation/:id/history`,
  `GET /v1/admin/media/moderation/:id/preview`,
  `POST /v1/admin/media/moderation/:id/decision`,
  `POST /v1/admin/media/moderation/:id/reopen`,
  `GET /v1/admin/media/deletions/failed`,
  `POST /v1/admin/media/deletions/:id/retry`,
  `POST /v1/admin/media/deletions/reconcile`,
  `GET /v1/admin/media/alerts`,
  `POST /v1/admin/media/alerts/evaluate`.
- Perubahan perilaku: pembacaan media non-pemilik kini juga mensyaratkan
  `moderation_status` yang disetujui. Ini perubahan kontrak yang disengaja dan
  didokumentasikan; tiga test lama disesuaikan (bukan dilonggarkan).

---

## 18. Security findings

1. **Race pembatalan vs worker.** Diselesaikan dengan `FOR UPDATE` pada baris
   media dan outbox; setelah klaim, pembatalan ditolak. Tidak ada jalur yang
   menjanjikan pembatalan atas objek yang sudah hilang.
2. **Pratinjau admin tidak pernah menyajikan file belum-lolos-scan.** Endpoint
   pratinjau menolak dengan `409` bila `scan_status !== 'clean'`, jadi
   karantina tidak bocor lewat jalur reviewer.
3. **Pemisahan wewenang moderasi.** `support` tidak dapat membaca antrean
   (konten belum ditinjau). Keputusan memerlukan `media.moderate` + step-up MFA.
   Operasi queue (`media.ops`) hanya admin/superadmin.
4. **Alert tanpa kebocoran.** `details` tidak memuat key, URL, atau kredensial.
5. **Backup Android.** `dataExtractionRules` mengecualikan `sharedpref` dari
   cloud backup dan device transfer, sehingga token sesi tidak tersalin.
6. **Risiko yang tetap terbuka:** tidak ada CSAM detection (ClamAV tidak bisa),
   tidak ada penyedia moderasi otomatis, dan operator masih dapat melihat
   konten yang belum ditinjau — itu memang pekerjaannya, tetapi aksesnya tidak
   dicatat per-tayangan (hanya keputusan yang tercatat).

---

## 19. Remaining blockers

| Blocker | Alasan | Yang dibutuhkan |
| --- | --- | --- |
| ClamAV daemon nyata | Docker tidak terpasang di mesin pengembangan | Docker/daemon atau jalankan job CI |
| Job CI ClamAV | Workflow belum dieksekusi | Push/PR yang memicu Actions |
| Pengiriman notifikasi | Tidak ada provider/kredensial | Pilih provider + kredensial; implementasikan `AlertNotifier` |
| Moderasi otomatis eksternal | Tidak ada provider/kredensial | Provider + kebijakan data |
| Uji perangkat Android | Tidak ada emulator/perangkat | Emulator atau perangkat fisik |
| SeaweedFS lokal | Dijalankan hanya di CI | Docker |
| AWS S3/IAM/SSE | Tidak diuji | Lingkungan AWS nyata |
| Video di Android | Belum ada layar composer; dilarang di fase ini | Fase terpisah |

---

## 20. Acceptance checklist

### Deletion

| Kriteria | Status | Bukti |
| --- | --- | --- |
| Stale deletion job terdeteksi | **PASS** | `phase6_4.test.ts` reconcile |
| Worker lease recovery berfungsi | **PASS** | `phase6_3.test.ts` lease + `phase6_4` requeue |
| Deletion retry aman | **PASS** | retry dead letter → `pending`, attempts 0 |
| Cancellation hanya sebelum worker claim | **PASS** | `409 MEDIA_DELETION_ALREADY_CLAIMED` |
| Cancellation race aman | **PASS** | `FOR UPDATE` + hasil `race` |
| Dead-letter recovery tersedia | **PASS** | endpoint + audit |
| Kuota tidak dilepas terlalu awal | **PASS** | `deletionPendingBytes` dihitung sampai objek hilang |
| Object deletion diverifikasi | **PASS** | `HEAD` sebelum `deleted` |

### ClamAV

| Kriteria | Status |
| --- | --- |
| ClamAV daemon nyata dapat dihubungkan | **BLOCKED** (tidak ada Docker lokal) |
| Clean-file test lulus | **BLOCKED** (butuh daemon) |
| EICAR test terdeteksi | **BLOCKED** (butuh daemon) |
| Quarantine bekerja | **PASS** untuk logika worker (mock) — **BLOCKED** untuk daemon nyata |
| Scanner failure tidak menghasilkan clean | **PASS** |
| Retry berjalan | **PASS** |
| GitHub Actions menjalankan scanner container | **BLOCKED** (workflow ada, belum dieksekusi) |

### Moderation

| Kriteria | Status |
| --- | --- |
| Malware dan moderation status terpisah | **PASS** |
| Moderation queue tersedia | **PASS** |
| Admin dapat approve/reject | **PASS** |
| Review reason tersimpan | **PASS** |
| Audit trail tersedia | **PASS** |
| Unauthorized reviewer ditolak | **PASS** (`support` → `403`) |
| Media public mengikuti kedua policy | **PASS** |

### Alerting

| Kriteria | Status |
| --- | --- |
| Worker unavailable menghasilkan alert event | **PASS** |
| Dead-letter threshold terdeteksi | **PASS** |
| Scanner unavailable terdeteksi | **PASS** (evaluasi kondisi) |
| Duplicate alert dicegah | **PASS** (`UNIQUE(kind)` + occurrences) |
| Recovery event dicatat | **PASS** (`resolved_at`) |
| Notification provider status jujur | **PASS** (`available() === false`, **delivery BLOCKED**) |

### Testing

| Kriteria | Status |
| --- | --- |
| Backend tests lulus | **PASS** — 103 test, 86 pass, 0 fail, 17 skip (serial) |
| Storage tests lulus | **BLOCKED** (CI saja) |
| ClamAV tests lulus | **BLOCKED** (tanpa daemon; 4 test non-daemon PASS) |
| Android tests lulus | **PASS** (22 unit test, build hijau) |
| Admin build lulus | **PASS** |
| CI workflow tervalidasi | **BLOCKED** (belum dieksekusi) |
| Emulator test tervalidasi | **BLOCKED** |
| Seluruh limitation terdokumentasi | **PASS** |

---

## 21. Recommended next phase

1. **Penyedia moderasi + notifikasi** — satu fase kecil untuk memilih provider,
   menyimpan kredensial di luar repo, dan mengimplementasikan `AlertNotifier`
   serta adapter moderasi di belakang antrean yang sudah ada. Tanpa ini,
   "notifikasi" tetap hanya baris tabel.
2. **Verifikasi CI** — push perubahan dan pastikan job `backend` (serial) dan
   `clamav-integration` hijau. Ini menutup dua BLOCKED terbesar dengan biaya
   paling rendah.
3. **Uji perangkat** — emulator API 34/36 untuk 12 skenario yang sudah ditulis.
4. **Composer video Android** — hanya setelah tiga hal di atas, karena video
   menambah beban scan dan moderasi yang saat ini belum terverifikasi di
   lingkungan nyata.

Jangan menaikkan klaim kesiapan produksi sebelum job CI dan uji perangkat
benar-benar dijalankan.
