# Transly

Aplikasi latihan menerjemahkan bahasa Inggris ke bahasa Indonesia. AI menyusun soal sesuai konfigurasi, kemudian menilai makna dan kualitas bahasa dengan feedback kontekstual.

## Fitur

- Level A1–C2 dan Native; panjang pendek/sedang/panjang; durasi 5–60 menit.
- Topik otomatis, pilihan topik, topik custom, dan sembilan gaya bahasa.
- Model generator dan evaluator dipilih secara independen.
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
| GEMINI_API_KEY | Opsional | Shared server key; untuk deployment publik, BYOK direkomendasikan |

Jangan beri prefix `NEXT_PUBLIC_` pada credential. `.env*`, `.dev.vars*`, dependencies, build, dan runtime diabaikan Git; `.env.example` adalah contoh tanpa nilai asli.

## Custom API key dan keamanan

Buka **Pengaturan AI** dan masukkan key Google AI Studio. Dua key berbeda dapat digunakan. Key tidak dikembalikan oleh endpoint status, tidak masuk ke localStorage, URL, log aplikasi, atau JavaScript bundle. Input dibersihkan setelah tersimpan/ditutup. Cookie berisi ciphertext AES-GCM dengan IV acak, `HttpOnly`, `SameSite=Strict`, masa berlaku 24 jam, dan `Secure` pada HTTPS; cookie hanya dikirim ke `/api`. Key didekripsi hanya di server lalu dikirim ke Google dalam header `x-goog-api-key`.

Teks sumber dan jawaban dikirim ke Google untuk proses AI. Draft dan evaluasi tetap disimpan lokal pada perangkat. Enkripsi cookie melindungi key dari pembacaan JavaScript, tetapi bukan dari kompromi perangkat/browser/server. Rotasi SESSION_SECRET membatalkan cookie lama. Gunakan tombol **Hapus key** untuk menghapus credential pada perangkat bersama.

Endpoint membatasi ukuran request, memvalidasi input, menolak cross-origin, membatasi tujuan provider, dan menyembunyikan error internal. Throttling 12 permintaan per key/menit bersifat best-effort per isolate; untuk penggunaan skala besar, tambahkan rate limiting terdistribusi pada gateway. Hindari shared server key pada situs publik tanpa pengendalian kuota tambahan. Tidak ada credential produksi bawaan: user harus memasukkan key aktif. Kuota/billing mengikuti akun Google milik user.

## Menjalankan pemeriksaan dan build

```sh
npm test
npm run check
npm run build
```

Build menghasilkan `dist/server/index.js` sebagai Worker dan `dist/client` sebagai aset. Pengujian otomatis menggunakan respons provider simulasi; tidak mengklaim sukses panggilan AI sungguhan.

## Deployment

Site ini menggunakan Sites. `.openai/hosting.json` menyimpan identitas Site, bukan secret. Dari sesi Codex dengan plugin Sites, gunakan skill `sites-hosting` untuk push source, mengemas build, menyimpan versi, dan deploy. Atur `SESSION_SECRET` sebagai runtime secret melalui Sites sebelum deploy. Akses publik telah diminta untuk aplikasi ini. Jalankan pemeriksaan URL production dan flow AI dengan key aktif setelah publikasi.

Deployment aktif: [transly-studio.adikagung32.chatgpt.site](https://transly-studio.adikagung32.chatgpt.site/). Aset, route aplikasi, penyimpanan key, dan penanganan key invalid telah diperiksa di production. Generate dan evaluasi sukses telah diuji dengan key pengguna pada Gemini 3.5 Flash. Model lain tetap bergantung pada akses dan ketersediaan provider.

Untuk Cloudflare Workers langsung, build dan deploy konfigurasi `dist/server/wrangler.json` memakai akun Cloudflare Anda, lalu konfigurasi runtime secret:

```sh
npx wrangler secret put SESSION_SECRET --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

Repository GitHub dan penyimpanan source internal Sites adalah tujuan yang berbeda. Push ke GitHub membutuhkan autentikasi akun Darlayx1, lalu:

```sh
git remote add github https://github.com/Darlayx1/Transly.git
git push -u github main
```

Buat repository kosong bernama Transly lebih dahulu melalui akun yang sesuai. Jangan menyimpan token dalam URL remote.

## Status pengujian

Lihat `TESTING.md` untuk hasil dan batas verifikasi. Skor AI adalah panduan pembelajaran, bukan ujian terstandar. Versi ideal merupakan salah satu jawaban valid, bukan satu-satunya jawaban benar.
