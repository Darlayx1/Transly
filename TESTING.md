# Pengujian Transly

Tanggal: 8 Oktober 2026 (Asia/Makassar).

## Pemeriksaan yang telah lulus

- TypeScript strict (`tsc --noEmit`).
- Build production Cloudflare Worker dan aset client.
- 16 tes validasi/provider/security dan ketepatan span sampel (`npm test`).
- HTTP smoke: status credential, cookie AES-GCM HttpOnly, status tanpa plaintext key, penolakan key invalid oleh Google sungguhan, penghapusan cookie, dan penolakan cross-origin (`node tests/http-smoke.mjs`).
- UI konfigurasi: level B2, custom topic, generator Gemini 3.7 dan evaluator Gemma 31B dipilih independen.
- UI editor: mengetik, navigasi beranda/sesi, refresh, pemulihan draft, serta tab baca/tulis mobile.
- Timer berjalan menurut deadline absolut; 00:00 mengunci editor tanpa menghapus jawaban.
- Submit menampilkan konfirmasi; gagal API tidak menghapus draft; retry tersedia.
- Evaluasi dengan fixture lokal: skor, enam kategori, rangkuman, strengths/weaknesses, source, user answer, dan ideal.
- Empat severity highlight, teks ditampilkan utuh meski penanda tak berurutan, dan exact quote boundaries.
- Desktop popover berada di dalam viewport; mobile bottom sheet tetap terbuka dan memuat feedback lengkap.
- Versi ideal menjelaskan bahwa alternatif benar tetap valid.
- Tidak ada horizontal overflow pada lebar 320, 375, 768, 1280, dan 1440 piksel.
- Tidak ada console error/warning penting pada browser preview.
- Alur sampel tanpa API: jawaban contoh dapat dipulihkan, perubahan jawaban ditolak untuk skor ilustratif, empat severity tampil, dan bottom sheet berfungsi pada lebar 320 piksel tanpa horizontal overflow.
- Panggilan AI production dengan key pengguna: Gemini 3.5 Flash membuat teks B1 79 kata dan mengevaluasi terjemahan lengkap menjadi skor 98/100, feedback, tiga penanda Suggestion, popover, dan versi ideal.

## Batas verifikasi

Tes provider otomatis memakai respons simulasi. HTTP smoke melakukan permintaan Google nyata dengan key palsu khusus pengujian untuk menguji kegagalan. Alur sampel yang dipublikasikan adalah demonstrasi eksplisit, bukan penilaian AI untuk tulisan bebas.

Gemini 3.8 Flash menghasilkan error provider pada satu percobaan production; Gemini 3.5 Flash berhasil untuk generator dan evaluator dengan key yang sama. Ketersediaan masing-masing model bergantung pada akun/provider; daftar model tidak menjamin semua model dapat diakses oleh setiap key.

Push GitHub memerlukan login akun Darlayx1 atau koneksi GitHub yang terautentikasi. Browser dan Git Credential Manager belum memiliki autentikasi tersebut.

## Pemeriksaan production

Deployment Sites berstatus **succeeded** dan URL [Transly](https://transly-studio.adikagung32.chatgpt.site/) telah dibuka di browser pada 8 Oktober 2026. Halaman tampil, stylesheet termuat, tidak ada blank page, error console penting, atau horizontal overflow pada viewport desktop. Cookie key uji disimpan dan dihapus lewat UI production. `SESSION_SECRET` telah dikonfigurasi sebagai secret runtime; `GEMINI_API_KEY` shared tidak digunakan. Credential uji tidak ada lagi pada sesi browser.

HTTP smoke pada URL production lulus seluruhnya:

- Endpoint status tersedia dan tidak mengembalikan plaintext key.
- Cookie credential `HttpOnly` dan `Secure` pada HTTPS.
- Google menolak key uji yang tidak valid dan aplikasi menampilkan kode `INVALID_KEY` aman.
- Penghapusan cookie dan penolakan permintaan lintas origin bekerja.

Ulangi pemeriksaan HTTP kapan saja dengan:

```sh
node tests/http-smoke.mjs https://transly-studio.adikagung32.chatgpt.site
```

Key pengguna dimasukkan lewat Pengaturan AI di browser production dan tidak disimpan di repository atau variabel environment bersama. Generate, submit, dan evaluasi nyata telah berhasil. Jangan mengklaim Definition of Done penuh sebelum push GitHub berhasil.
