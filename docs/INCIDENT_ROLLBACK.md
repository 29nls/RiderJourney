# Incident dan Rollback Notes

Dokumen ini untuk operator RiderJourney. Prinsipnya: hentikan dampak dulu, jaga bukti, baru perbaiki. Jangan menghapus audit log atau ledger untuk "membersihkan" insiden.

## 1. Tingkat insiden

| Tingkat | Contoh | Respons |
|---|---|---|
| P0 | Pembobolan massal, pembayaran diberi akses tanpa verifikasi, data pengguna bocor, admin takeover | Hentikan fitur terkait, panggil owner produk dan keamanan, komunikasi dalam 1 jam |
| P1 | Billing tidak memberi akses ke pembeli sah, redeem ganda, antrean laporan tidak bisa ditindak, login admin mati | Turunkan/rollback dalam 4 jam, komunikasi ke pengguna terdampak |
| P2 | Satu laporan macet, satu akun tidak bisa restore, tampilan admin error | Perbaiki pada hari kerja berikutnya |
| P3 | Kosmetik, pesan salah, dokumentasi | Masukkan backlog |

## 2. Kill switch fitur berbayar

Ini tindakan pertama untuk insiden billing. Dua switch harus dimatikan agar entitlement kembali ke free:

1. Di konsol admin, buka Konfigurasi, ubah `features` menjadi `{"billingEnabled": false, "paidFeaturesEnabled": false}` dengan alasan insiden dan step-up MFA.
2. Di deployment, set `BILLING_ENABLED=false` dan `PAID_FEATURES_ENABLED=false`, lalu deploy ulang. Environment adalah master switch; admin config tidak dapat menyalakan fitur bila environment false.
3. Pastikan `GET /v1/subscription` untuk akun terdampak mengembalikan `planCode: free` dan `convoyCapacity` free.
4. Jangan menonaktifkan endpoint RTDN secara permanen. Notifikasi yang gagal akan retry; setelah perbaikan, rekonsiliasi akan menyusul.

Efek samping: `POST /v1/billing/verify`, restore, dan notifikasi membalas `BILLING_DISABLED` (409) atau `BILLING_NOTIFICATION_NOT_CONFIGURED` (503). Ini disengaja.

## 3. Dugaan pembelian palsu atau replay

1. Jangan memberi akses berdasarkan tangkapan layar atau pesan klien.
2. Periksa `billing_purchases` untuk hash token, user, dan waktu verifikasi.
3. Periksa `billing_notifications` untuk error dan `messageId` duplikat.
4. Jalankan rekonsiliasi: `npm run billing:reconcile` di backend dengan kredensial provider.
5. Bila satu akun terdampak, batasi akun lewat admin dengan alasan yang jelas. Jangan menghapus baris billing; itu bukti.
6. Bila token terbukti dipakai dua akun, `PURCHASE_ALREADY_BOUND` seharusnya sudah menolak. Eskalasi ke provider dan keamanan.

## 4. Redeem disalahgunakan

1. Nonaktifkan kode dari admin, bukan hapus. Plaintext kode tidak dapat dipulihkan dari hash.
2. Periksa `redeem_redemptions` dan `point_ledger` dengan referensi `redeem`.
3. Jangan mengubah delta ledger. Bila poin harus dicabut, buat keputusan produk dan mekanisme koreksi baru; ledger bersifat append-only.
4. Bila pepper bocor, rotasi `REDEEM_CODE_PEPPER` membuat semua kode lama tidak valid. Umumkan dan buat kode baru.

## 5. Admin compromise

1. Nonaktifkan baris admin: `npm run admin:bootstrap -- disable email@example.com`.
2. Cabut refresh token pengguna tersebut lewat database atau endpoint logout semua sesi bila tersedia.
3. Rotasi `AUTH_JWT_SECRET` akan membatalkan access token dan step-up token. Ini juga memaksa semua pengguna login ulang.
4. Rotasi `REDEEM_CODE_PEPPER`, `BILLING_NOTIFICATION_SECRET`, dan kredensial Google bila dicurigai bocor.
5. Jangan rotasi `CONTACT_ENCRYPTION_KEY` tanpa rencana re-enkripsi. Data lama tidak dapat didekripsi dengan key baru.
6. Periksa `admin_audit_logs` dengan filter aktor dan waktu. Simpan salinan ke penyimpanan bukti.
7. Bila MFA perangkat hilang, superadmin perlu mendaftarkan ulang authenticator. Tidak ada bypass tanpa akses database dan keputusan keamanan.

## 6. Rollback deployment

Backend:

1. Hentikan rollout, arahkan load balancer ke versi sebelumnya.
2. Migrasi Phase 5 bersifat additive. Versi aplikasi sebelumnya tidak membaca tabel baru, jadi rollback aplikasi tidak membutuhkan rollback schema.
3. Jangan menjalankan `DROP TABLE` atau menghapus kolom saat insiden. Itu menghilangkan bukti dan membuat rollback berikutnya mustahil.
4. Bila data rusak, restore ke database baru, verifikasi, lalu arahkan aplikasi. Jangan restore di atas database aktif tanpa menghentikan writer.
5. Setelah rollback, jalankan smoke test health, login, entitlement free, dan admin read.

Admin web:

1. Deploy build sebelumnya.
2. Cookie sesi tetap valid selama secret backend tidak berubah.
3. Bila CSP baru memblokir halaman, rollback build, jangan menurunkan header keamanan lain.

Android:

1. Hentikan staged rollout di Play Console.
2. Naikkan versi build dengan perbaikan; Play tidak mengizinkan penurunan versionCode.
3. Bila fitur berbayar bermasalah, matikan switch server sehingga aplikasi lama tidak menampilkan entitlement premium.

## 7. Restore setelah penghapusan akun

Backup dapat menghidupkan kembali akun yang sudah dihapus. Setelah restore:

1. Jalankan `npm run retention:run` untuk memproses permintaan yang masih `scheduled`.
2. Periksa `data_deletion_requests` yang hilang karena backup lebih lama. Bandingkan dengan tiket dukungan.
3. Terapkan ulang penghapusan secara manual bila perlu, dengan bukti tiket.
4. Jangan menganggap restore selesai sebelum akun yang dihapus tidak dapat login dan PII-nya sudah disamarkan.

## 8. Komunikasi

Untuk insiden P0/P1, siapkan:

- waktu mulai dan deteksi,
- fitur yang dimatikan,
- jumlah akun terdampak,
- apakah data atau pembayaran terpengaruh,
- tindakan sementara,
- perkiraan pemulihan,
- kanal dukungan.

Jangan menyebut "aman" sebelum verifikasi selesai. Jangan membagikan token, service account, atau isi audit ke kanal publik.
