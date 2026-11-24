# Project background

RiderJourney menempatkan dirinya sebagai “aplikasi pendamping touring motor yang menyatukan perencanaan rute, navigasi, pencatatan perjalanan, koordinasi rombongan, komunikasi real-time, keselamatan jalan, komunitas, dan dokumentasi perjalanan dalam satu ekosistem.” (PRD 1)

## Masalah

Koordinasi touring saat ini tersebar di banyak alat. PRD 1 menyebut lima hal yang terpisah:

> “navigasi di satu aplikasi, posisi rombongan dibagikan melalui aplikasi pesan, komunikasi suara menggunakan perangkat terpisah, dokumentasi diposting ke media sosial, dan riwayat jarak/rute dicatat manual.”

PRD 1 menautkan pemisahan itu ke tiga risiko: “Pemisahan tersebut meningkatkan risiko anggota tertinggal, informasi rute tidak sinkron, dan dokumentasi perjalanan tercecer.” (PRD 1) PRD tidak menyertakan data insiden atau ukuran kerugian untuk risiko tersebut; angka risiko belum ada di dokumen ini.

## Apa yang harus bisa dilakukan pengguna

PRD 1 mewajibkan delapan kemampuan. Yang pertama “Menyiapkan rute dari titik awal, tujuan akhir, dan beberapa titik singgah.” Kemampuan keempat “Berkomunikasi melalui chat dan voice/PTT tanpa membuat interaksi berkendara menjadi lebih berbahaya.” Kemampuan kedelapan “Mengembangkan profil rider, garasi motor, pencapaian, dan riwayat perjalanan.”

## Urutan prioritas

Prioritas rilis eksplisit: “Rilis pertama memprioritaskan keselamatan, keandalan GPS, navigasi, konvoi, dan riwayat.” Fitur lain menyusul “setelah alur inti stabil”: “Fitur komunitas, media sosial, poster, avatar 3D, sistem poin, serta monetisasi diluncurkan setelah alur inti stabil.” (PRD 1)

Model pendapatan tidak boleh mengunci keselamatan: tujuan bisnis keempat adalah menciptakan “model pendapatan berulang melalui paket langganan dan fitur premium tanpa mengunci fungsi keselamatan dasar.” (PRD 1.2)

Out-of-scope rilis awal menguatkan batas yang sama, termasuk “Penjaminan keselamatan atau layanan dispatch darurat resmi tanpa integrasi dan perjanjian dengan instansi terkait.”, “Navigasi offline penuh dan unduhan peta satu negara.”, dan “Penghitungan kecepatan sebagai kompetisi atau insentif untuk berkendara cepat.” (PRD 2.2)

## Platform dan bahasa

| Area | Ketentuan |
|---|---|
| Platform utama | “Android native” |
| Minimum OS | “Android 8.0 (API 26) sebagai baseline kompatibilitas” |
| Target SDK | “Mengikuti target Google Play terbaru saat rilis; paket referensi menargetkan API 36” |
| Bahasa awal | “Bahasa Indonesia” |
| Bahasa tambahan | “Inggris setelah UX dan konten Indonesia stabil” |
| Orientasi | “Portrait sebagai default; landscape untuk navigasi jika diuji dan dibutuhkan” |
| Koneksi | “Online-first; graceful degradation ketika jaringan terputus” |

Semua nilai di tabel dari PRD 2.3.

## Batas dokumen ini

PRD 0 menyebut batas sumbernya: “disusun dari inspeksi statis file `Touring+Go_2.0.2_APKPure.xapk` yang diberikan” (PRD 0), dan “file APK tidak dijalankan pada perangkat/emulator dan tidak dilakukan pengujian trafik server.” (PRD 0) Karena inspeksi statis tidak menunjukkan perilaku runtime, dokumen ini tidak mengklaim mengetahui seluruh alur layar, aturan backend, harga paket, konfigurasi keamanan, atau perilaku runtime aplikasi referensi.

Sikap yang dinyatakan dokumen terhadap hal yang hanya terlihat: “Batas kapasitas dan hak paket yang terlihat diperlakukan sebagai indikasi, bukan spesifikasi resmi yang telah diverifikasi.” (PRD 0)

## Konvoi: konteks kapasitas

Kapasitas konvoi per paket adalah aturan produk dengan rangkaian tiga tingkat (PRD 5.5). Angka awalnya konfigurasi: “paket Free maksimal 3 peserta, Pro maksimal 20, dan Pro Plus maksimal 30. Batas ini diambil dari label kapasitas yang ditemukan di string APK” (PRD 5.5). Aturan itu menambahkan “pemetaan persis antara paket dan kapasitas perlu diuji ulang terhadap aplikasi runtime sebelum dianggap identik.” (PRD 5.5) Jadi 3/20/30 belum boleh dibaca sebagai spesifikasi paket.

Yang mengikat adalah aturan server. CNV-08 berisi “Sistem mendukung kapasitas berbeda per paket.” dengan kriteria “Kapasitas ditetapkan di backend dan tidak dapat dimanipulasi aplikasi.”, dan BR-10 berbunyi “Batas paket dan entitlement diverifikasi server-side.”

PRD 19.2 menilai keyakinan angka ini “Sedang”; catatannya: label kapasitas ditemukan, tetapi pemetaan paket dan kapasitas perlu verifikasi runtime. PRD 18 masih berupa daftar centang yang belum ditandai, jadi angka 3/20/30 adalah indikasi, bukan komitmen rilis.
