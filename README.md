# Transly

Aplikasi latihan menerjemahkan bahasa Inggris ke bahasa Indonesia. AI menyusun soal sesuai konfigurasi, kemudian menilai makna dan kualitas bahasa dengan feedback kontekstual.

Buka aplikasi di [GitHub Pages](https://darlayx1.github.io/Transly/). Mode sampel dapat dicoba tanpa API key. Generator dan evaluator AI terhubung ke backend Transly di Sites.

## Fitur

- Level A1–C2 dan Native; panjang pendek/sedang/panjang; durasi 5–60 menit.
- Topik otomatis, pilihan topik, topik custom, dan sembilan gaya bahasa.
- Provider, model, dan key pembuat soal/penilai dipilih secara independen; Gemini dan Groq dapat dipasangkan.
- Pengaturan AI berupa jendela desktop dan layar penuh mobile, dengan Ringkasan, API key, Model & penggunaan, Cadangan & pemulihan, serta Aktivitas.
- Gemini 3.5 Flash menjadi pilihan awal karena telah lulus uji generate dan evaluasi production.
- Gemini 3.8, 3.7, 3.6, 3.5 Flash, 3.5 Flash Lite, dan Gemma 4 31B. Groq menyediakan GPT-OSS 20B, GPT-OSS 120B, dan Qwen 3.8 27B dengan structured output; akses dan kuota mengikuti akun pengguna. Semua model menggunakan tingkat thinking tertinggi yang didukung (`high`).
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
lib/transly/server.ts        enkripsi, error, throttling
lib/transly/provider-adapters.ts konektor Gemini/Groq dan normalisasi respons
lib/transly/sample.ts        alur contoh tanpa API
build/sites-worker.ts        Worker entrypoint dan security headers
tests/run.mjs                pengujian validasi/security/provider
```

Tambah/ganti model dalam `lib/transly/config.ts`; UI dan endpoint membaca katalog yang sama. Model dengan `structured: false` menggunakan instruksi JSON dan validasi setelah respons. Identitas model Groq memakai namespace `groq:` di aplikasi dan diterjemahkan ke ID upstream oleh konektor. Endpoint provider tetap dan hanya dipanggil server-side. Model yang tidak tersedia menampilkan error; perpindahan provider memerlukan model cadangan yang ditentukan pengguna.

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
| GEMINI_API_KEY | Opsional | Shared server key Gemini untuk sesi tanpa akun; BYOK direkomendasikan |
| GROQ_API_KEY | Opsional | Shared server key Groq untuk sesi tanpa akun; BYOK direkomendasikan |

Jangan beri prefix `NEXT_PUBLIC_` pada credential. `.env*`, `.dev.vars*`, dependencies, build, dan runtime diabaikan Git; `.env.example` adalah contoh tanpa nilai asli.

## Custom API key dan keamanan

Buka **Pengaturan AI → API key** pada situs utama dan masuk dengan ChatGPT. Brankas menyimpan hingga 50 key Gemini/Groq secara permanen dalam D1, terpisah per akun. Pilih provider, tempel key, beri nama, lalu **Simpan & uji akses**. Peran, urutan penggunaan, status aktif, dan kelompok kuota ada di Pengaturan lanjutan. Provider key hanya dapat diubah melalui API jika secret diganti; UI edit mempertahankan provider.

Key tersimpan AES-GCM dengan IV acak dan authenticated context yang mengikat akun serta record. Secret brankas terpisah dari SESSION_SECRET. Status hanya mengembalikan metadata dan empat karakter terakhir; secret tidak dikembalikan ke browser, localStorage, URL, log, atau bundle. Input dibersihkan setelah tersimpan/ditutup. Secret didekripsi di server, dikirim ke endpoint Google melalui header `x-goog-api-key` atau endpoint Groq melalui `Authorization: Bearer`. Endpoint tidak dapat dicustom oleh browser.

**Model & penggunaan** memilih provider dan model untuk pembuat soal/penilai secara terpisah. Pemilihan key **Otomatis** mengikuti mode **Utama & cadangan** atau **Pembagian beban**. Jika key tertentu dipilih, hanya key tersebut dipakai untuk model utama. Penggantian provider membersihkan pilihan key yang tidak cocok. Pilihan model, key ID, dan provider cadangan disimpan lokal tanpa secret. Key yang dihapus dari brankas harus diganti pada pilihan penggunaan terkait.

Cadangan lintas provider bersifat opt-in per peran. Pengguna mengaktifkan **Izinkan beralih ke provider lain**, lalu menentukan model cadangan. Sistem dapat mengirim teks ke provider cadangan yang dipilih; provider/model aktual dilaporkan pada hasil dan riwayat. Tanpa pilihan tersebut, cadangan hanya berganti key untuk model/provider yang sama.

Key invalid dikarantina; kegagalan izin berlaku pada pasangan key/model; 429 menghentikan kelompok kuota/model sesuai Retry-After atau RetryInfo. Gangguan provider membuka circuit breaker per provider/model, tanpa menghalangi provider lain. Safety block dan parameter salah tidak memicu pergantian. Maksimal 1–3 percobaan dibagi bersama antara provider utama/cadangan dalam deadline 85 detik; setiap panggilan maksimal 30 detik. Timeout tidak menjamin pekerjaan atau tagihan upstream dibatalkan.

Kelompok kuota diisi pengguna dan tidak diverifikasi otomatis. Gunakan Project ID yang sama untuk key satu proyek Gemini, atau nama organisasi yang sama untuk key satu organisasi Groq. Jika belum diketahui, key masuk kelompok konservatif `unknown` terpisah per provider. Pembatasan atomik D1 berlaku lintas Worker: 30 pekerjaan per akun/menit, 12 panggilan per kelompok/provider/model/menit, 3 pekerjaan bersamaan per akun, 2 panggilan per kelompok/model, dan 1 per key. Kuota resmi tetap ditentukan upstream. Idempotency-Key terikat akun, input, model, dan pilihan key/cadangan; hasil tervalidasi disimpan terenkripsi 10 menit untuk retry tanpa mengulang panggilan yang sudah sukses.

**Uji akses** memakai metadata Gemini atau daftar model Groq tanpa membuat konten. Status membedakan key tersimpan, akses teruji untuk model tertentu, waktu tunggu, izin bermasalah, dan key invalid. Keberhasilan metadata tidak menjamin izin inferensi atau kuota tersedia; keduanya diperiksa saat latihan. Mengganti secret menghapus hasil uji lama. Riwayat menyimpan 100 percobaan per akun (30 ditampilkan) tanpa teks latihan atau secret. Penghapusan key menghapus record/riwayat terkait; pencabutan key harus dilakukan di konsol provider.

**Cadangan & pemulihan** menyediakan ekspor/impor AES-GCM dengan format v2 yang menyimpan identitas provider. Cadangan v1 tetap diterima sebagai Gemini. Kata sandi minimal 12 karakter diproses di browser menggunakan PBKDF2-SHA256 (600.000 iterasi, salt acak); kata sandi tidak dikirim ke server. Derived wrapping key dikirim melalui HTTPS hanya untuk operasi tersebut. File berisi ciphertext, IV, salt, dan versi format. Pemulihan menambah key tanpa menimpa yang ada dan aman diulang. Pilihan model/key perangkat tidak ikut dipulihkan. Simpan kata sandi terpisah; kata sandi cadangan yang hilang tidak dapat dipulihkan.

Rotasi secret brankas: tambahkan versi baru ke VAULT_ENCRYPTION_KEYS sambil mempertahankan versi lama, set VAULT_ACTIVE_VERSION, lalu deploy. Record otomatis dienkripsi ulang saat digunakan; operasi `{ "action": "rotate" }` pada `/api/credentials` mengenkripsi ulang seluruh key akun yang sedang masuk. Hapus versi lama hanya setelah seluruh akun, hasil cache yang belum kedaluwarsa, serta cadangan operasional diverifikasi. Jangan mengganti nilai suatu versi yang sudah dipakai.

Teks sumber dan jawaban dikirim ke provider AI yang dipilih, termasuk provider cadangan jika diaktifkan. Draft dan evaluasi tetap disimpan lokal pada perangkat. Autentikasi ditangani dispatcher Sites melalui SIWC; API memeriksa identitas terverifikasi serta kepemilikan di setiap operasi. Keluar dari akun tidak menghapus brankas. Enkripsi tidak melindungi dari kompromi server yang memegang secret. Development portable menggunakan SQLite persisten di `.sites-runtime/vault.sqlite` dan simulasi login lokal; production menggunakan D1 dan tidak menyertakan simulasi login.

Penyimpanan key di perangkat: Pengguna dapat menyimpan API key Gemini dan Groq langsung di browser perangkat lokal (`localStorage`). Key tetap tersimpan saat me-refresh halaman, menutup tab, atau membuka kembali aplikasi tanpa perlu mengisi ulang. Sesi token terenkripsi disinkronkan secara otomatis dan dapat digunakan baik di situs utama maupun di GitHub Pages. Bagi pengguna situs utama dengan akun ChatGPT, brankas cloud D1 tetap dapat digunakan untuk sinkronisasi multi-key antar perangkat. Backend mengizinkan CORS untuk origin `https://darlayx1.github.io` dan menerima autentikasi Bearer token persisten.

Endpoint membatasi ukuran request aktual termasuk chunked body, memvalidasi input, menolak cross-origin, membatasi tujuan provider, dan menyembunyikan error internal. Throttling sesi legacy tetap best-effort per isolate; brankas memakai reservasi atomik D1. Tidak ada shared provider key produksi bawaan. Kuota dan billing mengikuti akun provider pengguna; statistik aplikasi adalah jumlah percobaan, bukan laporan tagihan resmi.

## Menjalankan pemeriksaan dan build

```sh
npm test
npm run check
npm run build
```

Build menghasilkan `dist/server/index.js` sebagai Worker dan `dist/client` sebagai aset. Pengujian otomatis menggunakan respons provider simulasi; tidak mengklaim sukses panggilan AI sungguhan.

## Deployment

GitHub Pages diterbitkan otomatis oleh `.github/workflows/pages.yml` setiap push ke `main`. Workflow memeriksa TypeScript dan tes, menjalankan `npm run build:pages`, lalu menerbitkan `dist-pages`. Frontend statis menggunakan base path `/Transly/`; routing sesi memakai hash sehingga refresh tidak membutuhkan fallback server. Backend AI tetap di Sites karena GitHub Pages tidak menjalankan API server.

Site ini menggunakan Sites. `.openai/hosting.json` menyimpan identitas Site, bukan secret. Dari sesi Codex dengan plugin Sites, gunakan skill `sites-hosting` untuk push source, mengemas build, menyimpan versi, dan deploy. Atur `SESSION_SECRET` sebagai runtime secret melalui Sites sebelum deploy. Akses publik telah diminta untuk aplikasi ini. Perubahan multi-provider memerlukan migrasi `drizzle/0001_soft_venom.sql` sebelum server baru digunakan; provider key lama otomatis menjadi Gemini tanpa mengubah ciphertext. Preview lokal menerapkan journal migrasi otomatis. Jalankan pemeriksaan URL production dan flow AI dengan key aktif setelah publikasi.

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
