# ANDROID PERMISSIONS — RiderJourney

Matriks izin dan perilaku permintaan izin, mengikuti PRD 12 dan prinsip minim distraksi PRD 11.6. Izin diminta bertahap saat fitur membutuhkan, bukan sekaligus saat onboarding (PRD 12).

## 1. Baseline platform

| Aspek | Nilai | Sumber |
|---|---|---|
| Minimum SDK | 26 (Android 8.0) | PRD 2.3 |
| Target SDK | Mengikuti target Google Play terbaru saat rilis; paket referensi menargetkan 36 | PRD 2.3 |
| Orientasi | Portrait default; landscape untuk navigasi bila diuji | PRD 2.3 |
| Bahasa awal | Indonesia | PRD 2.3 |

Perilaku izin pada level API terbaru harus diuji pada perangkat/emulator sebenarnya sebelum rilis; dokumen ini tidak mengklaim hasil pengujian.

## 2. Matriks izin

| Kapabilitas | Permission manifest | Kapan diminta | Bila ditolak |
|---|---|---|---|
| Peta dan posisi saat aplikasi dipakai | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | Saat pengguna pertama membuka peta atau menekan "Lokasi saya" | Peta tetap terbuka; posisi pengguna tidak ditampilkan; tombol cari rute meminta izin lagi dengan penjelasan |
| Tracking saat layar mati | `ACCESS_BACKGROUND_LOCATION` (API 29+) | Setelah pengguna memulai sesi touring dan memilih "lanjutkan saat layar mati", didahului layar edukasi | Sesi tetap berjalan hanya saat aplikasi terlihat; pengguna diberi tahu bahwa tracking dapat terhenti; tidak ada klaim bahwa sesi aman |
| Foreground service lokasi | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (API 34+) | Otomatis saat sesi tracking dimulai; notifikasi permanen wajib | Tanpa izin ini sesi tidak boleh dimulai; tampilkan error yang dapat ditindaklanjuti |
| Notifikasi | `POST_NOTIFICATIONS` (API 33+) | Setelah pengguna menyelesaikan onboarding dan manfaat notifikasi dijelaskan | Aplikasi tetap berfungsi; undangan dan status konvoi hanya terlihat saat aplikasi dibuka; pengaturan mengarahkan ke system settings |
| Mikrofon (PTT/voice) | `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` (API 34+) | Saat pengguna pertama menekan PTT atau masuk voice room (Fase 2) | Chat teks tetap tersedia; tombol PTT menjelaskan izin dan membuka pengaturan |
| Bluetooth headset/intercom | `BLUETOOTH_CONNECT` (API 31+); `BLUETOOTH` untuk API ≤ 30 | Saat pengguna menghubungkan headset dari layar audio | Audio memakai speaker/headset sistem; tidak ada crash |
| Kamera | `CAMERA` | Saat pengguna mengambil foto profil, laporan, atau album | Pengguna dapat memilih dari galeri/Photo Picker; unggah tetap tersedia |
| Media/gambar | Android Photo Picker (tanpa permission) atau `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` (API 33+) / `READ_EXTERNAL_STORAGE` (≤ 32) hanya bila diperlukan | Saat memilih media | Pengguna dapat membatalkan; tidak ada permintaan berulang otomatis |
| Billing | `com.android.vending.BILLING` | Normal, tanpa dialog runtime | Fitur premium tetap terkunci dengan penjelasan |
| Wake lock | `WAKE_LOCK` | Hanya selama tugas yang benar-benar membutuhkan; dilepas segera | Tidak ada efek ke fitur lain |
| Jaringan | `INTERNET`, `ACCESS_NETWORK_STATE` | Normal | Aplikasi menampilkan mode offline |

Catatan: `ACCESS_BACKGROUND_LOCATION` tidak boleh diminta bersamaan dengan izin lain dalam satu dialog; Android membatasi permintaan ini dan memerlukan penjelasan terpisah.

## 3. Alur permintaan izin

```text
Pengguna menekan aksi (buka peta / mulai touring / PTT)
        ↓
Layar penjelasan singkat: manfaat, data yang dipakai, cara berhenti
        ↓
Dialog sistem (hanya izin yang relevan)
        ↓
Diizinkan → lanjutkan aksi
Ditolak  → tampilkan konsekuensi + tombol "Buka pengaturan" (sekali, tidak memaksa)
Ditolak permanen → arahkan ke pengaturan aplikasi
```

Aturan:

- Tidak ada permintaan izin saat splash/onboarding tanpa konteks fitur.
- Tidak ada permintaan berulang setelah penolakan; gunakan penjelasan dan tautan pengaturan.
- Setiap penolakan menghasilkan state UI yang jelas, bukan tombol mati atau placeholder.
- Alasan izin ditulis dalam Bahasa Indonesia, singkat, dan menjelaskan dampak, bukan meminta izin secara umum.

## 4. Foreground service

- Tipe: `location` (dan `microphone` hanya saat PTT aktif pada Fase 2).
- Notifikasi permanen menampilkan: status sesi, durasi, tombol "Jeda", "Akhiri", dan "Berhenti berbagi lokasi".
- Notifikasi tidak menampilkan koordinat presisi, nama tempat sensitif, atau isi pesan.
- Service dihentikan saat sesi dijeda lama, selesai, atau izin dicabut; status disimpan agar sesi dapat dipulihkan (BR-15).
- Aplikasi tidak menjalankan service lokasi tanpa sesi aktif (PRD 11.3).

## 5. Penghematan baterai dan OEM

- Sampling adaptif: lebih jarang saat diam atau mode hemat baterai, dengan indikator perubahan akurasi (PRD 5.4, 11.3).
- Aplikasi mendeteksi pembatasan background OEM dan menampilkan panduan, tanpa klaim bahwa panduan menjamin tracking berjalan.
- Wake lock dilepas segera setelah tugas selesai.

## 6. Kewajiban distribusi

- Deklarasi background location dan foreground service di Play Console harus diisi sebelum rilis; kebijakan dapat berubah, jadi periksa saat rilis.
- Tidak ada permintaan izin yang tidak dipakai fitur pada build tersebut.
- Data safety form harus konsisten dengan `SECURITY_AND_PRIVACY.md`.
- Izin `QUERY_ALL_PACKAGES` dan akses media penuh tidak dipakai kecuali ada kebutuhan yang disetujui.

## 7. Pengujian izin

| Skenario | Hasil yang diharapkan |
|---|---|
| Tolak lokasi saat membuka peta | Peta tetap tampil, posisi tidak ada, penjelasan muncul |
| Izinkan hanya saat digunakan, lalu matikan layar | Sesi tanpa background location berhenti terkontrol; pengguna diberi tahu |
| Cabut izin lokasi saat sesi aktif | Service berhenti, status sesi disimpan, UI menampilkan tindakan |
| Tolak notifikasi (API 33+) | Aplikasi tetap berjalan; tidak ada crash |
| Tolak mikrofon saat PTT | Chat teks tetap; PTT menjelaskan izin |
| Tolak kamera | Photo Picker tetap tersedia |
| Rotasi layar saat dialog izin | State tidak hilang; tidak ada permintaan ganda |

Semua skenario di atas belum dijalankan pada Fase 0.
