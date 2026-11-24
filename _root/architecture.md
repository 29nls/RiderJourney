

- Struktur database, API bisnis, algoritma rute, harga paket, dan prosedur admin berada di antara area yang “Tidak dapat dipastikan dari inspeksi statis” dan “Didefinisikan sebagai rancangan produk baru di PRD” (PRD 19.2).
- PRD 18 meminta “Kontrak event WebSocket ditentukan.”; checklist itu belum ditandai, dan chat tidak boleh menggandakan pesan saat retry (PRD 18).
- Backend “Firebase-heavy architecture” atau “PostgreSQL/PostGIS + Redis sebagai data inti” belum dipilih — terbuka (PRD 17 butir 2).

## Pemisahan

- **Aplikasi:** Kotlin + Compose menjalankan peta, sesi touring, konvoi, chat/voice/PTT, laporan bahaya, riwayat, dan poster. Untuk pekerjaan latar belakang, PRD 9.1 menyebut “Foreground Service untuk active location” dan “WorkManager untuk upload/export/retry”.
- **API service:** “NestJS atau Kotlin/Ktor sebagai modular monolith pada tahap awal.” (PRD 9.2) Daftar endpoint REST di PRD 10.1 adalah “rancangan endpoint baru, bukan endpoint yang diekstrak atau ditiru dari aplikasi referensi” (PRD 10.1), dan event WebSocket baru dirinci di PRD 10.2.
- **Database:** “PostgreSQL + PostGIS untuk data akun, perjalanan, komunitas, dan query geospasial.” (PRD 9.2)
- **Realtime state:** “Redis untuk posisi live, presence, rate limiting, dan pub/sub.” (PRD 9.2)
- **Realtime transport:** “WebSocket untuk event aplikasi; LiveKit untuk audio PTT/voice room.” (PRD 9.2)
- **Storage:** “Catatan penyimpanan: foto/video disimpan pada object storage dengan signed URL dan CDN; database hanya menyimpan metadata dan key.” (PRD 8)
- **Push:** “Firebase Cloud Messaging.” (PRD 9.2)
- **Auth:** “Firebase Auth atau OIDC provider; backend tetap memverifikasi token.” (PRD 9.2)
- **Admin:** “Next.js/React dengan role-based access control.” (PRD 9.2)
- **Provider routing:** “Valhalla/OSRM serta geocoding provider dengan adapter abstraction.” (PRD 9.2)
- **Cuaca:** “Open-Meteo atau provider cuaca lain; tampilkan sumber dan waktu update.” (PRD 9.2)
- **Pihak ketiga di diagram:** “External providers: map tiles, routing, geocoding, weather, Google Play Billing” (PRD 9.3)

## Batas

- “Provider map/routing/geocoding harus berada di balik adapter agar dapat diganti.” (PRD 9.4)
- “Event lokasi tidak dikirim melalui query polling berat jika WebSocket dapat digunakan.” (PRD 9.4)
- “Jangan menyimpan setiap ping GPS dalam database utama tanpa kebijakan sampling/retensi.” (PRD 9.4)
- “Semua endpoint mutasi memerlukan auth, validation, authorization, rate limit, dan idempotency bila relevan.” (PRD 9.4)
- “Konfigurasi paket, feature flag, quota, dan minimum app version diatur server-side.” (PRD 9.4)
- “Jangan hardcode credential, API key privat, host internal, atau endpoint dev pada aplikasi produksi.” (PRD 9.4)
- “Yang wajib dipertahankan adalah isolasi provider, authorization server-side, penyimpanan data lokasi yang aman, serta jalur fallback untuk layanan pihak ketiga.” (PRD 9.2)

## Yang belum ditetapkan PRD

- PRD 17 butir 2: “Apakah backend menggunakan Firebase-heavy architecture atau PostgreSQL/PostGIS + Redis sebagai data inti.” — terbuka.
- PRD 17 butir 3: “Provider peta, tile, geocoding, routing, dan biaya per penggunaan.” — terbuka.
- Struktur database, API bisnis, algoritma rute, harga paket, dan prosedur admin “Tidak dapat dipastikan dari inspeksi statis” dan baru “Didefinisikan sebagai rancangan produk baru di PRD” (PRD 19.2).
- “Kontrak event WebSocket ditentukan.” (PRD 18) masih berupa butir checklist yang belum ditandai.
