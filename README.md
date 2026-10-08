# Transly

Aplikasi latihan menerjemahkan bahasa Inggris ke bahasa Indonesia. AI menyusun soal sesuai konfigurasi, kemudian menilai makna dan kualitas bahasa dengan feedback kontekstual.

Buka aplikasi di [GitHub Pages](https://darlayx1.github.io/Transly/). Mode sampel dapat dicoba tanpa API key. Generator dan evaluator AI terhubung ke backend Transly di Sites.

## Fitur

- Level A1–C2 dan Native; panjang pendek/sedang/panjang; durasi 5–60 menit.
- Topik otomatis, pilihan topik, topik custom, dan sembilan gaya bahasa.
- Model generator dan evaluator dipilih secara independen.
- Gemini 3.5 Flash menjadi pilihan awal karena telah lulus uji generate dan evaluasi production.
- Gemini 3.8, 3.7, 3.6, 3.5 Flash, 3.5 Flash Lite, dan Gemma 4 31B.
- Desktop: sumber dan editor berdampingan. Mobile: tab baca/tulis dan bottom sheet feedback.
- Timer memakai deadline absolut sehingga refresh tidak mengulang waktu. Waktu habis mengunci editor; user mengirim evaluasi secara manual. Jawaban kosong dapat dinilai dengan skor 0.
- Draft, konfigurasi, dan hasil terakhir tersimpan lokal pada perangkat; tidak berisi credential. Hanya satu sesi terakhir disimpan.
- Skor 0–100, enam kategori penilaian, kekuatan, prioritas perbaikan, teks sumber, jawaban lengkap, dan satu versi ideal.
- Highlight Suggestion, Minor, Major, Fatal; popover desktop; filter kategori.
- Structured JSON dan Zod; perbaikan offset berdasarkan kutipan persis; penanda ambigu/bertumpuk ditolak.
- Error API key, quota, rate limit, model, timeout, network, invalid JSON, dan server; tombol coba lagi menjaga draft.
- Alur sampel tanpa API: teks B2, jawaban contoh, skor ilustratif, empat tingkat highlight, dan feedback. Skor sampel hanya berlaku untuk jawaban contoh; tulisan bebas tetap memerlukan AI.

## Teknologi dan struktur

React 19, TypeScript, Vinext (Next-compatible App Router), Vite 8, Zod, Lucide, dan Cloudflare Workers melalui Sites.

```text
app/page.tsx                  orchestration dan persistensi sesi
app/api/credentials/route.ts  penyimpanan/hapus/status credential
app/api/generate/route.ts     pembuat teks
app/api/evaluate/route.ts     evaluator
components/transly/          setup, settings, practice, review, UI
lib/transly/config.ts        katalog model dan konfigurasi
lib/transly/schema.ts        validasi dan normalisasi highlight
lib/transly/output-schema.ts JSON schema untuk provider
lib/transly/server.ts        enkripsi, provider, error, throttling
lib/transly/sample.ts        alur contoh tanpa API
build/sites-worker.ts        Worker entrypoint dan security headers
tests/run.mjs                pengujian validasi/security/provider
```

Tambah/ganti model dalam `lib/transly/config.ts`; UI dan endpoint membaca katalog yang sama. Model dengan `structured: false` menggunakan instruksi JSON dan validasi setelah respons. Model yang tidak tersedia untuk akun user menampilkan error, tanpa menggantinya diam-diam. Provider yang digunakan adalah Google Generative Language API melalui request server-side ke endpoint tetap.

## Instalasi lokal

Gunakan Node.js >=22.13 (disarankan Node 24) dan npm.

```sh
npm ci
cp .env.example .dev.vars
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Masukkan hasil acak ke `SESSION_SECRET` dalam `.dev.vars`. Jangan commit nilainya. Pada Windows gunakan `Copy-Item .env.example .dev.vars`.

```sh
npm run dev
```

Buka `http://127.0.0.1:5173`. Preview portable memakai Node dan alias env lokal; production memakai Cloudflare Workers. Ini menghindari ketergantungan emulator workerd pada mesin Windows yang runtime-nya tidak kompatibel.

## Environment variables

| Variabel | Kebutuhan | Fungsi |
| --- | --- | --- |
| SESSION_SECRET | Wajib, minimal 32 karakter acak | AES-GCM credential cookie; gunakan secret yang berbeda per lingkungan |
| VAULT_ENCRYPTION_KEYS | Wajib untuk brankas | JSON versi secret acak, contoh bentuk `{"v1":"<secret acak minimal 32 karakter>"}`; simpan sebagai runtime secret |
| VAULT_ACTIVE_VERSION | Wajib untuk brankas | Versi aktif dalam VAULT_ENCRYPTION_KEYS, awalnya `v1` |
| GEMINI_API_KEY | Opsional | Shared server key; untuk deployment publik, BYOK direkomendasikan |

Jangan beri prefix `NEXT_PUBLIC_` pada credential. `.env*`, `.dev.vars*`, dependencies, build, dan runtime diabaikan Git; `.env.example` adalah contoh tanpa nilai asli.

## Custom API key dan keamanan

Buka **Pengaturan AI** pada situs utama dan masuk dengan ChatGPT. Brankas menyimpan hingga 50 API key secara permanen dalam D1, terpisah per akun. Tambah nama, Project ID Google Cloud, peran (generator/evaluator/keduanya), prioritas, dan status aktif. Key tersimpan AES-GCM dengan IV acak dan authenticated context yang mengikatnya pada akun serta record. Secret enkripsi brankas terpisah dari SESSION_SECRET. Status hanya mengembalikan metadata dan empat karakter terakhir; nilai key tidak dikembalikan ke browser, localStorage, URL, log aplikasi, atau bundle. Input dibersihkan setelah tersimpan/ditutup. Key didekripsi hanya di server dan dikirim ke endpoint Google yang tetap melalui header `x-goog-api-key`.

Mode awal **Prioritas & cadangan** memilih key utama lalu cadangan yang sesuai. **Pembagian beban** memilih key yang paling lama tidak digunakan. Model tidak diganti otomatis. Key invalid dikarantina, kegagalan izin berlaku pada pasangan key/model, sedangkan 429 menghentikan sementara kelompok proyek/model mengikuti Retry-After atau RetryInfo provider. Dua gangguan provider berurutan membuka circuit breaker 30 detik. Safety block dan parameter salah tidak memicu pergantian key. Satu permintaan memiliki maksimal 1–3 percobaan total dan deadline 85 detik; setiap panggilan provider maksimal 30 detik. Timeout tidak menjamin provider membatalkan pekerjaan atau tagihan.

Kelompok proyek diisi pengguna dan tidak diverifikasi otomatis. Gunakan Project ID yang sama persis untuk key dari proyek yang sama; key tanpa Project ID masuk kelompok konservatif `unknown`. Gemini membatasi kuota per proyek, bukan per API key. Pembatasan D1 berlaku bersama lintas Worker: 30 pekerjaan per akun/menit, 12 panggilan per kelompok proyek/model/menit, maksimal 3 pekerjaan bersamaan per akun, 2 panggilan per proyek/model dan 1 per key. Antrean menunggu maksimal 5 detik. Idempotency-Key terikat akun dan hash input; hasil tervalidasi disimpan terenkripsi selama 10 menit agar retry setelah koneksi terputus dapat mengambil hasil yang sama.

**Uji akses** memakai metadata model tanpa membuat konten dan bukan jaminan tersedianya kuota inferensi. Riwayat menyimpan maksimal 100 percobaan per akun (30 ditampilkan), berisi nama key/model, status, durasi, dan nomor percobaan. Isi latihan dan jawaban tidak dicatat dalam riwayat. Penghapusan key menghapus record dan riwayat terkait; pencabutan key provider harus dilakukan di Google AI Studio. Permintaan yang sudah dikirim ke Google tidak dapat ditarik kembali.

Bagian **Fallback → Cadangan & pemulihan key** menyediakan ekspor/impor AES-GCM. Kata sandi minimal 12 karakter diproses di browser menggunakan PBKDF2-SHA256 (600.000 iterasi, salt acak); kata sandi tidak dikirim ke server. Derived wrapping key hanya dikirim melalui sesi HTTPS untuk operasi tersebut. File berisi ciphertext, IV, salt dan versi format, tanpa plaintext credential. Pemulihan menambah key tanpa menimpa yang ada dan aman diulang. Simpan kata sandi terpisah; tidak ada mekanisme untuk memulihkan kata sandi cadangan yang hilang.

Rotasi secret brankas: tambahkan versi baru ke VAULT_ENCRYPTION_KEYS sambil mempertahankan versi lama, set VAULT_ACTIVE_VERSION, lalu deploy. Record otomatis dienkripsi ulang saat digunakan; operasi `{ "action": "rotate" }` pada `/api/credentials` mengenkripsi ulang seluruh key akun yang sedang masuk. Hapus versi lama hanya setelah seluruh akun, hasil cache yang belum kedaluwarsa, serta cadangan operasional diverifikasi. Jangan mengganti nilai suatu versi yang sudah dipakai.

Teks sumber dan jawaban dikirim ke Google untuk proses AI. Draft dan evaluasi tetap disimpan lokal pada perangkat. Autentikasi ditangani dispatcher Sites melalui SIWC; API memeriksa identitas terverifikasi serta kepemilikan di setiap operasi. Keluar dari akun tidak menghapus brankas. Enkripsi tidak melindungi dari kompromi server yang memegang secret. Development portable menggunakan SQLite persisten di `.sites-runtime/vault.sqlite` dan simulasi login lokal; production menggunakan D1 dan tidak menyertakan simulasi login.

Pada GitHub Pages, Pengaturan AI mengarahkan ke situs utama untuk sesi akun dan brankas pada origin yang sama. Draft perangkat tidak dipindahkan lintas origin. Endpoint cookie/key lama dipertahankan untuk kompatibilitas sesi 24 jam; bearer Pages tetap hanya berada di memori tab. Setelah masuk pada situs utama, **Pindahkan key sesi** memigrasikan credential cookie yang masih tersedia ke brankas dan menghapus cookie lama. Backend mengizinkan CORS hanya untuk origin `https://darlayx1.github.io`; permintaan Pages tidak mendapatkan identitas atau akses brankas.

Endpoint membatasi ukuran request aktual termasuk chunked body, memvalidasi input, menolak cross-origin, membatasi tujuan provider, dan menyembunyikan error internal. Throttling sesi legacy tetap best-effort per isolate; brankas memakai reservasi atomik D1. Tidak ada shared provider key produksi bawaan. Kuota dan billing mengikuti akun Google pengguna; statistik aplikasi adalah jumlah percobaan, bukan laporan tagihan resmi.

## Menjalankan pemeriksaan dan build

```sh
npm test
npm run check
npm run build
```

Build menghasilkan `dist/server/index.js` sebagai Worker dan `dist/client` sebagai aset. Pengujian otomatis menggunakan respons provider simulasi; tidak mengklaim sukses panggilan AI sungguhan.

## Deployment

GitHub Pages diterbitkan otomatis oleh `.github/workflows/pages.yml` setiap push ke `main`. Workflow memeriksa TypeScript dan tes, menjalankan `npm run build:pages`, lalu menerbitkan `dist-pages`. Frontend statis menggunakan base path `/Transly/`; routing sesi memakai hash sehingga refresh tidak membutuhkan fallback server. Backend AI tetap di Sites karena GitHub Pages tidak menjalankan API server.

Site ini menggunakan Sites. `.openai/hosting.json` menyimpan identitas Site, bukan secret. Dari sesi Codex dengan plugin Sites, gunakan skill `sites-hosting` untuk push source, mengemas build, menyimpan versi, dan deploy. Atur `SESSION_SECRET` sebagai runtime secret melalui Sites sebelum deploy. Akses publik telah diminta untuk aplikasi ini. Jalankan pemeriksaan URL production dan flow AI dengan key aktif setelah publikasi.

Deployment aktif: [transly-studio.adikagung32.chatgpt.site](https://transly-studio.adikagung32.chatgpt.site/). Aset, route aplikasi, penyimpanan key, dan penanganan key invalid telah diperiksa di production. Generate dan evaluasi sukses telah diuji dengan key pengguna pada Gemini 3.5 Flash. Model lain tetap bergantung pada akses dan ketersediaan provider.

Untuk Cloudflare Workers langsung, build dan deploy konfigurasi `dist/server/wrangler.json` memakai akun Cloudflare Anda, lalu konfigurasi runtime secret:

Brankas akun bergantung pada identitas terverifikasi dari dispatcher Sites. Deployment Worker langsung wajib menyediakan gateway autentikasi tepercaya yang menghapus header identitas kiriman klien dan memverifikasi sesi sebelum meneruskan identitas; jangan mengekspos backend brankas langsung dengan mempercayai header publik. Alur SIWC bawaan dan provisioning D1 dikelola Sites.

```sh
npx wrangler secret put SESSION_SECRET --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

Source tersedia di [Darlayx1/Transly](https://github.com/Darlayx1/Transly), branch `main`. Repository GitHub menyimpan source; aplikasi publik berjalan di Sites dengan backend Cloudflare Workers. Untuk memperbarui source dari checkout yang sudah terhubung:

```sh
git push github main
```

Autentikasi Git menggunakan Git Credential Manager. Jangan menyimpan token dalam URL remote.

## Status pengujian

Lihat `TESTING.md` untuk hasil dan batas verifikasi. Skor AI adalah panduan pembelajaran, bukan ujian terstandar. Versi ideal merupakan salah satu jawaban valid, bukan satu-satunya jawaban benar.
