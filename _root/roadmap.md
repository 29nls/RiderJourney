# Roadmap

Urutan di halaman ini berasal dari PRD 15. PRD tidak menetapkan tanggal, durasi fase, jumlah sprint, atau besaran tim, jadi tidak ada satu pun di sini.

## Lima fase

| Fase | Isi | Exit criteria |
|---|---|---|
| Fase 0 — Discovery dan fondasi | Persona, desain navigasi, brand, domain, package name, lisensi peta, routing provider, kebijakan privasi, threat model, data classification, database schema, API contract, UI system, CI/CD, environments, crash analytics, observability | “desain arsitektur disetujui, backlog terpecah, risiko privasi lokasi dianalisis, dan peta provider dipilih” |
| Fase 1 — MVP touring inti (P0) | Authentication, profil rider, garasi, peta, pencarian, waypoint, preview rute, trip tracking background, riwayat, create/join convoy, invite code, live location, status anggota, chat teks dasar, push notification, laporan bahaya dasar, admin minimal | “seluruh acceptance gate MVP terpenuhi dalam internal test dan beta terbatas” |
| Fase 2 — Komunikasi dan komunitas (P1) | LiveKit/WebRTC PTT dan voice rooms, komunitas/klub, role, agenda, channel, artikel, album, feed, follow, interaksi, notifikasi sosial, tema peta tambahan, navigasi suara | “pengujian audio dan moderasi lulus; permission dan kebijakan lokasi jelas” |
| Fase 3 — Journey dan engagement (P1/P2) | Replay perjalanan, poster template original, ekspor gambar, upload media, album, profil bertema, badge, leaderboard | “media pipeline stabil, biaya storage terukur, serta kontrol privasi tersedia” |
| Fase 4 — Monetisasi dan fitur premium (P2) | Paket Free/Pro/Pro Plus, Google Play Billing, entitlement, restore, subscription lifecycle, avatar 3D/asset store, fitur map premium, ekspor video, redeem, poin, website komunitas, optimasi biaya routing/audio/storage/CDN | “audit billing, fraud, hak aset, dan unit economics selesai” |

Semua isi dan exit criteria diambil dari PRD 15. MVP baru boleh dirilis ke beta kalau sepuluh butir acceptance gate PRD 14.3 terpenuhi; butir ke-10 berbunyi “Tidak ada blocker keamanan kritis atau kebocoran lokasi privat.”

## Yang belum ditetapkan

Roadmap ini bergantung pada keputusan PRD 17 yang belum diambil, termasuk brand dan package name (butir 1), provider peta dan biayanya (butir 3), kapasitas konvoi tiap paket serta harga langganan (butir 4), dan kebijakan lokasi (butir 5). Tiap butir tetap terbuka (PRD 17), jadi jadwal atau lingkup yang mengandaikan jawabannya belum bisa dipastikan.

Kontrak event WebSocket dan API contract OpenAPI adalah keluaran Fase 0. Keduanya masih butir terpisah di PRD 18 yang belum dicentang, jadi fase itu belum bisa dimulai tanpa menyelesaikannya lebih dulu. (PRD 18)
