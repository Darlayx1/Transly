# Pengujian Transly

Tanggal: 8 Oktober 2026 (Asia/Makassar).

## Pemeriksaan yang telah lulus

- TypeScript strict (`tsc --noEmit`).
- Build production Cloudflare Worker dan aset client.
- 15 tes validasi/provider/security (`npm test`).
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

## Batas verifikasi

UI evaluasi menggunakan fixture yang ditandai sebagai data uji lokal, bukan hasil AI sungguhan. Fixture tidak masuk build atau repository. Tes provider otomatis memakai respons simulasi. HTTP smoke melakukan permintaan Google nyata dengan key palsu khusus pengujian untuk menguji kegagalan; ini tidak memvalidasi generate/evaluasi sukses dengan key aktif.

Panggilan AI sukses dari awal hingga akhir memerlukan API key Google AI aktif dari user. Tidak ada key tersebut yang tersedia pada saat pembangunan. Ketersediaan masing-masing model bergantung pada akun/provider; daftar model tidak menjamin semua model dapat diakses oleh setiap key.

Push GitHub memerlukan login akun Darlayx1 atau koneksi GitHub yang terautentikasi. Browser dan Git Credential Manager belum memiliki autentikasi tersebut.

## Pemeriksaan production

Setelah deployment, periksa URL yang dikembalikan Sites dan jalankan:

```sh
node tests/http-smoke.mjs https://URL-PRODUCTION
```

Lanjutkan uji browser pada URL production, lalu masukkan key aktif melalui Pengaturan AI untuk menguji generate, submit, dan evaluasi nyata. Jangan mengklaim Definition of Done penuh sebelum langkah AI dan push GitHub berhasil.
