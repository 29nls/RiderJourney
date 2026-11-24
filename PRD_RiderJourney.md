# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## RiderJourney — Aplikasi Touring, Navigasi, Konvoi, dan Komunitas Motor

**Status dokumen:** Draft baseline untuk pengembangan  
**Versi PRD:** 1.0  
**Tanggal:** 24 November 2026  
**Platform utama:** Android native  
**Wilayah peluncuran awal:** Indonesia  
**Nama produk:** RiderJourney adalah nama kerja; nama final, identitas visual, domain, dan package name harus ditetapkan terpisah.

---

## 0. Cara membaca dokumen dan batas analisis

PRD ini disusun dari inspeksi statis file `Touring+Go_2.0.2_APKPure.xapk` yang diberikan, kemudian dilengkapi dengan rekomendasi desain produk dan arsitektur untuk membangun aplikasi baru dengan kelas fungsi yang serupa.

**Temuan yang dapat diamati pada paket XAPK:** versi aplikasi 2.0.2 / version code 54, minimum Android API 26, target API 36, komponen Android native/Kotlin dan Jetpack Compose Material 3, Room, Firebase, MapLibre, LiveKit/WebRTC, Media3, CameraX, Filament, resource peta, model motor 3D, tema perjalanan, dan koleksi stiker. String dan model data di dalam DEX mengindikasikan modul rider, kendaraan, rute, titik singgah, touring, konvoi, lokasi rider, chat, voice room, komunitas, feed, album, avatar, poin, badge, dan langganan.

**Temuan fitur yang juga tercantum pada listing Google Play:** pelacakan lokasi konvoi secara real-time, voice room/PTT, laporan bahaya jalan, garasi motor, chat konvoi, komunitas/klub, dan pemutar musik lokal. Listing juga menjelaskan kontrol pengguna atas pembagian lokasi dan penghapusan akun. Sumber: halaman Touring Go di Google Play, https://play.google.com/store/apps/details?id=com.touringgo.

**Batasan:** file APK tidak dijalankan pada perangkat/emulator dan tidak dilakukan pengujian trafik server. Karena itu, dokumen ini tidak mengklaim mengetahui seluruh alur layar, aturan backend, harga paket, konfigurasi keamanan, atau perilaku runtime aplikasi referensi. Batas kapasitas dan hak paket yang terlihat diperlakukan sebagai indikasi, bukan spesifikasi resmi yang telah diverifikasi.

**Prinsip implementasi:** buat produk baru dengan merek, desain, source code, aset, konten, dan backend milik sendiri. Jangan menyalin logo, ikon, ilustrasi, stiker, model 3D, teks proprietary, endpoint privat, atau kode dari aplikasi referensi. Kesamaan yang dituju adalah kategori masalah dan cakupan kapabilitas, bukan duplikasi identitas maupun implementasi internal.

---

# 1. Ringkasan eksekutif

RiderJourney adalah aplikasi pendamping touring motor yang menyatukan perencanaan rute, navigasi, pencatatan perjalanan, koordinasi rombongan, komunikasi real-time, keselamatan jalan, komunitas, dan dokumentasi perjalanan dalam satu ekosistem.

Masalah utama yang diselesaikan adalah koordinasi touring yang saat ini tersebar di banyak aplikasi: navigasi di satu aplikasi, posisi rombongan dibagikan melalui aplikasi pesan, komunikasi suara menggunakan perangkat terpisah, dokumentasi diposting ke media sosial, dan riwayat jarak/rute dicatat manual. Pemisahan tersebut meningkatkan risiko anggota tertinggal, informasi rute tidak sinkron, dan dokumentasi perjalanan tercecer.

Produk harus memungkinkan pengguna untuk:

1. Menyiapkan rute dari titik awal, tujuan akhir, dan beberapa titik singgah.
2. Membuat konvoi atau bergabung ke konvoi melalui undangan/kode.
3. Melihat posisi anggota konvoi secara real-time selama sesi aktif.
4. Berkomunikasi melalui chat dan voice/PTT tanpa membuat interaksi berkendara menjadi lebih berbahaya.
5. Merekam perjalanan secara otomatis, lalu melihat statistik dan replay setelah selesai.
6. Melaporkan bahaya jalan serta menerima peringatan relevan dari rider lain.
7. Bergabung ke komunitas motor, mengikuti agenda, berbagi cerita, dan menyimpan album.
8. Mengembangkan profil rider, garasi motor, pencapaian, dan riwayat perjalanan.

Produk dibangun bertahap. Rilis pertama memprioritaskan keselamatan, keandalan GPS, navigasi, konvoi, dan riwayat. Fitur komunitas, media sosial, poster, avatar 3D, sistem poin, serta monetisasi diluncurkan setelah alur inti stabil.

## 1.1 Visi produk

Menjadi platform touring motor yang membuat perjalanan bersama lebih terkoordinasi, lebih aman, dan lebih mudah dikenang.

## 1.2 Tujuan bisnis

- Meningkatkan jumlah rider yang menyelesaikan onboarding dan membuat perjalanan pertama.
- Meningkatkan jumlah touring yang berhasil diselesaikan tanpa kehilangan sinkronisasi anggota.
- Membangun retensi melalui riwayat perjalanan, profil rider, komunitas, dan konten.
- Menciptakan model pendapatan berulang melalui paket langganan dan fitur premium tanpa mengunci fungsi keselamatan dasar.
- Mengembangkan jaringan komunitas motor dan penyelenggara kegiatan.

## 1.3 Tujuan pengguna

- Mengetahui posisi rombongan dan status anggota saat touring.
- Menavigasi rute dan titik singgah yang telah disepakati.
- Mencatat jarak, durasi, dan rute tanpa pencatatan manual.
- Memiliki jalur komunikasi yang praktis dan minim distraksi.
- Menemukan rider, klub, agenda, dan tempat singgah yang relevan.
- Menyimpan kenangan touring dalam bentuk foto, cerita, poster, atau video recap.

## 1.4 Indikator keberhasilan utama

| Indikator | Target awal | Cara ukur |
|---|---:|---|
| Crash-free sessions | >= 99,5% | Crash analytics |
| Onboarding completion | >= 70% | Funnel analytics |
| First trip activation | >= 35% pengguna baru dalam 7 hari | Event `trip_started` |
| Trip completion rate | >= 80% sesi yang dimulai | `trip_finished / trip_started` |
| Lokasi konvoi | p95 update terlihat <= 8 detik pada jaringan normal | Telemetry real-time |
| Pesan konvoi | p95 delivery <= 2 detik pada jaringan normal | WebSocket telemetry |
| Retensi D30 | Baseline ditetapkan setelah beta | Cohort analytics |
| Laporan bahaya valid | Waktu moderasi dan tingkat laporan palsu dipantau | Moderation dashboard |

Target tersebut merupakan sasaran produk awal dan harus divalidasi melalui beta test, bukan klaim performa aplikasi referensi.

---

# 2. Ruang lingkup produk

## 2.1 In-scope

- Android native app.
- Registrasi, autentikasi, profil rider, dan garasi kendaraan.
- Peta, pencarian tempat, navigasi, titik singgah, dan tempat favorit.
- Pencatatan sesi touring dan riwayat perjalanan.
- Konvoi, undangan, keanggotaan, dan lokasi real-time.
- Chat konvoi dan komunikasi suara/PTT.
- Laporan bahaya, peringatan keselamatan, dan informasi cuaca dasar.
- Komunitas/klub, agenda, channel, artikel, dan album.
- Feed sosial, interaksi, follow, dan notifikasi.
- Poster/recap perjalanan dan ekspor media.
- Poin, badge, leaderboard, redeem code, dan paket langganan.
- Panel admin/moderasi berbasis web.
- Backend, API, sistem real-time, storage, analytics, dan monitoring.

## 2.2 Out-of-scope untuk rilis awal

- Ride-hailing, kurir, atau marketplace kendaraan.
- Sistem pembayaran iuran komunitas yang kompleks.
- Penjaminan keselamatan atau layanan dispatch darurat resmi tanpa integrasi dan perjanjian dengan instansi terkait.
- Navigasi offline penuh dan unduhan peta satu negara.
- Streaming musik komersial tanpa lisensi/izin distribusi.
- Video call bebas antar pengguna sebagai fitur utama.
- Integrasi otomatis dengan ECU, OBD, atau perangkat telemetri motor.
- Penghitungan kecepatan sebagai kompetisi atau insentif untuk berkendara cepat.

## 2.3 Platform dan bahasa

| Area | Ketentuan |
|---|---|
| Platform utama | Android native |
| Minimum OS | Android 8.0 (API 26) sebagai baseline kompatibilitas |
| Target SDK | Mengikuti target Google Play terbaru saat rilis; paket referensi menargetkan API 36 |
| Bahasa awal | Bahasa Indonesia |
| Bahasa tambahan | Inggris setelah UX dan konten Indonesia stabil |
| Orientasi | Portrait sebagai default; landscape untuk navigasi jika diuji dan dibutuhkan |
| Koneksi | Online-first; graceful degradation ketika jaringan terputus |

---

# 3. Pengguna, persona, dan hak akses

## 3.1 Persona

**A. Rider individu**  
Menggunakan aplikasi untuk mencari rute, mencatat perjalanan pribadi, menyimpan tempat, mengelola garasi, dan menemukan komunitas.

**B. Ketua konvoi / road captain**  
Membuat rute, menetapkan titik kumpul dan titik singgah, mengundang anggota, memulai/mengakhiri sesi, mengelola anggota, serta menyampaikan informasi penting.

**C. Anggota konvoi**  
Bergabung, membagikan lokasi selama sesi, mengikuti navigasi, menerima pesan/peringatan, dan mengirim laporan kondisi jalan.

**D. Pengurus komunitas**  
Mengelola profil komunitas, anggota, role, agenda, channel, album, artikel, dan aturan komunitas.

**E. Moderator platform**  
Menangani laporan, konten berbahaya, spam, akun palsu, penyalahgunaan lokasi, dan pelanggaran kebijakan.

**F. Super admin / operator**  
Mengelola konfigurasi global, paket, entitlement, poin, redeem code, konten unggulan, banner, dan audit aktivitas admin.

## 3.2 Model role dan permission

| Role | Hak utama |
|---|---|
| Rider | Mengelola akun, kendaraan, rute, perjalanan, posting, dan preferensi privasi sendiri |
| Convoy Leader | Mengelola sesi, rute, undangan, anggota, dan pengumuman konvoi |
| Convoy Co-leader | Membantu pengelolaan konvoi sesuai permission yang diberikan leader |
| Community Owner | Mengelola komunitas, pengurus, anggota, agenda, channel, dan konten komunitas |
| Community Moderator | Moderasi konten/anggota sesuai ruang lingkup komunitas |
| Platform Moderator | Menindak laporan dan konten pada tingkat platform |
| Super Admin | Konfigurasi global dan audit; akses sensitif harus tercatat |

Role harus ditegakkan di backend. Menyembunyikan tombol pada aplikasi bukan mekanisme otorisasi yang memadai.

---

# 4. Navigasi informasi dan struktur layar

## 4.1 Navigasi utama yang direkomendasikan

1. **Beranda / Peta** — peta, posisi saat ini, pencarian lokasi, rute, dan akses cepat ke konvoi.
2. **Jelajah** — pencarian rider, komunitas, tempat, dan konten publik.
3. **Journey / Feed** — postingan perjalanan, status, foto, video, dan interaksi.
4. **Konvoi** — konvoi aktif, undangan, chat, voice room, dan daftar anggota.
5. **Profil** — identitas rider, statistik, garasi, badge, album, pengaturan, dan langganan.

Panel komunitas dapat dibuka dari tab Jelajah maupun Profil sesuai information architecture final.

## 4.2 Daftar layar minimum

| Area | Layar |
|---|---|
| Account | Splash, onboarding, login, registrasi, verifikasi, lupa password, persetujuan privasi |
| Map | Peta utama, pencarian tempat, detail tempat, pilih titik awal/tujuan, editor waypoint, pilihan rute, navigasi aktif |
| Convoy | Buat konvoi, gabung via kode/link, lobby, daftar anggota, peta live, chat, voice room, pengaturan konvoi, selesai |
| Touring | Sesi aktif, jeda/lanjut, ringkasan, daftar riwayat, detail perjalanan, replay, ekspor poster/video |
| Rider | Profil publik, edit profil, garasi, detail kendaraan, daftar pengikut/mengikuti, pencarian rider |
| Safety | Tambah laporan bahaya, detail laporan, peringatan, pusat keselamatan, kontak darurat |
| Community | Direktori, detail komunitas, permintaan bergabung, anggota, agenda, channel, artikel, album |
| Social | Feed, buat posting, detail posting, komentar, status/story, tersimpan, notifikasi |
| Rewards | Poin, riwayat poin, badge, leaderboard, redeem code, avatar/store |
| Subscription | Paket, perbandingan fitur, pembelian, status paket, pemulihan pembelian |
| Settings | Privasi, lokasi, notifikasi, audio, peta, mode hemat baterai, bantuan, ekspor/hapus akun |
| Admin web | Dashboard, user, komunitas, laporan, konten, paket, redeem, konfigurasi, audit log |

---

# 5. Kebutuhan fungsional

Prioritas: **P0 = wajib untuk rilis MVP**, **P1 = penting untuk rilis lanjutan**, **P2 = lanjutan/ekspansi**.

## 5.1 Akun dan autentikasi

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| ACC-01 | P0 | Pengguna dapat mendaftar dengan email dan password; login sosial dapat ditambahkan sebagai opsi. | Akun tercipta satu kali; email diverifikasi sebelum fitur sensitif digunakan. |
| ACC-02 | P0 | Pengguna dapat login, logout, reset password, dan mempertahankan sesi secara aman. | Token tersimpan aman; logout mengakhiri sesi lokal dan token dapat dicabut. |
| ACC-03 | P0 | Username unik dan diperiksa saat pengguna mengetik atau menyimpan. | Username duplikat ditolak oleh server; validasi format dan profanity dijalankan. |
| ACC-04 | P0 | Pengguna dapat meminta penghapusan akun. | Proses meminta konfirmasi ulang, menonaktifkan autentikasi, menghapus/menganonimkan data sesuai kebijakan retensi, dan mencatat status permintaan. |
| ACC-05 | P0 | Pengguna menyetujui Terms, Privacy Policy, dan pengungkapan penggunaan lokasi/mikrofon. | Versi persetujuan, waktu, dan konteks tersimpan. |

## 5.2 Profil rider dan garasi kendaraan

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| RID-01 | P0 | Profil berisi username, nama tampilan, foto, bio, wilayah opsional, dan tautan sosial opsional. | Perubahan tersimpan dan terlihat sesuai pengaturan visibilitas. |
| RID-02 | P0 | Profil memiliki kontrol publik/privat dan kontrol visibilitas data tertentu. | Pengguna dapat menyembunyikan nomor polisi, riwayat, lokasi, dan daftar sosial. |
| VEH-01 | P0 | Rider dapat menambahkan dan mengelola kendaraan. | Field minimum: jenis kendaraan, merek, model, tahun opsional, kapasitas mesin opsional, foto, dan nama panggilan. |
| VEH-02 | P1 | Rider dapat memiliki beberapa kendaraan dan memilih kendaraan utama. | Kendaraan utama ditampilkan pada profil/rekap; batas jumlah kendaraan dapat dikonfigurasi per paket. |
| VEH-03 | P0 | Nomor polisi bersifat opsional dan privat secara default. | Nilai dienkripsi dan tidak ikut tampil pada feed atau peta. |
| RID-03 | P1 | Tema profil, cover, border, badge, dan avatar kendaraan. | Aset dapat dipilih sesuai hak akses dan lisensi aset. |

## 5.3 Peta, pencarian, dan navigasi

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| MAP-01 | P0 | Peta menampilkan posisi pengguna dan arah hadap jika sensor/GPS tersedia. | Status akurasi dan waktu pembaruan posisi terlihat. |
| MAP-02 | P0 | Pengguna dapat mencari alamat, nama tempat, dan kategori tempat sekitar. | Hasil menampilkan nama, jenis, jarak, dan koordinat; hasil kosong/error memiliki state yang jelas. |
| MAP-03 | P0 | Pengguna dapat menentukan titik awal, tujuan, dan maksimal 7 titik singgah sebagai baseline produk. | Waypoint dapat ditambah, dihapus, dipindah urutan, dan dipilih dari peta/pencarian. |
| MAP-04 | P0 | Sistem menghitung jarak, estimasi durasi, dan rute alternatif. | Minimal satu rute valid; alternatif ditampilkan jika routing provider mengembalikannya. |
| MAP-05 | P0 | Pengguna dapat menyimpan lokasi favorit dan menggunakannya lagi. | Favorit tersinkron ke akun dan dapat dihapus. |
| MAP-06 | P1 | Tersedia beberapa gaya peta seperti standar, gelap, satelit, dan terrain jika provider mendukung. | Aturan atribusi map provider ditampilkan dengan benar. |
| MAP-07 | P1 | Navigasi memberikan instruksi belokan visual dan suara. | Pengguna dapat mematikan suara; instruksi tidak mengganggu komunikasi PTT. |
| MAP-08 | P1 | Peringatan rute meliputi titik singgah, potensi bahaya, dan informasi cuaca. | Peringatan diberi waktu pembaruan dan sumber; data cuaca bukan jaminan keselamatan. |
| MAP-09 | P2 | Peta 3D/building/POI dan engine premium. | Implementasi bergantung izin, biaya, dan ketersediaan provider. |

**Aturan navigasi:**
- Rute harus dirancang untuk penggunaan sepeda motor dan menghindari ruas yang ditandai terlarang untuk motor jika data peta memungkinkan.
- Jika data akses jalan tidak lengkap, tampilkan disclaimer dan jangan mengklaim rute pasti legal/aman.
- Kegagalan routing utama harus menghasilkan fallback provider atau pesan kegagalan yang transparan; jangan menampilkan ETA palsu.
- Perubahan rute oleh leader harus disebarkan kepada anggota aktif dan disertai indikator bahwa rute berubah.
- Voice guidance dan PTT harus memiliki prioritas audio yang jelas.

## 5.4 Touring dan riwayat perjalanan

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| TRP-01 | P0 | Pengguna dapat memulai sesi touring personal atau sebagai bagian dari konvoi. | Sesi memiliki ID, status, waktu mulai, dan identitas rider. |
| TRP-02 | P0 | Lokasi direkam selama sesi aktif, termasuk ketika layar mati dengan izin yang sesuai. | Foreground notification tampil; pengguna dapat menghentikan tracking. |
| TRP-03 | P0 | Sistem menghitung jarak, durasi, kecepatan rata-rata, dan rute. | Perhitungan mengabaikan lonjakan GPS tidak wajar dan menyimpan kualitas data. |
| TRP-04 | P0 | Pengguna dapat jeda, lanjut, dan mengakhiri sesi. | Status transisi tervalidasi; sesi tidak berakhir hanya karena aplikasi masuk background. |
| TRP-05 | P0 | Riwayat touring tersimpan dan dapat dibuka. | Detail menampilkan peta rute, waktu, jarak, durasi, dan kendaraan yang digunakan. |
| TRP-06 | P1 | Tersedia replay perjalanan dengan marker bergerak dan foto pada titik tertentu. | Replay dapat diputar, dijeda, dan dipilih kecepatannya; data foto mengikuti izin. |
| TRP-07 | P1 | Pengguna dapat mengunduh poster/rekap perjalanan. | Poster memakai template original; output gambar tersimpan ke galeri. |
| TRP-08 | P2 | Ekspor video perjalanan hingga resolusi tinggi. | Resolusi dibatasi oleh kemampuan perangkat, storage, dan entitlement; proses tidak boleh mengunci UI. |

**Aturan pencatatan:**
- Tracking aktif hanya setelah pengguna memulai sesi dan memberikan izin yang diperlukan.
- Mode hemat baterai dapat mengurangi frekuensi sampling, dengan indikator perubahan akurasi.
- Ketika GPS hilang, simpan status gap; jangan menginterpolasi jarak secara agresif.
- Sesi yang tidak ditutup dengan benar dapat dipulihkan sebagai draft dan meminta konfirmasi pengguna.
- Auto-finish, jika diaktifkan, wajib memiliki batas waktu/jarak dan konfirmasi yang dapat dikonfigurasi.

## 5.5 Konvoi dan live location

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| CNV-01 | P0 | Rider dapat membuat konvoi dengan nama, titik kumpul, tujuan, waypoint, waktu, dan kapasitas. | Kode/link undangan dibuat unik dan dapat dicabut. |
| CNV-02 | P0 | Rider dapat bergabung melalui kode atau tautan. | Server memvalidasi kapasitas, status konvoi, dan kebijakan akses. |
| CNV-03 | P0 | Leader dapat menyetujui/menolak anggota dan mengeluarkan anggota. | Perubahan anggota tercatat di audit log dan dikirim real-time. |
| CNV-04 | P0 | Peta menampilkan posisi anggota yang menyetujui pembagian lokasi. | Hanya anggota konvoi aktif yang berhak melihat lokasi; status lokasi stale/offline terlihat. |
| CNV-05 | P0 | Leader dapat memulai, menjeda, melanjutkan, dan mengakhiri konvoi. | Semua anggota menerima status sesi yang konsisten. |
| CNV-06 | P0 | Anggota dapat melihat posisi leader, anggota lain, dan rute bersama. | Marker memiliki identitas/arah dan tidak menampilkan data sensitif yang tidak diperlukan. |
| CNV-07 | P1 | Tersedia co-leader dan pengalihan kepemimpinan. | Jika leader terputus, co-leader dapat mengambil alih sesuai aturan. |
| CNV-08 | P1 | Sistem mendukung kapasitas berbeda per paket. | Kapasitas ditetapkan di backend dan tidak dapat dimanipulasi aplikasi. |

**Aturan kapasitas awal (konfigurasi, bukan harga final):** paket Free maksimal 3 peserta, Pro maksimal 20, dan Pro Plus maksimal 30. Batas ini diambil dari label kapasitas yang ditemukan di string APK; pemetaan persis antara paket dan kapasitas perlu diuji ulang terhadap aplikasi runtime sebelum dianggap identik.

**Aturan lokasi:**
- Lokasi dibagikan hanya dalam sesi konvoi yang sedang aktif dan kepada anggota yang berhak.
- Setelah keluar/selesai, lokasi live dihentikan; riwayat perjalanan tunduk pada privacy setting.
- Anggota yang tidak mengizinkan berbagi lokasi tetap boleh melihat peta jika kebijakan konvoi mengizinkan, tetapi statusnya harus jelas.
- Lokasi yang lebih lama dari ambang batas ditandai stale, bukan dianggap posisi terkini.
- Pengguna dapat menghentikan pembagian lokasi kapan saja melalui kontrol yang mudah ditemukan.

## 5.6 Chat, voice room, dan audio konvoi

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| COM-01 | P0 | Chat teks dalam konvoi. | Pesan memiliki sender, timestamp, delivery state, dan pagination. |
| COM-02 | P1 | Anggota dapat berbagi titik lokasi atau waypoint melalui chat. | Tautan membuka koordinat/rute di aplikasi dan memeriksa permission. |
| COM-03 | P1 | Voice room mendukung push-to-talk (PTT). | Tombol PTT besar, status transmit terlihat, dan audio hanya dikirim ketika ditekan. |
| COM-04 | P1 | Voice room menunjukkan daftar peserta dan mute state. | Pengguna dapat mute diri sendiri dan keluar room. |
| COM-05 | P2 | Radio/audio konvoi dapat membagikan audio yang diizinkan kepada anggota. | Sumber audio harus legal; PTT dan instruksi navigasi mendapat prioritas dari musik. |
| COM-06 | P1 | Reconnect otomatis saat jaringan pulih. | UI menunjukkan reconnect dan tidak menggandakan pesan/anggota. |

**Keselamatan audio:** semua kontrol utama dapat dijangkau dengan satu tangan dan mudah dikenali. Jangan menempatkan keyboard, pemilihan file, atau dialog kompleks sebagai alur utama saat kendaraan bergerak. Fitur yang membutuhkan perhatian visual tinggi harus meminta pengguna berhenti di tempat aman.

## 5.7 Laporan bahaya dan keselamatan

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| SAF-01 | P0 | Rider dapat melaporkan bahaya jalan: jalan rusak, kecelakaan, kemacetan, polisi/razia, cuaca ekstrem, atau hambatan lain. | Laporan menyimpan jenis, koordinat, waktu, catatan opsional, dan foto opsional. |
| SAF-02 | P0 | Laporan terdekat ditampilkan pada peta dengan status valid/kedaluwarsa. | Laporan lama memiliki TTL; laporan duplikat dapat digabung/ditandai. |
| SAF-03 | P0 | Pengguna dapat menandai laporan sebagai masih ada/tidak relevan. | Reputasi laporan memperhitungkan konfirmasi, bukan jumlah klik mentah. |
| SAF-04 | P1 | Peringatan bahaya prioritas muncul selama navigasi. | Peringatan tidak menutupi seluruh peta dan dapat diatur. |
| SAF-05 | P1 | Tersedia daftar tempat singgah relevan seperti SPBU, bengkel, tempat makan, dan tempat ibadah jika data tersedia. | Kategori ditampilkan berdasarkan data provider; hindari menjamin layanan buka. |
| SAF-06 | P1 | Pengguna dapat menyimpan kontak darurat pribadi. | Kontak disimpan secara privat dan tidak dapat dilihat komunitas. |
| SAF-07 | P2 | Tombol SOS mengirim lokasi dan pesan kepada kontak pilihan. | Tidak mengklaim menghubungi layanan darurat resmi kecuali ada integrasi nyata. |

## 5.8 Komunitas dan klub motor

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| CMT-01 | P1 | Pengguna dapat membuat komunitas/klub dengan nama, deskripsi, logo, cover, wilayah, dan aturan. | Nama/slug unik; owner menjadi admin awal. |
| CMT-02 | P1 | Komunitas dapat bersifat publik atau privat. | Komunitas privat memerlukan persetujuan pengurus. |
| CMT-03 | P1 | Komunitas memiliki role owner, admin, moderator, dan member. | Permission tiap role dapat dikonfigurasi dan diaudit. |
| CMT-04 | P1 | Komunitas dapat menerbitkan agenda touring/event. | Agenda memiliki lokasi, waktu, titik kumpul, kapasitas, dan status. |
| CMT-05 | P1 | Komunitas dapat mempunyai channel teks dan voice. | Hanya member yang berhak dapat mengakses channel privat. |
| CMT-06 | P1 | Komunitas dapat memiliki album foto/video dan artikel. | Upload memeriksa ukuran, format, quota, dan status moderasi. |
| CMT-07 | P2 | Halaman web publik komunitas. | Owner dapat memilih konten publik; website tidak membuka data member privat. |

## 5.9 Feed, Journey, dan interaksi sosial

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| SOC-01 | P1 | Rider dapat membuat posting teks, foto, video, atau recap touring. | Post mempunyai audience: publik, pengikut, komunitas, atau privat. |
| SOC-02 | P1 | Pengguna dapat memberi like/reaksi dan komentar. | Interaksi konsisten dan tidak terhitung ganda saat retry. |
| SOC-03 | P1 | Pengguna dapat follow/unfollow rider dan mengirim permintaan pertemanan bila model sosial menggunakannya. | Status hubungan jelas dan dapat dibatalkan. |
| SOC-04 | P1 | Mention, hashtag, dan simpan posting. | Notifikasi dikirim sesuai preferensi; spam dibatasi. |
| SOC-05 | P2 | Status/story yang kedaluwarsa. | Masa tampil dan penghapusan otomatis ditetapkan jelas. |
| SOC-06 | P1 | Sistem menyediakan laporan konten, blokir, dan mute pengguna. | Konten dari akun yang diblokir tidak muncul di feed default. |

## 5.10 Album, poster, dan media perjalanan

- Album pribadi dan album komunitas memiliki pemilik, kapasitas, metadata, urutan media, dan permission.
- Upload mendukung gambar/video dengan progress, retry, kompresi, dan validasi file.
- Poster perjalanan memiliki template original dengan judul, rute, jarak, durasi, titik singgah, tanggal, dan branding produk sendiri.
- Ekspor video/replay dilakukan di background worker dengan progress dan pembatalan.
- Setiap media harus menghormati hak cipta; aset peta wajib mengikuti lisensi dan atribusi provider.
- Media yang dihapus tidak boleh tetap dapat diakses melalui URL publik permanen.

## 5.11 Poin, badge, leaderboard, dan redeem

| ID | Prioritas | Kebutuhan | Kriteria penerimaan |
|---|---|---|---|
| RWD-01 | P2 | Pengguna memperoleh poin dari aktivitas yang memenuhi aturan. | Semua perubahan saldo dicatat dalam ledger immutable. |
| RWD-02 | P2 | Poin dapat ditukar dengan item kosmetik atau benefit. | Harga dan stok dikelola server. |
| RWD-03 | P2 | Badge diberikan berdasarkan pencapaian yang dapat diverifikasi. | Kriteria transparan dan tidak mendorong kecepatan berbahaya. |
| RWD-04 | P2 | Leaderboard periode mingguan/bulanan/total. | Deteksi fraud dan opsi opt-out privasi tersedia. |
| RWD-05 | P2 | Redeem code dengan masa berlaku, kuota, dan pembatasan akun. | Redeem divalidasi server dan tidak dapat digunakan berulang. |

**Prinsip anti-insentif berbahaya:** jangan memberi poin untuk kecepatan tertinggi, pelanggaran lalu lintas, atau jarak yang mendorong pengguna berkendara ketika lelah. Poin lebih aman diberikan untuk partisipasi komunitas, penyelesaian checklist keselamatan, atau laporan jalan tervalidasi.

## 5.12 Langganan dan monetisasi

Paket dapat dinamai Free, Pro, dan Pro Plus. Nama, harga, masa berlaku, trial, dan entitlement wajib dapat diubah dari backend/admin tanpa pembaruan aplikasi.

| Fitur | Free | Pro | Pro Plus |
|---|---|---|---|
| Navigasi OSM dasar | Ya | Ya | Ya |
| Konvoi live | Ya, kapasitas dasar | Kapasitas lebih besar | Kapasitas tertinggi |
| Kapasitas konvoi indikatif | 3 | 20 | 30 |
| Riwayat touring | Dasar | Diperluas | Diperluas |
| Poster dan tema dasar | Ya | Lebih banyak tema | Seluruh tema premium |
| Ekspor video resolusi tinggi | Terbatas/tidak | Ya, sesuai perangkat | Ya, sesuai perangkat |
| Google Maps/engine premium | Tidak | Dapat diaktifkan | Dapat diaktifkan |
| Avatar/asset eksklusif | Terbatas | Pilihan tambahan | Koleksi eksklusif |
| Bebas iklan | Tidak | Ya | Ya |
| Website komunitas/fitur klub eksklusif | Tidak | Sesuai entitlement | Sesuai entitlement |

Tabel ini adalah rancangan komersial awal. Batas kapasitas 3/20/30, engine Google Maps untuk Pro, dan ekspor 1080p untuk akun berbayar merupakan indikasi dari resource/teks versi APK; keseluruhan matriks tidak boleh dianggap sebagai spesifikasi harga maupun entitlement resmi aplikasi referensi.

Ketentuan transaksi:
- Pembelian diproses melalui Google Play Billing.
- Token/purchase receipt diverifikasi server.
- Perubahan status langganan ditangani melalui notifikasi server-to-server dan rekonsiliasi berkala.
- Restore purchase tersedia.
- Masa tenggang, refund, cancel, dan grace period didefinisikan jelas.
- Fitur keselamatan inti tidak boleh bergantung pada paket berbayar.

## 5.13 Notifikasi

- Push untuk undangan konvoi, perubahan rute, anggota bergabung/keluar, pesan penting, agenda, komentar/mention, laporan bahaya, dan status langganan.
- Notifikasi harus bisa diatur per kategori.
- Badge unread count harus sinkron dengan data server.
- Pengiriman pesan dan notifikasi harus idempotent; retry tidak boleh menciptakan duplikasi.
- Hindari notifikasi promosi saat sesi navigasi aktif kecuali pesan keselamatan yang valid.

## 5.14 Admin dan moderasi

Admin web minimum menyediakan:

- Dashboard metrik penggunaan dan kesehatan layanan.
- Pencarian akun, status akun, role, subscription, dan riwayat pelanggaran.
- Review laporan bahaya dan laporan konten.
- Moderasi posting, komentar, foto, video, komunitas, dan akun.
- Suspend/ban dengan alasan, masa berlaku, dan audit log.
- Pengelolaan paket, entitlement, banner, fitur, quota, poin, badge, redeem code, dan konten unggulan.
- Pengelolaan daftar kategori tempat dan jenis bahaya.
- Pengaturan remote config dan minimum version.
- Ekspor laporan operasional dengan kontrol akses.

Setiap tindakan admin sensitif wajib menyimpan actor, target, waktu, alasan, before/after, dan request ID.

---

# 6. Alur pengguna utama

## 6.1 Registrasi sampai perjalanan pertama

1. Pengguna membuka aplikasi dan membaca onboarding singkat.
2. Pengguna mendaftar/login dan menyetujui kebijakan.
3. Pengguna mengatur username serta profil minimum.
4. Aplikasi menjelaskan manfaat akses lokasi saat touring; permission diminta saat konteks fitur dibutuhkan.
5. Pengguna membuka peta, mencari tujuan, dan menyusun waypoint.
6. Pengguna memilih rute lalu memulai sesi personal atau membuat konvoi.
7. Aplikasi menampilkan indikator sesi aktif dan foreground notification.
8. Pengguna mengakhiri sesi; aplikasi menyimpan ringkasan dan riwayat.

## 6.2 Membuat dan menjalankan konvoi

1. Leader mengisi nama konvoi, titik kumpul, tujuan, waktu, dan batas peserta.
2. Backend membuat convoy ID dan kode/link undangan.
3. Anggota masuk ke lobby dan menyetujui aturan pembagian lokasi.
4. Leader memulai sesi; server mengaktifkan channel lokasi dan komunikasi.
5. Peta menampilkan anggota, status koneksi, dan rute bersama.
6. Anggota menggunakan chat/PTT dan mengirim laporan bahaya jika diperlukan.
7. Leader mengakhiri sesi; lokasi live dihentikan dan riwayat disimpan.

## 6.3 Melaporkan bahaya

1. Pengguna memilih kategori bahaya dari kontrol cepat.
2. Aplikasi mengambil koordinat terkini dan waktu.
3. Pengguna dapat menambahkan catatan/foto; pengisian harus bisa diselesaikan ketika kendaraan berhenti.
4. Server menyimpan laporan dan menerbitkan event ke pengguna/konvoi yang relevan.
5. Rider lain dapat mengonfirmasi laporan.
6. Laporan kedaluwarsa otomatis atau diturunkan prioritasnya berdasarkan TTL dan konfirmasi.

## 6.4 Mengelola komunitas

1. User membuat komunitas dan menjadi owner.
2. Owner melengkapi identitas, aturan, dan mode publik/privat.
3. User lain menemukan komunitas lalu bergabung/mengajukan permintaan.
4. Pengurus menyetujui anggota dan mengatur role.
5. Pengurus mempublikasikan agenda, album, artikel, dan channel.
6. Member menerima notifikasi sesuai preferensi.

---

# 7. Aturan bisnis dan edge cases

| ID | Aturan |
|---|---|
| BR-01 | Satu rider hanya boleh memiliki satu sesi touring aktif pada satu waktu, kecuali produk secara eksplisit mendukung multi-device handoff. |
| BR-02 | Satu rider hanya boleh berada dalam satu konvoi aktif pada satu waktu untuk menghindari konflik lokasi dan audio. |
| BR-03 | Hanya leader/co-leader yang berhak mengubah rute konvoi; perubahan disinkronkan ke semua anggota. |
| BR-04 | Kode undangan harus memiliki expiry, batas penggunaan, dan kemampuan revoke. |
| BR-05 | Lokasi live hanya tersedia selama sesi aktif dan berdasarkan consent. |
| BR-06 | Jika lokasi tidak diperbarui melewati ambang, anggota diberi status stale/offline. |
| BR-07 | Jika leader disconnect, co-leader dapat mengambil alih; jika tidak ada, konvoi masuk status menunggu leader atau dapat diakhiri dengan aturan fallback. |
| BR-08 | GPS tidak valid/fake tidak otomatis memicu ban; sistem menandai anomali dan meminta review untuk leaderboard/reward. |
| BR-09 | Laporan bahaya memiliki TTL dan confidence score; laporan lama tidak tampil setara dengan laporan baru. |
| BR-10 | Batas paket dan entitlement diverifikasi server-side. |
| BR-11 | Penghapusan akun harus memproses data turunan, token, media, dan keanggotaan sesuai kebijakan retensi serta kewajiban hukum. |
| BR-12 | Pengguna yang diblokir tidak dapat mengirim pesan, mention, atau melihat data privat pemblokir. |
| BR-13 | Media yang gagal diunggah harus dapat di-retry tanpa membuat duplikasi. |
| BR-14 | Saat koneksi terputus, UI memperlihatkan mode degraded dan tidak berpura-pura bahwa lokasi/pesan telah terkirim. |
| BR-15 | Auto-finish touring tidak boleh menghapus sesi akibat aplikasi dibunuh OS; sesi harus dapat dipulihkan. |

---

# 8. Model data konseptual

Model berikut adalah rancangan baru untuk backend. Nama dan relasi dapat berubah setelah desain teknis final.

| Entitas | Field inti |
|---|---|
| `users` | id, auth_uid, username, display_name, avatar_url, cover_url, bio, city, visibility, status, created_at |
| `user_settings` | user_id, location_sharing_default, trip_history_visibility, notification_preferences, audio_preferences, map_preferences |
| `vehicles` | id, owner_id, type, brand, model, year, engine_cc, photo_url, plate_encrypted, is_primary |
| `follows` | follower_id, followed_id, status, created_at |
| `friend_requests` | id, requester_id, recipient_id, status, responded_at |
| `favorite_places` | id, user_id, place_name, category, latitude, longitude, provider_ref |
| `routes` | id, owner_id, name, start_point, destination, waypoints, route_geometry, distance_m, duration_s, provider |
| `convoys` | id, leader_id, name, invite_code_hash, status, capacity, route_id, started_at, ended_at |
| `convoy_members` | convoy_id, user_id, role, status, joined_at, last_seen_at, sharing_consent |
| `convoy_positions` | convoy_id, user_id, lat, lng, accuracy, heading, speed, recorded_at; data live sebaiknya di cache/stream, bukan query berat |
| `trips` | id, user_id, convoy_id, vehicle_id, status, started_at, ended_at, distance_m, duration_s, avg_speed, route_polyline |
| `trip_points` | trip_id, sequence_no, lat, lng, accuracy, speed, heading, recorded_at |
| `convoy_messages` | id, convoy_id, sender_id, type, body, attachment_ref, created_at, delivery_state |
| `hazard_reports` | id, reporter_id, type, lat, lng, note, media_ref, status, confidence, expires_at |
| `communities` | id, owner_id, name, slug, description, visibility, avatar_url, cover_url, storage_quota |
| `community_members` | community_id, user_id, role, status, joined_at |
| `community_channels` | id, community_id, name, type, visibility |
| `community_events` | id, community_id, title, description, meeting_point, start_at, capacity, status |
| `community_albums` | id, community_id, owner_id, title, visibility, created_at |
| `media_assets` | id, owner_id, storage_key, mime_type, size_bytes, checksum, moderation_status |
| `feed_posts` | id, author_id, community_id, type, caption, audience, created_at, visibility_status |
| `post_comments` | id, post_id, author_id, body, parent_id, created_at |
| `post_reactions` | post_id, user_id, reaction_type, created_at |
| `user_notifications` | id, user_id, type, payload, read_at, created_at |
| `subscriptions` | id, user_id, plan_code, status, provider, purchase_token_ref, expires_at |
| `point_ledger` | id, user_id, delta, reason, reference_id, created_at |
| `badges` / `user_badges` | badge definitions and earned state |
| `redeem_codes` / `redemptions` | code hash, quota, expiry, reward, redeemed_by, redeemed_at |
| `reports` | id, reporter_id, target_type, target_id, reason, status, moderator_id, resolved_at |
| `admin_audit_logs` | actor_id, action, target_type, target_id, before_json, after_json, reason, created_at |

**Catatan penyimpanan:** foto/video disimpan pada object storage dengan signed URL dan CDN; database hanya menyimpan metadata dan key. Geometri rute dan pencarian radius memerlukan indeks geospasial (PostGIS atau teknologi setara). Posisi live harus memakai mekanisme streaming/cache agar update berfrekuensi tinggi tidak membebani database transaksional.

---

# 9. Arsitektur teknis yang direkomendasikan

## 9.1 Baseline mobile

| Lapisan | Rekomendasi |
|---|---|
| Bahasa | Kotlin |
| UI | Jetpack Compose + Material 3 |
| Arsitektur | MVVM / Clean Architecture, repository pattern, use case untuk domain penting |
| DI | Hilt atau Koin; pilih satu |
| Local persistence | Room untuk cache, draft, dan sesi yang perlu dipulihkan |
| Background work | Foreground Service untuk active location; WorkManager untuk upload/export/retry |
| Maps | MapLibre Native; provider tiles sesuai lisensi dan SLA |
| Routing | Valhalla/OSRM atau layanan routing komersial dengan fallback teruji |
| Geocoding | Photon/Nominatim atau penyedia berlisensi dengan rate limit |
| Realtime audio | LiveKit/WebRTC atau layanan setara |
| Push | Firebase Cloud Messaging |
| Media | CameraX + Media3/ExoPlayer |
| 3D | Filament untuk aset glTF jika fitur avatar 3D masuk fase lanjutan |
| Billing | Google Play Billing; validasi entitlement di backend |
| Crash/analytics | Crash reporting dan event analytics dengan redaksi data sensitif |

## 9.2 Backend dan layanan

Rekomendasi baseline yang dapat diskalakan:

- **API service:** NestJS atau Kotlin/Ktor sebagai modular monolith pada tahap awal.
- **Database:** PostgreSQL + PostGIS untuk data akun, perjalanan, komunitas, dan query geospasial.
- **Realtime state:** Redis untuk posisi live, presence, rate limiting, dan pub/sub.
- **Realtime transport:** WebSocket untuk event aplikasi; LiveKit untuk audio PTT/voice room.
- **Object storage:** S3-compatible storage untuk foto/video/poster dengan signed URL.
- **Push:** Firebase Cloud Messaging.
- **Authentication:** Firebase Auth atau OIDC provider; backend tetap memverifikasi token.
- **Routing services:** Valhalla/OSRM serta geocoding provider dengan adapter abstraction.
- **Weather:** Open-Meteo atau provider cuaca lain; tampilkan sumber dan waktu update.
- **Admin web:** Next.js/React dengan role-based access control.
- **Observability:** centralized logs, metrics, traces, crash analytics, alerting, dan audit log.

Arsitektur ini boleh diubah jika tim sudah memiliki infrastruktur lain. Yang wajib dipertahankan adalah isolasi provider, authorization server-side, penyimpanan data lokasi yang aman, serta jalur fallback untuk layanan pihak ketiga.

## 9.3 Gambaran arsitektur

```text
Android App (Kotlin / Compose)
  |-- HTTPS API ----------------------> API Gateway / Backend
  |                                      |-- PostgreSQL + PostGIS
  |-- WebSocket (convoy/events) ------> |-- Redis (presence/live positions)
  |-- LiveKit/WebRTC (PTT) -----------> |-- LiveKit SFU
  |-- FCM <---------------------------- |-- Push Notification Worker
  |-- Signed media URLs --------------> |-- Object Storage + CDN
                                         |-- Billing Verification
                                         |-- Moderation/Admin API
                                         |-- Routing/Geocoding Adapters

Admin Web (Next.js) ------------------> Backend Admin API
External providers: map tiles, routing, geocoding, weather, Google Play Billing
```

## 9.4 Prinsip desain sistem

- Provider map/routing/geocoding harus berada di balik adapter agar dapat diganti.
- Event lokasi tidak dikirim melalui query polling berat jika WebSocket dapat digunakan.
- Jangan menyimpan setiap ping GPS dalam database utama tanpa kebijakan sampling/retensi.
- Semua endpoint mutasi memerlukan auth, validation, authorization, rate limit, dan idempotency bila relevan.
- Konfigurasi paket, feature flag, quota, dan minimum app version diatur server-side.
- Jangan hardcode credential, API key privat, host internal, atau endpoint dev pada aplikasi produksi.

---

# 10. API dan event real-time (kontrak tingkat tinggi)

Daftar ini adalah rancangan endpoint baru, bukan endpoint yang diekstrak atau ditiru dari aplikasi referensi.

## 10.1 REST API

| Domain | Contoh endpoint | Tujuan |
|---|---|---|
| Auth/Profile | `POST /v1/auth/session`, `GET /v1/me`, `PATCH /v1/me` | Sesi dan profil |
| Vehicles | `GET/POST /v1/vehicles`, `PATCH/DELETE /v1/vehicles/{id}` | Garasi |
| Places | `GET /v1/places/search`, `GET /v1/places/nearby` | Pencarian tempat |
| Routes | `POST /v1/routes/preview`, `POST /v1/routes/{id}/recalculate` | Perhitungan rute |
| Favorites | `GET/POST /v1/favorites`, `DELETE /v1/favorites/{id}` | Tempat favorit |
| Convoys | `POST /v1/convoys`, `POST /v1/convoys/join`, `POST /v1/convoys/{id}/start` | Siklus konvoi |
| Trips | `POST /v1/trips/start`, `POST /v1/trips/{id}/finish`, `GET /v1/trips` | Pencatatan perjalanan |
| Hazards | `POST /v1/hazards`, `GET /v1/hazards/nearby`, `POST /v1/hazards/{id}/confirm` | Laporan bahaya |
| Chat | `GET /v1/convoys/{id}/messages`, `POST /v1/convoys/{id}/messages` | Chat dan history |
| Community | `/v1/communities/*` | Komunitas dan agenda |
| Feed | `/v1/feed/*`, `/v1/posts/*` | Konten sosial |
| Billing | `POST /v1/billing/verify`, `GET /v1/subscription` | Status entitlement |
| Admin | `/v1/admin/*` | Operasional dan moderasi |

## 10.2 WebSocket events

| Event | Arah | Payload minimum |
|---|---|---|
| `convoy.member.joined` | Server -> room | convoy_id, user_id, role, timestamp |
| `convoy.member.left` | Server -> room | convoy_id, user_id, timestamp |
| `convoy.location.updated` | Client -> server -> room berhak | convoy_id, lat, lng, accuracy, heading, speed, recorded_at |
| `convoy.location.stale` | Server -> room | convoy_id, user_id, last_seen_at |
| `convoy.route.updated` | Server -> room | convoy_id, route_id, route_version |
| `convoy.status.changed` | Server -> room | convoy_id, status, actor_id |
| `convoy.message.created` | Server -> room | message_id, sender_id, type, created_at |
| `hazard.created` | Server -> area/room | hazard_id, type, coordinate, expires_at |
| `voice.participant.changed` | Voice provider -> client | room_id, participant_id, state |

Semua event memerlukan autentikasi, validasi keanggotaan, sequence/timestamp, dan strategi reconnect. Event lokasi tidak boleh disiarkan ke channel publik.

---

# 11. Non-functional requirements (NFR)

## 11.1 Kinerja dan skalabilitas

- Cold start target <= 5 detik pada perangkat Android kelas menengah yang disepakati.
- Pemuatan peta awal target <= 4 detik pada koneksi normal setelah cache tersedia.
- Preview rute target p95 <= 8 detik; timeout dan fallback harus terdefinisi.
- Update lokasi konvoi target p95 <= 8 detik pada kondisi jaringan normal.
- Pengiriman chat target p95 <= 2 detik pada kondisi jaringan normal.
- Aplikasi tidak boleh crash atau kehilangan sesi hanya karena rotasi, background, atau process recreation.
- Sistem harus diuji dengan simulasi 30 anggota pada satu konvoi dan beban multi-konvoi serentak.

## 11.2 Keandalan

- API produksi memiliki target availability minimal 99,5% pada fase awal.
- Reconnect WebSocket dan voice room harus menangani perpindahan jaringan seluler/Wi-Fi.
- Semua operasi kritis memiliki loading, empty, error, retry, dan offline/degraded state.
- Data trip yang belum tersinkron disimpan lokal secara aman dan dikirim ulang ketika koneksi pulih.
- Backup database diuji melalui simulasi restore.

## 11.3 Baterai dan penggunaan data

- GPS sampling adaptif berdasarkan status gerak, akurasi, dan mode hemat baterai.
- Lokasi tidak dilacak ketika tidak ada sesi aktif kecuali pengguna secara eksplisit mengaktifkan fitur yang sah.
- Foto/video dikompresi sesuai kebijakan kualitas sebelum upload.
- Peta dan media menggunakan cache dengan batas ukuran dan kontrol pengguna.
- Pengguna mendapat indikator ketika mode hemat baterai menurunkan akurasi tracking.

## 11.4 Keamanan

- TLS untuk seluruh komunikasi.
- Enkripsi at-rest untuk database, backup, storage, dan field sensitif.
- Token disimpan menggunakan Android Keystore/secure storage; jangan menyimpan password plaintext.
- RBAC dan pemeriksaan kepemilikan objek selalu dilakukan di backend.
- Rate limit untuk login, join code, chat, upload, redeem, dan laporan.
- Signed URL dengan expiry untuk media privat.
- Audit log untuk tindakan admin dan perubahan entitlement.
- Secret/API key tidak boleh dibundel jika memberi akses privileged.
- Penanganan laporan abuse dan account takeover harus tersedia.

## 11.5 Privasi

- Lokasi live hanya dibagikan ketika pengguna memulai sesi dan mengaktifkan sharing.
- Pengguna mendapat penjelasan yang jelas sebelum izin background location diminta.
- Privasi trip default: hanya pemilik, kecuali pemilik membagikannya.
- Nomor polisi dan kontak darurat bersifat privat secara default.
- Tersedia ekspor data dan permintaan penghapusan akun.
- Kebijakan retensi harus ditetapkan, misalnya lokasi live dibersihkan setelah sesi berakhir dan data telemetri mentah memiliki masa retensi terbatas.
- Jangan memakai koordinat presisi untuk periklanan atau profiling tanpa consent terpisah dan dasar pemrosesan yang sah.

## 11.6 Aksesibilitas dan keselamatan berkendara

- Tombol navigasi/voice utama berukuran besar dan memiliki kontras tinggi.
- Pengoperasian saat berkendara dibatasi pada interaksi sederhana; pengetikan dan pengaturan kompleks diarahkan untuk dilakukan saat berhenti.
- Voice guidance dan PTT tidak boleh saling menutupi tanpa prioritas audio.
- Peringatan keselamatan tidak menggunakan animasi atau notifikasi yang mengagetkan.
- Tersedia pengaturan mute, pengurangan animasi, ukuran teks, dan mode gelap.
- Aplikasi menyampaikan bahwa pengendara tetap wajib mematuhi rambu dan kondisi jalan; data rute/laporan bukan jaminan keamanan.

---

# 12. Permission Android

Permission diminta bertahap pada saat fitur membutuhkan, bukan sekaligus saat aplikasi pertama kali dibuka.

| Permission / capability | Alasan | Kebijakan |
|---|---|---|
| Fine/Coarse Location | Peta dan navigasi | Minta saat pengguna membuka fitur peta/lokasi |
| Background Location | Tracking saat layar mati selama touring aktif | Minta setelah edukasi dan hanya jika flow aktif membutuhkannya; sediakan kontrol stop |
| Foreground Service - Location | Menjaga sesi touring terlihat saat background | Tampilkan notifikasi permanen selama sesi aktif |
| Microphone | PTT/voice room | Minta saat pengguna mengaktifkan fitur suara |
| Bluetooth Connect | Headset/intercom | Minta saat pengguna menghubungkan perangkat yang membutuhkan permission |
| Notifications | Undangan, chat, status konvoi | Minta setelah manfaat notifikasi dijelaskan |
| Camera/Media | Foto profil, laporan, feed, album | Minta saat pengguna melakukan upload/capture |
| Audio media access | Pemutar musik lokal jika disediakan | Gunakan Android Photo Picker/SAF atau permission granular yang berlaku |
| Wake lock | Menjaga proses yang benar-benar diperlukan saat trip | Lepas segera setelah tugas selesai |
| Billing | Langganan | Mengikuti Google Play Billing |

Jangan meminta akses kamera, mikrofon, lokasi background, dan media sekaligus saat onboarding tanpa konteks penggunaan. Sediakan fallback bila izin ditolak.

---

# 13. Analytics dan observability

## 13.1 Event produk minimum

- `signup_started`, `signup_completed`, `login_completed`
- `profile_completed`, `vehicle_added`
- `route_search_started`, `route_previewed`, `route_started`
- `convoy_created`, `convoy_joined`, `convoy_started`, `convoy_member_disconnected`, `convoy_finished`
- `location_permission_granted`, `location_sharing_started`, `location_sharing_stopped`
- `trip_started`, `trip_paused`, `trip_resumed`, `trip_finished`, `trip_recovered`
- `hazard_reported`, `hazard_confirmed`, `hazard_expired`
- `chat_sent`, `ptt_started`, `ptt_ended`
- `community_joined`, `community_event_rsvp`
- `post_created`, `post_reacted`, `post_commented`
- `subscription_started`, `subscription_renewed`, `subscription_cancelled`

Event analytics tidak boleh menyimpan koordinat presisi, nomor polisi, isi chat privat, token, atau data sensitif yang tidak diperlukan.

## 13.2 Monitoring teknis

- Crash-free users/sessions dan ANR.
- GPS accuracy, stale location rate, dan failed location updates.
- WebSocket reconnect rate dan event delivery latency.
- Voice room join success, packet loss, jitter, dan disconnect rate.
- API p95 latency, error rate, dan provider routing failure.
- Media upload failure dan storage quota.
- Push delivery status.
- Payment verification failures dan entitlement mismatch.

---

# 14. Rencana pengujian dan acceptance criteria

## 14.1 Pengujian fungsional

- Registrasi, login, reset password, logout, dan penghapusan akun.
- Username duplikat, format tidak valid, dan akun diblokir.
- Tambah/edit/hapus kendaraan dengan foto dan tanpa foto.
- Pencarian tempat, rute tanpa waypoint, rute dengan 1-7 waypoint, dan rute provider gagal.
- Touring dengan layar menyala, layar mati, perpindahan jaringan, GPS hilang, dan aplikasi dibunuh OS.
- Konvoi penuh, kode invalid, anggota keluar, leader disconnect, leader handoff, dan kapasitas paket habis.
- Chat retry, pesan ganda, pesan offline, dan reconnect.
- PTT permission ditolak, headset Bluetooth, konflik dengan voice guidance, dan jaringan buruk.
- Laporan bahaya duplikat, laporan palsu, TTL kedaluwarsa, dan moderasi.
- Komunitas privat/publik, role berbeda, dan akses channel.
- Upload media besar, format tidak didukung, storage quota penuh, dan retry.
- Pembelian, restore purchase, refund, expiry, dan perubahan paket.

## 14.2 Pengujian perangkat dan kondisi lapangan

- Android 8 hingga versi Android terbaru yang didukung.
- Perangkat low-end, mid-range, dan high-end.
- RAM terbatas, baterai rendah, mode hemat daya, dan pembatasan background OEM.
- Sinyal 4G lemah, 5G, Wi-Fi, berpindah jaringan, dan tidak ada koneksi sementara.
- GPS di area perkotaan padat, jalan terbuka, terowongan, dan area pegunungan.
- Pengujian nyata dengan rombongan motor hanya dilakukan dalam kondisi aman, rute legal, dan tidak menuntut pengemudi mengoperasikan layar saat bergerak.

## 14.3 Acceptance gate MVP

MVP dapat dirilis ke beta apabila:

1. Pengguna dapat mendaftar dan mengelola profil tanpa kehilangan data.
2. Rute utama dapat dicari dan ditampilkan dengan fallback yang jelas.
3. Sesi touring dapat direkam saat layar mati sesuai permission.
4. Konvoi dapat dibuat, dimasuki, dimulai, dan diakhiri.
5. Posisi anggota hanya terlihat untuk peserta berhak dan memiliki status freshness.
6. Chat dan notifikasi tidak menggandakan pesan saat retry.
7. Riwayat touring tersimpan dan dapat dibuka kembali.
8. Pengguna dapat menghentikan sharing lokasi dan meminta penghapusan akun.
9. Admin dapat menindak laporan dan memeriksa audit log.
10. Tidak ada blocker keamanan kritis atau kebocoran lokasi privat.

---

# 15. Roadmap implementasi

## Fase 0 — Discovery dan fondasi

- Validasi persona, use case, dan desain navigasi.
- Tetapkan brand, domain, package name, lisensi peta, routing provider, dan kebijakan privasi.
- Buat threat model, data classification, database schema, API contract, dan UI system.
- Siapkan CI/CD, environments dev/staging/prod, crash analytics, dan observability.

**Exit criteria:** desain arsitektur disetujui, backlog terpecah, risiko privasi lokasi dianalisis, dan peta provider dipilih.

## Fase 1 — MVP touring inti (P0)

- Authentication dan profil rider.
- Garasi kendaraan dasar.
- Peta, pencarian, waypoint, dan preview rute.
- Trip tracking background dan riwayat.
- Create/join convoy, invite code, live location, dan status anggota.
- Chat teks dasar dan push notification.
- Laporan bahaya dasar.
- Admin minimal untuk user, laporan, dan konfigurasi.

**Exit criteria:** seluruh acceptance gate MVP terpenuhi dalam internal test dan beta terbatas.

## Fase 2 — Komunikasi dan komunitas (P1)

- LiveKit/WebRTC PTT dan voice rooms.
- Komunitas/klub, role, agenda, channel, artikel, dan album.
- Feed, follow, interaksi, notifikasi sosial.
- Tempat favorit, tema peta tambahan, dan navigasi suara.

**Exit criteria:** pengujian audio dan moderasi lulus; permission dan kebijakan lokasi jelas.

## Fase 3 — Journey dan engagement (P1/P2)

- Replay perjalanan.
- Poster template original dan ekspor gambar.
- Upload media dan album yang lebih lengkap.
- Profil bertema, badge, dan leaderboard.

**Exit criteria:** media pipeline stabil, biaya storage terukur, serta kontrol privasi tersedia.

## Fase 4 — Monetisasi dan fitur premium (P2)

- Paket Free/Pro/Pro Plus.
- Google Play Billing, entitlement, restore, dan subscription lifecycle.
- Avatar 3D/asset store, fitur map premium, ekspor video, redeem, poin, dan website komunitas.
- Optimasi biaya routing, audio, storage, dan CDN.

**Exit criteria:** audit billing, fraud, hak aset, dan unit economics selesai.

---

# 16. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Background location dibatasi OEM/Android | Tracking terhenti | Foreground service, edukasi battery optimization, recovery session, test perangkat nyata |
| GPS tidak akurat | Jarak/rute salah | Filter outlier, simpan accuracy, tampilkan gap, jangan mengarang jalur |
| Peta/routing provider berubah atau mahal | Peta gagal/biaya meningkat | Adapter, fallback provider, cache, usage quota, monitoring |
| Lokasi bocor | Risiko keselamatan dan privasi | Consent, ACL per convoy, TTL, audit, encryption, security test |
| Voice latency/jitter | Komunikasi tidak dapat dipakai | TURN/SFU regional, network adaptation, reconnect, telemetry |
| Penyalahgunaan laporan bahaya | Informasi menyesatkan | TTL, konfirmasi multi-rider, reputasi, moderation, report abuse |
| Biaya upload foto/video | Cost storage membengkak | Kompresi, quota, lifecycle policy, CDN, batas file |
| Fraud poin/leaderboard | Data pencapaian tidak valid | Server-side scoring, anomaly detection, review manual |
| Langganan tidak sinkron | Komplain dan kehilangan akses | Receipt verification, server notifications, reconciliation job |
| Distraksi berkendara | Risiko cedera | Voice-first, UI minimal, lock interaction kompleks, pesan keselamatan |
| Hak cipta aset/musik/peta | Risiko hukum | Aset original, lisensi tertulis, atribusi, audit sumber konten |

---

# 17. Keputusan yang harus ditetapkan sebelum development penuh

1. Nama produk, logo, domain, package name, dan panduan brand.
2. Apakah backend menggunakan Firebase-heavy architecture atau PostgreSQL/PostGIS + Redis sebagai data inti.
3. Provider peta, tile, geocoding, routing, dan biaya per penggunaan.
4. Kapasitas konvoi tiap paket dan harga resmi langganan.
5. Kebijakan lokasi: default sharing, durasi retensi, histori yang dapat dibagikan, dan mekanisme delete.
6. Apakah PTT wajib di MVP atau dapat menjadi fase 2.
7. Batas ukuran file, quota media per komunitas, dan storage cost.
8. Kriteria leaderboard, anti-cheat, dan mekanisme banding.
9. Kebutuhan admin web dan siapa yang dapat mengakses data sensitif.
10. Kebijakan usia pengguna, Terms, Privacy Policy, moderasi, serta kontak darurat.

---

# 18. Checklist kesiapan sebelum coding agent mulai bekerja

- [ ] PRD ini disetujui sebagai baseline dan perubahan dicatat.
- [ ] Brand dan aset produk baru sudah tersedia.
- [ ] User flow dan wireframe layar P0 sudah dibuat.
- [ ] Database ERD dan migration plan disetujui.
- [ ] API contract OpenAPI dibuat.
- [ ] Kontrak event WebSocket ditentukan.
- [ ] Firebase/OIDC, FCM, map provider, routing, geocoding, dan storage environment siap.
- [ ] Kebijakan permission, location privacy, data retention, dan account deletion disetujui.
- [ ] Threat model dan security baseline selesai.
- [ ] Test device matrix dan skenario lapangan disiapkan.
- [ ] CI/CD, staging, observability, dan backup/restore berjalan.
- [ ] MVP backlog sudah dipecah menjadi task yang dapat diuji secara independen.

---

# 19. Referensi dan tingkat keyakinan

## 19.1 Sumber yang dianalisis

1. **File yang diberikan pengguna:** `Touring+Go_2.0.2_APKPure.xapk` — inspeksi statis arsip XAPK, manifest metadata, daftar file APK, string DEX, model data, permission, pustaka, dan assets.
2. **Google Play listing Touring Go:** https://play.google.com/store/apps/details?id=com.touringgo — deskripsi publik fitur utama dan keterangan privacy/user control.

## 19.2 Tingkat keyakinan

| Pernyataan | Tingkat keyakinan | Catatan |
|---|---|---|
| Paket yang dianalisis adalah Touring Go 2.0.2, version code 54 | Tinggi | Tertera di manifest.json dalam XAPK |
| Baseline Android API 26 dan target API 36 | Tinggi | Metadata XAPK |
| Aplikasi memakai Kotlin/Compose dan pustaka AndroidX Compose | Tinggi | Artefak DEX dan metadata dependency |
| Ada integrasi MapLibre, LiveKit/WebRTC, Firebase, Room, Media3, CameraX, Filament | Tinggi | Class/dependency/resource ditemukan dalam APK; tidak memvalidasi seluruh runtime behavior |
| Ada modul konvoi, lokasi rider, rute, trip, komunitas, feed, album, poin, dan subscription | Tinggi untuk keberadaan model/string; sedang untuk alur detail | Model dan string ditemukan, tetapi seluruh layar tidak dijalankan |
| Batas peserta 3/20/30 | Sedang | Label kapasitas ditemukan; pemetaan paket perlu verifikasi runtime |
| Hak premium Google Maps/1080p/asset tertentu | Sedang | Beberapa label/teks entitlement ditemukan; matriks lengkap belum diverifikasi |
| Struktur database, API bisnis, algoritma rute, harga paket, dan prosedur admin | Tidak dapat dipastikan dari inspeksi statis | Didefinisikan sebagai rancangan produk baru di PRD |

---

**Akhir dokumen — PRD RiderJourney v1.0**
