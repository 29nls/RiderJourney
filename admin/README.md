# RiderJourney Admin

Konsol operasi Next.js untuk pengguna, laporan, moderasi, langganan, redeem, konfigurasi, dan audit. Konsol ini adalah **draft without direction**: belum ada `DESIGN.md` atau brand guide, jadi tampilannya utilitarian dan belum boleh dianggap final secara visual.

## Menjalankan

1. Jalankan backend di `http://127.0.0.1:3000` dengan database yang sudah dimigrasi.
2. Salin `.env.example` menjadi `.env.local` bila backend tidak memakai port default.
3. `npm ci`
4. `npm run dev`
5. Buka `http://127.0.0.1:3001/login`.

Tidak ada akun default. Daftarkan akun lewat API backend, lalu jadikan admin dari folder `backend`:

```bash
npm run admin:bootstrap -- grant admin@example.com superadmin
```

Login pertama meminta pendaftaran authenticator. Tindakan sensitif memakai `X-Step-Up-Token` yang diterbitkan dari kode TOTP dan disimpan hanya di `sessionStorage` tab ini.

## Keamanan sesi

- Access dan refresh token berada di cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` saat produksi. Token tidak masuk `localStorage`.
- Route handler `/api/admin/*` adalah satu-satunya jalur ke backend dan meneruskan step-up token. Browser tidak pernah memegang URL backend.
- Refresh token dirotasi otomatis pada respons 401. Bila refresh gagal, pengguna diarahkan ke login.
- CSP memakai `'unsafe-inline'` untuk script karena konfigurasi Next tanpa nonce. Sebelum produksi, pindahkan ke nonce middleware atau edge proxy dan uji ulang.
- Backend tetap sumber otorisasi. Menyembunyikan tombol bukan kontrol keamanan.

## Build

```bash
npm run build
```

Build tidak menghubungi backend. Halaman login dan shell dirender dinamis agar cookie selalu dibaca saat request.
