# Mindmap

Peta konsep produk menurut PRD. Setiap label memakai kata dari dokumen; kalimat setelah pohon menyebut bagian PRD tempat label itu berasal.

```markdown
RiderJourney  PRD 1
├── Ekosistem (PRD 1)
│   ├── perencanaan rute
│   ├── navigasi
│   ├── pencatatan perjalanan
│   ├── koordinasi rombongan
│   ├── komunikasi real-time
│   ├── keselamatan jalan
│   ├── komunitas
│   └── dokumentasi perjalanan
├── Tujuan bisnis (PRD 1.2)
│   ├── onboarding dan perjalanan pertama
│   ├── touring berhasil tanpa kehilangan sinkronisasi anggota
│   ├── retensi lewat riwayat, profil, komunitas, konten
│   ├── pendapatan berulang tanpa mengunci fungsi keselamatan dasar
│   └── jaringan komunitas motor dan penyelenggara kegiatan
├── Tujuan pengguna (PRD 1.3)
│   ├── posisi rombongan dan status anggota
│   ├── rute dan titik singgah yang telah disepakati
│   ├── jarak, durasi, rute tanpa pencatatan manual
│   ├── jalur komunikasi praktis dan minim distraksi
│   ├── rider, klub, agenda, tempat singgah
│   └── kenangan: foto, cerita, poster, video recap
├── Indikator (PRD 1.4)
│   ├── Crash-free sessions — target awal 99,5% atau lebih
│   ├── Onboarding completion — target awal 70% atau lebih
│   ├── First trip activation — target awal 35% atau lebih dari pengguna baru dalam 7 hari
│   ├── Trip completion rate — target awal 80% atau lebih dari sesi yang dimulai
│   ├── Lokasi konvoi — p95 update terlihat paling lama 8 detik pada jaringan normal
│   └── Pesan konvoi — p95 delivery paling lama 2 detik pada jaringan normal
├── In-scope (PRD 2.1)
│   ├── Android native app
│   ├── registrasi, autentikasi, profil rider, garasi kendaraan
│   ├── peta, pencarian tempat, navigasi, titik singgah, tempat favorit
│   ├── pencatatan sesi touring dan riwayat perjalanan
│   ├── konvoi, undangan, keanggotaan, lokasi real-time
│   ├── chat konvoi dan komunikasi suara/PTT
│   ├── laporan bahaya, peringatan keselamatan, cuaca dasar
│   ├── komunitas/klub, agenda, channel, artikel, album
│   └── feed sosial, interaksi, follow, notifikasi
├── Luar cakupan rilis awal (PRD 2.2)
│   ├── dispatch darurat tanpa integrasi dan perjanjian
│   ├── navigasi offline penuh dan unduhan peta satu negara
│   └── kecepatan sebagai kompetisi atau insentif berkendara cepat
├── Navigasi utama (PRD 4.1)
│   ├── Beranda / Peta
│   ├── Jelajah
│   ├── Journey / Feed
│   ├── Konvoi
│   └── Profil
├── Alur pengguna (PRD 6)
│   ├── 6.1 registrasi sampai perjalanan pertama
│   ├── 6.2 konvoi
│   └── 6.3 laporan bahaya
└── Risiko (PRD 1)
    ├── anggota tertinggal
    ├── informasi rute tidak sinkron
    └── dokumentasi perjalanan tercecer
```

## Bukti per cabang

- Misi: “aplikasi pendamping touring motor yang menyatukan perencanaan rute, navigasi, pencatatan perjalanan, koordinasi rombongan, komunikasi real-time, keselamatan jalan, komunitas, dan dokumentasi perjalanan dalam satu ekosistem” (PRD 1).
- Risiko: “Pemisahan tersebut meningkatkan risiko anggota tertinggal, informasi rute tidak sinkron, dan dokumentasi perjalanan tercecer.” (PRD 1).
- Tujuan bisnis keempat: “model pendapatan berulang melalui paket langganan dan fitur premium tanpa mengunci fungsi keselamatan dasar” (PRD 1.2).
- Target awal, dari PRD 1.4: crash-free sessions paling sedikit 99,5%; onboarding completion paling sedikit 70%; first trip activation paling sedikit 35% pengguna baru dalam 7 hari; trip completion rate paling sedikit 80% sesi yang dimulai; lokasi konvoi p95 update terlihat paling lama 8 detik pada jaringan normal; pesan konvoi p95 delivery paling lama 2 detik pada jaringan normal. PRD 1.4 mengukur tiap barisnya lewat crash analytics, funnel analytics, event `trip_started`, `trip_finished / trip_started`, telemetry real-time, dan WebSocket telemetry.
- Tujuan pengguna kedua: “Menavigasi rute dan titik singgah yang telah disepakati.” (PRD 1.3).
- Indikator (PRD 1.4): “Target tersebut merupakan sasaran produk awal dan harus divalidasi melalui beta test, bukan klaim performa aplikasi referensi.” Angka 99,5%, 70%, 35%, 80%, 8 detik, dan 2 detik adalah ringkasan kata dari baris target yang sama.
- Lingkup konvoi: “Konvoi, undangan, keanggotaan, dan lokasi real-time.” (PRD 2.1).
- Out-of-scope kedua: “Navigasi offline penuh dan unduhan peta satu negara.” (PRD 2.2).
- Tab keempat: “**Konvoi** — konvoi aktif, undangan, chat, voice room, dan daftar anggota.” (PRD 4.1).
