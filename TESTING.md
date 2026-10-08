# Pengujian Transly

Tanggal: 8 Oktober 2026 (Asia/Makassar).

## Pemeriksaan yang telah lulus

- TypeScript strict (`tsc --noEmit`).
- Build production Cloudflare Worker dan aset client.
- 30 tes validasi/provider/security lama dan 17 tes integrasi brankas berbasis SQLite nyata (`npm test`); respons provider disimulasikan.
- HTTP smoke: status credential, cookie AES-GCM HttpOnly, status tanpa plaintext key, penolakan key invalid oleh Google sungguhan, penghapusan cookie, dan penolakan cross-origin (`node tests/http-smoke.mjs`).
- UI konfigurasi: level B2, custom topic, generator Gemini 3.7 dan evaluator Gemma 4 31B dipilih independen.
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

Pembaruan brankas pada 8 Oktober 2026: 17 tes integrasi memeriksa isolasi akun, masking, duplikasi, AES-GCM/AAD, tampering, respons besar, rotasi versi, fallback key invalid, cooldown proyek dengan Retry-After/RetryInfo, izin per model, penghentian pada safety/parameter, circuit breaker, batas percobaan, mode pembagian beban, concurrency, antrean yang memeriksa ulang key sibuk, replay idempoten, reservasi limit atomik, uji metadata, penghapusan, serta cadangan berpassword. Preview HTTP menguji login lokal, penolakan identitas palsu, penyimpanan/pembacaan, duplikasi, penolakan cross-origin/anonim, perubahan metadata, dan ekspor/impor cadangan. Data uji hanya menggunakan key palsu.

UI brankas diverifikasi pada desktop dan lebar 375 piksel: login lokal, tambah key, refresh mempertahankan key, tab fallback, dan tidak ada overflow horizontal pada halaman/dialog. Secret master production dikonfigurasi terpisah dari SESSION_SECRET; tidak ada key provider pengguna baru yang digunakan untuk pengujian ini. Keberhasilan AI dengan brankas memakai fixture provider dan tidak membuktikan akses/kuota key pengguna di Google.

Tes provider otomatis memakai respons simulasi. HTTP smoke melakukan permintaan Google nyata dengan key palsu khusus pengujian untuk menguji kegagalan. Alur sampel yang dipublikasikan adalah demonstrasi eksplisit, bukan penilaian AI untuk tulisan bebas.

Gemini 3.8 Flash menghasilkan error provider pada satu percobaan production; Gemini 3.5 Flash berhasil untuk generator dan evaluator dengan key yang sama. Ketersediaan masing-masing model bergantung pada akun/provider; daftar model tidak menjamin semua model dapat diakses oleh setiap key.

Source telah di-push ke repository publik [Darlayx1/Transly](https://github.com/Darlayx1/Transly), branch `main`, pada 8 Oktober 2026. Autentikasi akun Darlayx1 diverifikasi melalui API GitHub dan commit remote diperiksa setelah push. File credential lokal tidak dilacak Git.

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

Key pengguna dimasukkan lewat Pengaturan AI di browser production dan tidak disimpan di repository atau variabel environment bersama. Generate, submit, evaluasi nyata, dan push GitHub telah berhasil.

## GitHub Pages

[https://darlayx1.github.io/Transly/](https://darlayx1.github.io/Transly/) diterbitkan melalui workflow GitHub Actions yang berstatus **success** pada 8 Oktober 2026. HTML, stylesheet, JavaScript, dan favicon tersedia pada base path `/Transly/`.

- Alur sampel selesai dengan skor 67/100 dan empat severity highlight.
- Key pengguna dimasukkan melalui form password; token terenkripsi hanya berada dalam memori tab.
- Gemini 3.5 Flash membuat soal B1 78 kata dan mengevaluasi jawaban menjadi skor 96/100.
- Dua highlight tepat pada kutipan, popover desktop, bottom sheet mobile, dan versi ideal tampil.
- Refresh pada `#review` mempertahankan hasil. Sesi AI harus dimulai lagi setelah refresh sesuai desain.
- Pada viewport mobile 375 px, scrollWidth 360 px; tidak ada horizontal overflow.
- Tidak ada console error/warning penting pada flow browser GitHub Pages.
- `node tests/pages-smoke.mjs` lulus: preflight CORS, token terenkripsi tanpa plaintext key/cookie aplikasi, status credential, dan penolakan origin lain.
- HTTP smoke cookie same-origin pada backend tetap lulus setelah penambahan dukungan Pages.
# Gemma 4 31B — 8 Oktober 2026

- Nama UI diperbaiki dan diseragamkan menjadi `Gemma 4 31B`; provider ID resmi tetap `gemma-4-31b-it`.
- Request menggunakan `thinkingConfig: { thinkingLevel: 'minimal' }` untuk memaksimalkan budget output pada soal/evaluasi, serta instruksi schema JSON yang ketat.
- Parser JSON aman (`parseJsonResponse`) menangani respons direct JSON, Markdown code fences (````json````), JSON di dalam teks pengantar/penutup, serta controlled repair untuk trailing comma.
- Penanganan multi-parts memfilter bagian pemikiran (`thought: true` dan tag `<thought>`) sehingga hanya teks akhir yang diproses.
- Penanganan `finishReason`: `MAX_TOKENS`/`LENGTH` dipetakan ke `RESPONSE_TRUNCATED`, sedangkan `SAFETY` dipetakan ke `SAFETY_BLOCKED`.
- Pemetaan error granular: status 400 (`UNSUPPORTED_PARAMETER`), 401 (`INVALID_KEY`), 403 (`KEY_PERMISSION_DENIED`), 404 (`MODEL_UNAVAILABLE`), 429 (`RATE_LIMIT` / `QUOTA_EXCEEDED`), dan 5xx (`PROVIDER_ERROR`).
- Mekanisme retry terbatas (1x retry dengan delay) otomatis menangani kegagalan sementara seperti HTTP 502 dari Google AI atau gangguan jaringan sesaat.
- Diagnostik server-side aman mencatat status upstream dan model ID tanpa pernah mencatat API key atau token kredensial.
- 30 tes otomatis pada `tests/run.mjs`, TypeScript strict (`tsc --noEmit`), ESLint (`eslint .`), Next build (`npm run build`), dan build GitHub Pages (`npm run build:pages`) seluruhnya lulus.
- Script live test `tests/live-gemma.mjs` menyediakan pengujian 10 skenario live integration; apabila API key belum disediakan, script melaporkan status `[LIVE_TEST:BLOCKED]` secara transparan tanpa mengklaim hasil palsu.

## Groq + Gemini terpadu — verifikasi lokal 8 Oktober 2026

- 36 tes validasi/provider dan 28 tes integrasi brankas lulus (64 total), dengan respons upstream simulasi.
- Cakupan baru: empat kombinasi provider pembuat soal/penilai, endpoint dan header yang sesuai, schema JSON Groq, pemetaan error, readiness sesuai model/peran/key, provider cadangan opt-in, budget percobaan bersama, cooldown organisasi Groq, isolasi circuit provider, penggantian secret, cache idempotensi setelah key dihapus, migrasi key lama, backup v2 campuran, dan impor backup v1.
- `npm run check`, `npm run lint` (tanpa warning), `npm run build`, serta `npm run build:pages` lulus.
- `node tests/vault-http.mjs http://127.0.0.1:5173` lulus: CRUD kedua provider, metadata masked, penolakan pasangan key/provider yang salah pada generate/evaluate sebelum upstream, provider change tanpa secret baru, autentikasi/origin, ekspor/impor, serta pembersihan seluruh record pengujian.
- UI diperiksa pada viewport desktop dan 390 × 844: navigasi bagian, formulir provider Groq, daftar model yang mengikuti provider, pilihan cadangan Gemini, pesan key belum tersedia, perlindungan input belum tersimpan melalui tombol Tutup dan Escape, serta reset posisi scroll saat berpindah bagian.
- Dialog mobile memenuhi lebar layar; tidak ada horizontal overflow di dialog. Tidak ada error console browser pada pratinjau yang diperiksa.
- Screenshot lokal: `.sites-runtime/qa/ai-settings-desktop.png` (diabaikan Git).
- Key nyata tidak digunakan dalam pengujian ini. Generate/evaluate live Groq belum diverifikasi. Perubahan ini belum diterbitkan; penerbitan memerlukan migrasi D1 `drizzle/0001_soft_venom.sql` sebelum server baru digunakan.
