# Login dan riwayat Transly di GitHub Pages

Frontend tetap berada di `https://darlayx1.github.io/Transly/`. Supabase menyediakan autentikasi dan database; backend AI yang ada tetap melayani API key perangkat. Akun Supabase tidak otomatis menjadi akun ChatGPT atau membuka brankas D1. Riwayat latihan dan masuk akun tersedia melalui **Akun & riwayat**, tanpa membuka situs utama.

## Aktivasi

1. Pada proyek Supabase, jalankan `migrations/202610100001_account_history.sql` melalui SQL Editor atau Supabase CLI. Migrasi ini untuk Supabase, bukan migrasi D1 di folder `drizzle`.
2. Aktifkan provider Email, konfirmasi email, dan panjang kata sandi minimum 12 karakter. Layanan email bawaan Supabase digunakan dahulu sesuai permintaan pengguna; pengiriman memiliki batasan. Untuk pendaftaran publik dan pengiriman email andal, konfigurasikan SMTP sendiri.
3. Template email bawaan menggunakan tautan konfirmasi/pemulihan. Aplikasi menangani sesi yang kembali dari tautan email dan membuka form kata sandi baru untuk pemulihan. Pada paket Free, perubahan template memerlukan SMTP sendiri. Setelah SMTP tersedia, template **Confirm signup** dan **Reset Password** dapat menggunakan `{{ .Token }}` agar pengguna memasukkan kode langsung di Transly. Jangan menghapus pengaturan konfirmasi email.
4. Atur Site URL dan Redirect URL yang diizinkan ke `https://darlayx1.github.io/Transly/`. Tautan email kembali ke halaman GitHub Pages tersebut; login email/kata sandi tetap dilakukan di halaman aplikasi.
5. Pada GitHub repository Settings → Secrets and variables → Actions → Variables, isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. URL dan publishable/anon key adalah konfigurasi publik. Jangan gunakan secret key atau service_role key.
6. Jalankan workflow **Deploy Transly to GitHub Pages** setelah konfigurasi tersedia. Untuk lokal, isi dua variabel tersebut di `.env.local` pada direktori `web` lalu jalankan build Pages.

## Perilaku penyimpanan

- Tamu dan setiap akun memiliki cache perangkat terpisah. Data lama dimigrasikan menjadi riwayat tamu; penyalinan ke akun memerlukan tombol **Salin riwayat tamu ke akun**.
- Draft dan evaluasi disimpan lokal segera, lalu disinkronkan setelah jeda satu detik. Semua sesi diarsipkan ketika latihan baru dibuat. Kata sandi dan API key tidak disertakan dalam payload riwayat.
- Saat offline atau terjadi error, draft tetap ada di perangkat. Sinkronisasi otomatis berhenti setelah error; **Sinkronkan** memuat riwayat dan mencoba kembali.
- Setiap perubahan memeriksa versi database. Jika perangkat lain telah mengubah sesi yang sama, sinkronisasi berhenti. Saat pengguna menekan **Sinkronkan**, kedua versi dipertahankan sebagai sesi terpisah agar draft tidak ditimpa.
- Logout lokal mengganti tampilan ke riwayat tamu dan tidak menghapus data cloud. Cache akun tetap tersedia setelah masuk kembali pada browser yang sama; perangkat bersama sebaiknya membersihkan data situs setelah digunakan.
- Riwayat masuk mencatat pertama kali sesi autentikasi diamati aplikasi, dengan waktu server dan satu record per sesi. Ini bukan audit seluruh percobaan login gagal; audit autentikasi lengkap tetap berada di Supabase.
- Tabel hanya dapat dibaca pemilik melalui RLS. Penulisan melalui fungsi database memeriksa identitas, versi sesi, dan ukuran payload. Timestamp/login ID berasal dari server dan JWT terverifikasi.

## Verifikasi produksi

`npm test` mencakup migrasi dan kebijakan akses pada PostgreSQL lokal melalui PGlite, termasuk isolasi akun, larangan akses anonim, versi sesi, batas payload, dan deduplikasi login. `tests/account-browser.mjs` adalah pengujian browser opsional dengan Playwright dan endpoint simulasi: jalankan preview Pages dengan `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55432` serta `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_only`, lalu jalankan script tersebut. Jangan gunakan konfigurasi simulasi untuk build produksi.

Daftar akun A, buka tautan email yang kembali ke Transly (atau masukkan kode jika SMTP/template kode sudah dikonfigurasi), buat dua latihan, ubah draft, refresh, keluar dan masuk kembali. Masuk pada perangkat lain dan periksa riwayat yang sama. Akun B tidak boleh melihat latihan A. Ubah satu sesi bersamaan pada dua perangkat dan pastikan kedua draft dipertahankan setelah Sinkronkan. Putuskan koneksi, ubah draft, sambungkan kembali dan tekan Sinkronkan. Uji pemulihan kata sandi melalui tautan email yang kembali ke form Transly. Refresh tidak boleh menambah event login baru.

Build tanpa konfigurasi tetap menyediakan riwayat lokal, tetapi menampilkan bahwa login belum tersedia. Pengujian lokal dengan mock bukan bukti autentikasi Supabase produksi telah aktif.
