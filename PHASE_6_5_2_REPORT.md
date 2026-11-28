# PHASE 6.5.2 REPORT — Android Emulator Infrastructure & E2E Coverage

Tanggal: 28 November 2026
Repository: `29nls/RiderJourney`, branch `verify/phase-6.5`
Baseline sebelum fase: `6452ca3`
Commit akhir fase: `eb8ee59` (kode dan workflow) + `b270247` (dokumentasi)
Fase sebelumnya: `PHASE_6_5_REPORT.md`, `PHASE_6_5_1_REPORT.md`

---

## 1. Executive summary

Blocker emulator di 6.5.1 **bukan** karena runner tidak punya KVM. Runner punya
`/dev/kvm`, tetapi node itu tidak bisa dibuka user runner, dan action
`reactivecircus/android-emulator-runner` menambahkan `-accel off` ketika
`accessSync('/dev/kvm', R_OK|W_OK)` gagal. Emulator 37 menolak `-accel off`
mentah-mentah, jadi emulator tidak pernah boot — dan `connectedDebugAndroidTest`
keluar 0 tanpa test, yang pada run #13 terbaca hijau.

Fase ini memperbaiki akar masalah itu, bukan melemahkan prasyarat KVM:

1. `/dev/kvm` diberi mode 0666 lewat udev rule, lalu **di-assert** bisa dibaca
   dan ditulis (bukan sekadar "file ada"). Langkah ini keras: gagal bila tidak.
2. Action dijalankan dengan `disable-linux-hw-accel: false`, sehingga `-accel off`
   tidak pernah ditambahkan. Tidak ada TCG, tidak ada software emulation.
3. Gate hasil test diperketat: manifest 26 test wajib, per API, dengan summary
   JSON mesin-terbaca.

Hasil:

| Area | Status | Bukti |
| --- | --- | --- |
| Hardware acceleration runner | **PASS** | run #23 job `emulator-capability`: `crw-rw-rw-`, read/write yes, `Boot completed in 30919 ms` |
| Emulator API 34 boot | **PASS** | `boot-api34.txt`: `1` / `34` / `x86_64` |
| Emulator API 36 boot | **PASS** | `boot-api36.txt`: `1` / `36` / `x86_64` |
| ADB connection | **PASS** | `adb devices -l`, `adb reverse` aktif di log action |
| Instrumented tests API 34 | **PASS** | 26 dieksekusi, 26 lulus, 0 gagal, 0 skip |
| Instrumented tests API 36 | **PASS** | 26 dieksekusi, 26 lulus, 0 gagal, 0 skip |
| Strict result gate | **PASS** | step gate success pada kedua job, `status: PASS` |
| Workflow penuh | **PASS** | run #23 `46097769865`, 9 job success |

Cakupan yang **belum** ada (jujur, bukan diklaim): matriks status scan
(unscanned/clean/quarantined/pending/approved/rejected) belum diuji karena job
E2E tidak menjalankan ClamAV; gangguan jaringan, process death, dan WorkManager
recovery belum diuji. Rinciannya di bagian 14.

---

## 2. Repository baseline

- Branch kerja: `verify/phase-6.5`. `main` tidak disentuh, tidak ada force push.
- Awal fase: `6452ca3` (gate 6.5.1). Akhir fase: `eb8ee59`.
- Commit fase ini, berurutan:

| Commit | Isi |
| --- | --- |
| `d6cb98a` | job `emulator-capability` + udev grant |
| `567da33` | boot lewat action dengan `disable-linux-hw-accel: false` |
| `6d5a5ad` | matrix API 34/36, backend+PostGIS+SeaweedFS, gate manifest, 26 test |
| `9525517` | readiness `/health/ready`, assertion `UNAUTHENTICATED` |
| `e6fbd00` | script action jadi perintah satu-baris |
| `c841e49` | `chmod +x gradlew` |
| `91554e3` | graph test tanpa `@EntryPoint`, gate rekursif, perbaikan test expiry |
| `eb8ee59` | PUT memakai header yang ditandatangani, regex tamper `X-Amz-Signature` |
| `b270247` | laporan 6.5.2 + README, TEST_PLAN, PRODUCTION_READINESS, REQUIREMENTS_MATRIX, ROADMAP |

Pekerjaan 6.1–6.5.1 tidak diubah. Satu-satunya perubahan pada kode produk adalah
dua `Modifier.testTag` di `AuthScreen.kt` dan `AppRoot.kt` (3 tag auth + tag tab),
supaya UI test punya pegangan stabil. Tidak ada perubahan perilaku.

---

## 3. Runner selection

Tiga opsi dievaluasi; yang dipakai adalah **Opsi B dalam bentuk yang benar-benar
terverifikasi**, yaitu hosted `ubuntu-latest` (bukan larger runner):

| Opsi | Keputusan | Alasan berbasis bukti |
| --- | --- | --- |
| A. Self-hosted dengan KVM | Tidak dipakai | Tidak diperlukan: hosted runner terbukti boot. Self-hosted menambah risiko runner persisten untuk kode PR. |
| B. GitHub-hosted | **Dipakai** | `ubuntu-latest` memberi `/dev/kvm` (10,232) dan CPU dengan flag `vmx/svm` (4 entri). Eligibility larger runner tidak diklaim karena tidak diuji. |
| C. macOS hosted | Tidak dipakai | Tidak diuji; biaya 10× dan tidak perlu karena Linux sudah terbukti. |

Tidak ada `ANDROID_I_WANT_MY_TCG`, tidak ada `-accel off`, tidak ada
`continue-on-error` pada job emulator.

---

## 4. KVM / hardware diagnostics

Diambil dari job `emulator-capability` pada run #23 (log job `140832977473`),
sebelum dan sesudah perbaikan:

```
Linux runnervm3lb7s 7.0.0-1020-azure #21-Ubuntu SMP PREEMPT x86_64 GNU/Linux
cpus: 4
passwordless-sudo: yes
uid=1001(runner) gid=1001(runner) groups=1001(runner),4(adm),100(users),112(docker),999(systemd-journal)
kvm:x:991:
crw-rw---- 1 root kvm 10, 232 Nov 28 02:19 /dev/kvm
kvm-readable: no
kvm-writable: no
232 kvm
cpu-flags-vmx-svm: 4
kvm_intel: absent
```

Interpretasi:

- Node `/dev/kvm` **ada** dan kernel mengenalnya (`/proc/misc: 232 kvm`).
- Grup `kvm` ada tetapi **tanpa anggota**; user `runner` tidak ada di dalamnya.
- Mode `crw-rw---- root:kvm` membuat `accessSync(R_OK|W_OK)` gagal → action
  menyimpulkan "no KVM" → menambahkan `-accel off` → emulator 37 abort.
- CPU mengekspos `vmx/svm`, jadi virtualisasi bersarang tersedia untuk guest.

Perbaikan yang dipakai (dan di-assert):

```
KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"
→ crw-rw-rw- 1 root kvm 10, 232
→ kvm-readable-after-fix: yes
→ kvm-writable-after-fix: yes
→ disable Linux hardware acceleration: false
→ Android emulator version 37.3.10.0 (build_id 16970787)
→ Boot completed in 30919 ms
```

`/dev/kvm` adalah satu-satunya jalur; TCG tidak dipakai sama sekali.

---

## 5. Emulator API 34

Job `android-emulator (34)`, id `140832977610`, conclusion **success**
(02:22:46Z → 02:27:07Z).

Boot proof (artefak `boot-api34.txt`):

```
1
34
x86_64
```

Baris pertama adalah `sys.boot_completed`, kedua `ro.build.version.sdk`, ketiga
`ro.product.cpu.abi`. Script action meng-assert `sys.boot_completed = "1"` sebelum
Gradle dijalankan, jadi job tidak mungkin lanjut tanpa boot nyata.

Hasil test (artefak `connected-summary-api34.json`):

```json
{ "apiLevel": "34", "emulatorBoot": "1", "xmlFiles": 1,
  "executedTotal": 26, "passed": 26, "failed": 0, "errors": 0, "skipped": 0,
  "mandatory": { "total": 26, "missing": [], "notPassed": [] }, "status": "PASS" }
```

---

## 6. Emulator API 36

Job `android-emulator (36)`, id `140832977510`, conclusion **success**.

Boot proof (`boot-api36.txt`): `1` / `36` / `x86_64`.

Summary (`connected-summary-api36.json`): 26 dieksekusi, 26 lulus, 0 gagal,
0 error, 0 skip, `missing: []`, `notPassed: []`, `status: PASS`.

Kedua API memakai image `google_apis`, `arch: x86_64`, `emulator-boot-timeout: 600`.

---

## 7. Instrumentation test inventory

Sebelum fase ini repo hanya punya 2 test instrumented. Sekarang 26, dalam 7 kelas:

| Kelas | Jumlah | Fokus |
| --- | --- | --- |
| `id.riderjourney.app.data.MediaContentUriTest` | 2 | content URI + margin presigned intent (test lama, dipertahankan) |
| `id.riderjourney.app.e2e.AuthenticationE2ETest` | 5 | register, logout→login, token persisten, refresh, tanpa token |
| `id.riderjourney.app.e2e.ProfileMediaE2ETest` | 5 | avatar unggah/tampil/ganti/hapus, kuota, status hapus |
| `id.riderjourney.app.e2e.VehicleMediaE2ETest` | 5 | tambah kendaraan + foto, list, ganti, hapus, media in-use |
| `id.riderjourney.app.e2e.MediaSecurityE2ETest` | 4 | akun lain tidak bisa URL/hapus, capability terikat id, tanpa token |
| `id.riderjourney.app.e2e.MediaRecoveryE2ETest` | 3 | duplikat clientMediaId, URL tamper → intent baru, complete tanpa objek |
| `id.riderjourney.app.e2e.UiJourneyE2ETest` | 2 | form auth muncul; login lewat form membuka shell |

Identifier lengkap ada di `android/tools/required-connected-tests.txt` (26 baris),
dan gate menolak manifest yang tidak cocok dengan method nyata di
`android/app/src/androidTest`.

Semua 26 berstatus **PASS** di API 34 dan **PASS** di API 36.

---

## 8. E2E user journey results

| Requirement brief | Test | Status |
| --- | --- | --- |
| Login | `UiJourneyE2ETest#loginThroughTheFormOpensTheProfileTab` | PASS |
| Logout | `AuthenticationE2ETest#loginAfterLogoutRestoresTheSameAccount` | PASS |
| Session persistence | `AuthenticationE2ETest#storedTokensSurviveANewRepositoryInstance` | PASS |
| Session expiration | `AuthenticationE2ETest#expiredAccessTokenIsRefreshedFromTheStoredRefreshToken` | PASS (token akses dirusak, refresh nyata) |
| Unauthorized access | `AuthenticationE2ETest#requestWithoutATokenIsRejected` | PASS |
| Buka profil / unggah avatar | `ProfileMediaE2ETest#uploadedAvatarBecomesTheProfileAvatarAndIsReadable` | PASS |
| Tampilkan avatar | test yang sama (signed URL → byte nyata) | PASS |
| Ganti avatar | `ProfileMediaE2ETest#replacingTheAvatarMovesTheReferenceToTheNewMedia` | PASS |
| Hapus avatar | `ProfileMediaE2ETest#removingTheAvatarClearsTheProfileReference` | PASS |
| Refresh kuota | `ProfileMediaE2ETest#quotaCountsTheBytesOfAnUploadedAvatar` | PASS |
| Status penghapusan | `ProfileMediaE2ETest#deletingAnUnreferencedMediaReportsDeleting` | PASS |
| Tambah kendaraan + foto | `VehicleMediaE2ETest#addingAVehicleWithAPhotoStoresTheReference` | PASS |
| Tampilkan foto kendaraan | `VehicleMediaE2ETest#garageListReportsTheVehiclePhoto` | PASS |
| Ganti foto | `VehicleMediaE2ETest#replacingTheVehiclePhotoSwapsTheReference` | PASS |
| Hapus foto | `VehicleMediaE2ETest#clearingTheVehiclePhotoRemovesTheReference` | PASS |
| Referensi media | `VehicleMediaE2ETest#aPhotoStillUsedByAVehicleCannotBeDeleted` | PASS |
| Media tidak untuk pengguna lain | `MediaSecurityE2ETest` (4 test) | PASS |
| Duplicate prevention | `MediaRecoveryE2ETest#repeatingTheSameClientMediaIdDoesNotCreateASecondMedia` | PASS |
| Presigned URL kedaluwarsa/tamper → intent baru | `MediaRecoveryE2ETest#aTamperedPresignedUrlIsRejectedAndAFreshIntentUploads` | PASS |
| Content URI lama | `MediaContentUriTest` (2 test) | PASS |

Tidak ada `Assume`, tidak ada skip, tidak ada mock HTTP: setiap test menembak
backend nyata lewat `BuildConfig.API_BASE_URL`.

---

## 9. Backend integration results

Job emulator menjalankan stack nyata, bukan stub:

- PostgreSQL/PostGIS `postgis/postgis:16-3.4` (service container), readiness
  `/health/ready` yang benar-benar mengeksekusi `postgis_version()`.
- Migrasi `0001`–`0013` lewat `npm run migration:run`.
- SeaweedFS 4.55 sebagai S3 nyata, bucket `rj-media-e2e` dibuat dengan SDK yang
  sama dengan jalur penyimpanan aplikasi.
- API `node dist/main.js` dengan `NODE_ENV=test` (menonaktifkan throttler agar
  ~35 pendaftaran akun per suite tidak dijawab 429), `HOST=0.0.0.0`.
- Emulator → host: API lewat `10.0.2.2:3000` (diizinkan cleartext di
  `network_security_config.xml`), storage lewat `adb reverse tcp:8333` karena
  URL ditandatangani untuk `127.0.0.1:8333`.
- Akun test dibuat per test dengan email unik; runner ephemeral, DB dan bucket
  ikut hilang setelah job.

Verifikasi end-to-end nyata terlihat di run #22/#23: 26 test membuat akun,
mengunggah objek, membaca byte kembali, dan menerima penolakan otorisasi dari
API — bukan dari stub.
---

## 10. Test-result gate verification

Gate: `node android/tools/check-connected-results.mjs --api <level> --boot <v> --summary <path>`.

Yang diperiksa, berurutan: direktori hasil ada → ada XML → manifest ada → setiap
id manifest punya method nyata di `androidTest` → setiap id manifest dieksekusi →
status `passed` (bukan `skipped`/`failed`/`error`) → tidak ada kegagalan lain.

Uji lokal dengan fixture (semua sebelum push):

| Kasus | Harapan | Hasil |
| --- | --- | --- |
| 26 report bersih | exit 0 | `OK all-pass: exit=0` |
| satu id hilang | exit 1 | `OK one-missing: exit=1` |
| satu `<failure>` | exit 1 | `OK one-failed: exit=1` |
| satu `<skipped/>` | exit 1 | `OK one-skipped: exit=1` |
| zero testcase | exit 1 | `OK zero-tests: exit=1` |
| manifest menunjuk method tak ada | exit 1 | `OK drift: exit=1` |
| summary JSON | tertulis | `summary written: true PASS` |

Uji terhadap output Gradle nyata:

- Run #21 (25 gagal): gate dibaca ulang dari artefak →
  `api=34 boot=1 executed=26 passed=1 failed=25 errors=0 skipped=0 mandatory=26 missing=0`,
  exit 1. Gate menemukan XML di subdirektori `debug/` yang Gradle tulis.
- Run #23 (semua lulus): kedua job gate **success**, summary `status: PASS`.

Gate tidak pernah mengubah kegagalan infrastruktur menjadi sukses produk: pada
run #18–#21 job tetap merah ketika stack/emulator/test belum benar.

---

## 11. GitHub Actions run IDs

Semua pada branch `verify/phase-6.5`, event `pull_request`.

| Run | ID | SHA | Hasil | Catatan |
| --- | --- | --- | --- | --- |
| #15 | `45997098101` | `6452ca3` | failure | gate 6.5.1 menolak hasil kosong (benar) |
| #16 | `46093052674` | `d6cb98a` | failure | job capability gagal di instalasi SDK tulisan tangan |
| #17 | `46093247427` | `567da33` | failure | capability **success**, emulator boot 30.9s |
| #18 | `46094503106` | `6d5a5ad` | failure | stack API: poll `/health` salah alamat (404) |
| #19 | `46094863820` | `9525517` | failure | stack OK; script action: group multi-baris = syntax error |
| #20 | `46095374444` | `e6fbd00` | failure | boot + adb reverse OK; `./gradlew` exit 126 |
| #21 | `46095971696` | `c841e49` | failure | 26 test jalan; 25 gagal (ClassCastException Hilt, test expiry) |
| #22 | `46097121600` | `91554e3` | failure | 24/26 lulus; 2 gagal (header PUT, regex tamper) |
| **#23** | **`46097769865`** | **`eb8ee59`** | **success** | **26/26 lulus di API 34 dan 36** |

Run #23, 9 job, semuanya success:

| Job | Job ID | Waktu |
| --- | --- | --- |
| `backend` | `140832977398` | 02:22:45Z → 02:24:56Z |
| `admin` | `140832977532` | 02:22:46Z → 02:23:07Z |
| `android` | `140832977497` | 02:22:46Z → 02:26:04Z |
| `media-integration` | `140832977650` | 02:22:45Z → 02:23:08Z |
| `clamav-integration` | `140832977583` | 02:22:46Z → 02:23:30Z |
| `postgres-integration` | `140832977703` | 02:22:46Z → 02:23:27Z |
| `emulator-capability` | `140832977473` | 02:22:46Z → 02:24:19Z |
| `android-emulator (34)` | `140832977610` | 02:22:46Z → 02:27:07Z |
| `android-emulator (36)` | `140832977510` | success |

---

## 12. Artifacts dan log

| Artefak | ID | Ukuran | Isi |
| --- | --- | --- | --- |
| `android-connected-api34` | `15243748941` | 104 494 B | XML JUnit, logcat per test, `boot-api34.txt`, `connected-summary-api34.json`, `backend.log`, `seaweed.log` |
| `android-connected-api36` | `15243793618` | 146 141 B | sama untuk API 36 |
| `emulator-capability-evidence` | `15244620060` | 1 543 B | `boot-proof.txt`, `avd-config.ini` |
| `android-lint` | `15243977869` | 32 746 B | laporan lint job `android` |

Ambil ulang:

```bash
# metadata
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/29nls/RiderJourney/actions/runs/46097769865/jobs"

# artefak (butuh token dengan akses actions:read)
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/29nls/RiderJourney/actions/artifacts/15243748941/zip" -o api34.zip
```

Log job lengkap (dengan token yang sama):

```bash
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/29nls/RiderJourney/actions/jobs/140832977610/logs"
```

Tanpa token, log job dan unduhan artefak menjawab `403 Must have admin rights`
untuk repo ini; metadata run/job tetap terbaca publik. Karena itu diagnosis di
fase ini memakai artefak (`backend.log`, XML, logcat).

---

## 13. Security findings

- **Tidak ada kredensial produksi** di workflow. Yang dipakai: JWT secret khusus
  CI, kunci enkripsi plat khusus CI, kredensial SeaweedFS sementara
  (`ciaccess`/`cisecret123`) yang hanya hidup di runner ephemeral.
- **Tidak ada data pengguna nyata**: semua akun dibuat test dengan domain
  `@e2e.riderjourney.test` dan dihapus bersama container.
- **Artefak tidak memuat token**: logcat per test dan `backend.log` berisi
  request id, path, status; tidak ada header `Authorization` maupun presigned URL
  yang dicetak.
- **Presigned URL tidak bocor ke jaringan host**: URL ditandatangani untuk
  `127.0.0.1:8333` dan hanya terjangkau dari emulator lewat `adb reverse`.
- **Cleartext dibatasi**: `network_security_config.xml` hanya mengizinkan
  `10.0.2.2`, `127.0.0.1`, `localhost`; host lain tetap `cleartextTrafficPermitted="false"`.
- **Throttler dinonaktifkan hanya pada `NODE_ENV=test`** di job ini. Itu bukan
  konfigurasi produksi dan tidak mengubah perilaku default.
- **Udev rule** mengubah izin `/dev/kvm` menjadi 0666 pada VM ephemeral. Ini
  pelemahan izin lokal yang disengaja dan terbatas pada runner sekali pakai;
  alternatif yang lebih ketat adalah menambahkan user runner ke grup `kvm`.
- Temuan 6.5.1 (unit `@EntryPoint` yang tidak bisa di-cast di androidTest)
  diperbaiki dengan menyusun graph dari konstruktor publik, bukan dengan
  menambahkan dependency Hilt testing yang lebih luas.

---

## 14. Known limitations

1. **Matriks status scan belum diuji.** Job E2E tidak menjalankan ClamAV, dan
   pemilik media memang selalu bisa membaca medianya sendiri
   (`m.owner_id = $2` di `accessible()`), jadi unscanned/clean/quarantined/
   pending/approved/rejected untuk **penonton lain** belum punya test.
2. **Gangguan jaringan, process death, WorkManager recovery, kuota habis** tidak
   diuji. Yang ada: duplikasi intent, URL kadaluwarsa/tamper, complete tanpa
   objek, dan penolakan hapus saat media masih dipakai.
3. **"Session expiration"** diuji dengan merusak access token lalu membuktikan
   refresh nyata, bukan dengan menunggu TTL habis.
4. **Tidak ada screenshot saat gagal.** Yang dikumpulkan: XML, logcat per test,
   `backend.log`, `seaweed.log`.
5. **API 36 memakai suite yang sama** dengan API 34; belum ada test khusus
   perilaku platform 36.
6. **Image `google_apis`**, bukan `google_apis_playstore`; Play Billing tetap
   tidak tercakup.
7. Job `emulator-capability` menambah satu boot ekstra (~4 menit) per pipeline.
   Itu disengaja sebagai penjaga regresi prasyarat KVM.

---

## 15. Remaining blockers

| Blocker | Status | Alasan |
| --- | --- | --- |
| AWS S3 / IAM / STS / SSE | BLOCKED | tidak ada akun/bucket AWS |
| Notification provider | BLOCKED | tidak ada kredensial |
| Automated moderation provider | BLOCKED | tidak ada kredensial |
| ClamAV di E2E device | BLOCKED | belum dijalankan di job emulator |
| Staging / production verified | BLOCKED | tidak diotorisasi, tidak ada environment |
| Play Billing device verification | BLOCKED | butuh Play Console + license tester |

---

## 16. Acceptance checklist

INFRASTRUCTURE

- [x] Runner hardware acceleration verified — `crw-rw-rw-`, read/write yes, emulator 37.3.10.0, boot 30.9 s.
- [x] Emulator API 34 boots — `boot-api34.txt` = `1 / 34 / x86_64`.
- [x] Emulator API 36 boots — `boot-api36.txt` = `1 / 36 / x86_64`.
- [x] ADB connection works — `adb devices -l` + `adb reverse` di log action.
- [x] Emulator startup logs available — job log + `emulator-capability-evidence`.

TEST COVERAGE

- [x] Authentication instrumented tests — 5 test, PASS.
- [x] Profile media instrumented tests — 5 test, PASS.
- [x] Vehicle media instrumented tests — 5 test, PASS.
- [x] Media security tests — 4 test, PASS (kepemilikan & capability).
- [ ] Matriks status scan (unscanned/clean/quarantined/pending/approved/rejected) — **belum**, lihat 14.1.
- [x] Network recovery (partial) — duplikasi, URL tamper/kadaluwarsa, complete tanpa objek.
- [ ] Process death recovery — **belum**.
- [x] Existing content URI tests execute — 2/2 PASS di kedua API.
- [x] All mandatory test IDs present — 26/26, `missing: []`.

VALIDATION

- [x] API 34 E2E PASS — 26/26.
- [x] API 36 E2E PASS — 26/26.
- [x] No skipped mandatory test — `skipped: 0`.
- [x] No false green — run #18–#22 merah sampai benar; gate menolak XML kosong.
- [x] XML reports contain actual executions — 26 `<testcase>` di kedua API.
- [x] Test artifacts uploaded.
- [x] GitHub Actions results recorded — run #23.

REPOSITORY

- [x] Existing phase changes preserved — 6.1–6.5.1 tidak disentuh.
- [x] No production credentials committed.
- [x] No force push, no push ke `main`.
- [x] Documentation updated — README, TEST_PLAN, PRODUCTION_READINESS, REQUIREMENTS_MATRIX, ROADMAP.

**Status fase: PASS untuk infrastruktur emulator dan E2E yang dieksekusi;
PARTIAL untuk cakupan test (scan matrix, process death, gangguan jaringan).**
Tidak ada item di atas yang ditandai lulus tanpa run nyata.

---

## 17. Recommended next phase

1. **6.6 — Media state & recovery di perangkat**: jalankan clamd di job emulator,
   tambah test matriks status scan untuk penonton lain, plus gangguan jaringan,
   process death (`am kill` + relaunch), dan WorkManager recovery.
2. **Screenshot & trace saat gagal** (hook `TestWatcher` → `UiDevice.takeScreenshot`).
3. **Provider notifikasi + moderasi otomatis** di belakang antrean yang sudah ada.
4. **AWS staging** dengan bucket terisolasi sebelum klaim S3 produksi.
5. Baru setelah itu composer video.

---

## Reproduksi

Workflow (otomatis pada push ke `verify/phase-6.5`):

```bash
git checkout verify/phase-6.5
git log --oneline -8          # eb8ee59 adalah commit hijau
git push origin verify/phase-6.5
```

Lokal (tanpa emulator) untuk gate dan kompilasi suite:

```bash
node --check android/tools/check-connected-results.mjs
cd android && ./gradlew.bat --no-daemon assembleDebugAndroidTest   # BUILD SUCCESSFUL
cd .. && node android/tools/check-connected-results.mjs --help || true
```

Uji gate dengan report nyata dari artefak run #23:

```bash
node android/tools/check-connected-results.mjs \
  --results "<hasil-unzip>/android/app/build/outputs/androidTest-results/connected" \
  --manifest android/tools/required-connected-tests.txt \
  --api 34 --boot 1 --summary /tmp/summary.json
# → 26 baris PASS, "api=34 boot=1 executed=26 passed=26 ... mandatory=26 missing=0"
```
