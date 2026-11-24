# Main user flow

PRD 6 mendeskripsikan tiga alur utama. Halaman ini menuliskan alurnya berdasarkan langkah yang tercantum di PRD, dengan kutipan untuk bagian yang menentukan bentuk produk.

## Registrasi sampai perjalanan pertama (PRD 6.1)

Delapan langkah, dari “Pengguna membuka aplikasi dan membaca onboarding singkat.” sampai “Pengguna mengakhiri sesi; aplikasi menyimpan ringkasan dan riwayat.”

Dua langkah pendaftaran yang menentukan bentuk produk:

> “Aplikasi menjelaskan manfaat akses lokasi saat touring; permission diminta saat konteks fitur dibutuhkan.”

> “Pengguna memilih rute lalu memulai sesi personal atau membuat konvoi.”

Sesi personal dan konvoi adalah dua jalur dari rute yang sama.

Sesi aktif harus terlihat dari luar halaman aplikasi: “Aplikasi menampilkan indikator sesi aktif dan foreground notification.” (PRD 6.1)

## Membuat dan menjalankan konvoi (PRD 6.2)

Tujuh langkah yang membagi peran leader, backend, dan server. Empat langkah pertama sudah menetapkan tiga aturan yang tidak bisa dipindahkan ke klien:

1. “Leader mengisi nama konvoi, titik kumpul, tujuan, waktu, dan batas peserta.”
2. “Backend membuat convoy ID dan kode/link undangan.”
3. “Anggota masuk ke lobby dan menyetujui aturan pembagian lokasi.”
4. “Leader memulai sesi; server mengaktifkan channel lokasi dan komunikasi.”

Identitas konvoi dibuat backend, lokasi baru dialirkan setelah sesi dimulai server, dan persetujuan pembagian lokasi dicatat per anggota.

Penutupan alur menegaskan batas data lokasi: “Leader mengakhiri sesi; lokasi live dihentikan dan riwayat disimpan.” (PRD 6.2) Itu sejalan dengan aturan lokasi PRD 5.5 — lokasi hanya dibagikan “dalam sesi konvoi yang sedang aktif”.

## Melaporkan bahaya (PRD 6.3)

Enam langkah. Langkah pertama dan ketiga yang menentukan pengalaman melapor:

1. “Pengguna memilih kategori bahaya dari kontrol cepat.”
2. “Aplikasi mengambil koordinat terkini dan waktu.”
3. “Pengguna dapat menambahkan catatan/foto; pengisian harus bisa diselesaikan ketika kendaraan berhenti.”
4. “Server menyimpan laporan dan menerbitkan event ke pengguna/konvoi yang relevan.”
5. “Rider lain dapat mengonfirmasi laporan.”
6. “Laporan kedaluwarsa otomatis atau diturunkan prioritasnya berdasarkan TTL dan konfirmasi.”

Langkah 3 menyelesaikan pengisian ketika kendaraan berhenti; langkah 5 dan 6 memberi laporan umur melalui konfirmasi dan TTL.

## Navigasi lima tab

PRD 4.1 menetapkan urutan tab:

1. **Beranda / Peta** — “peta, posisi saat ini, pencarian lokasi, rute, dan akses cepat ke konvoi.”
2. **Jelajah** — “pencarian rider, komunitas, tempat, dan konten publik.”
3. **Journey / Feed** — “postingan perjalanan, status, foto, video, dan interaksi.”
4. **Konvoi** — “konvoi aktif, undangan, chat, voice room, dan daftar anggota.”
5. **Profil** — “identitas rider, statistik, garasi, badge, album, pengaturan, dan langganan.”

Peta ada di tab pertama dan memuat pencarian lokasi dan rute; profil menyatukan garasi, badge, album, pengaturan, dan langganan dalam satu tab.

## Permukaan fitur lain

- **Touring** — “Sesi aktif, jeda/lanjut, ringkasan, daftar riwayat, detail perjalanan, replay, ekspor poster/video” (PRD 4.2).
- **Safety** — “Tambah laporan bahaya, detail laporan, peringatan, pusat keselamatan, kontak darurat” (PRD 4.2).

PRD 4.2 hanya mendaftar permukaan layar; ia tidak menuliskan rincian alur untuk setiap permukaan.
