# Tech stack

Daftar teknologi yang disebut PRD, peran yang diberikan dokumen, dan syarat yang menempel padanya. Baris aplikasi dari tabel PRD 9.1; baris server dari rekomendasi PRD 9.2 dan diagram PRD 9.3.

| Lapisan | Teknologi | Peran | Syarat | Sumber |
|---|---|---|---|---|
| Bahasa | Kotlin | bahasa aplikasi | — | PRD 9.1 |
| UI | Jetpack Compose + Material 3 | UI aplikasi | — | PRD 9.1 |
| Arsitektur klien | MVVM / Clean Architecture | repository pattern, use case untuk domain penting | — | PRD 9.1 |
| DI | Hilt atau Koin | dependency injection | “pilih satu” | PRD 9.1 |
| Lokal | Room | local persistence untuk cache, draft, sesi yang perlu dipulihkan | — | PRD 9.1 |
| Background | Foreground Service | active location | — | PRD 9.1 |
| Background | WorkManager | upload/export/retry | — | PRD 9.1 |
| Peta | MapLibre Native | maps | provider tiles sesuai lisensi dan SLA | PRD 9.1 |
| Routing | Valhalla/OSRM | routing | atau layanan routing komersial, dengan fallback teruji | PRD 9.1, 9.2 |
| Geocoding | Photon/Nominatim | geocoding | atau penyedia berlisensi, dengan rate limit | PRD 9.1 |
| Audio realtime | LiveKit/WebRTC | realtime audio | atau layanan setara | PRD 9.1, 9.2 |
| Push | Firebase Cloud Messaging | push | — | PRD 9.1, 9.2 |
| Media | CameraX + Media3/ExoPlayer | kamera dan pemutar video | — | PRD 9.1 |
| 3D | Filament | aset glTF | hanya jika fitur avatar 3D masuk fase lanjutan | PRD 9.1 |
| Billing | Google Play Billing | billing | validasi entitlement di backend | PRD 9.1 |
| Observabilitas | Crash reporting, event analytics | kualitas | redaksi data sensitif | PRD 9.1 |
| API service | NestJS atau Kotlin/Ktor | modular monolith pada tahap awal | boleh diubah bila tim punya infrastruktur lain | PRD 9.2 |
| Database | PostgreSQL + PostGIS | data akun, perjalanan, komunitas, query geospasial | — | PRD 9.2 |
| State realtime | Redis | posisi live, presence, rate limiting, pub/sub | — | PRD 9.2 |
| Transport realtime | WebSocket | event aplikasi | — | PRD 9.2 |
| Object storage | S3-compatible | foto/video/poster dengan signed URL | — | PRD 9.2 |
| Cuaca | Open-Meteo atau provider cuaca lain | cuaca dasar | tampilkan sumber dan waktu update | PRD 9.2 |
| Admin web | Next.js/React | panel admin dan moderasi | role-based access control | PRD 9.2 |
| Push server | Firebase Cloud Messaging | notifikasi perangkat | — | PRD 9.2 |

## Ketentuan yang mengikat stack

Empat hal wajib bertahan meski arsitektur berubah: “Yang wajib dipertahankan adalah isolasi provider, authorization server-side, penyimpanan data lokasi yang aman, serta jalur fallback untuk layanan pihak ketiga.” (PRD 9.4)

Aturan turunan untuk kode klien:

- “Jangan hardcode credential, API key privat, host internal, atau endpoint dev pada aplikasi produksi.” (PRD 9.4)
- “Provider map/routing/geocoding harus berada di balik adapter agar dapat diganti.” (PRD 9.4)
- “Konfigurasi paket, feature flag, quota, dan minimum app version diatur server-side.” (PRD 9.4) Entitlement diverifikasi di backend (PRD 9.1), bukan disimpulkan dari respons pembelian di perangkat.

## Teknologi yang tidak dipilih dokumen

PRD 9 tidak menetapkan bahasa backend tunggal (NestJS dan Kotlin/Ktor disebut sebagai pilihan), provider tiles peta (MapLibre disebut, sumber tiles tidak), atau vendor cloud. Yang tidak disebut berarti keputusan masih terbuka pada level PRD; dokumen ini tidak mengarangnya.

## Catatan taruhan

- Filament hanya untuk avatar 3D di fase lanjutan, jadi avatar 3D tidak boleh menahan rilis inti. (PRD 9.1)
- “Fitur keselamatan inti tidak boleh bergantung pada paket berbayar.” (PRD 5.12)
- Tiga penyedia eksternal — tiles, routing, geocoding — adalah satu-satunya dependency yang bisa membuat aplikasi berhenti berguna; semuanya butuh adapter dan fallback. (PRD 9.4)
- “Nama, harga, masa berlaku, trial, dan entitlement wajib dapat diubah dari backend/admin tanpa pembaruan aplikasi.” (PRD 5.12)
