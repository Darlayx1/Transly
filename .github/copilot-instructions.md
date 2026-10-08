# Anti-Loop, Anti-Repetition, and Efficient Debugging Rules

Sistem aturan ini wajib dipatuhi secara ketat untuk mencegah perulangan debug tanpa akhir (infinite loops), pemanggilan tool yang mubazir, dan pemborosan token/konteks di lingkungan GitHub (GitHub Copilot, GitHub Actions, Codespaces, dan GitHub AI Agents).

---

## 1. Iteration Control
- **Batas Percobaan**: Maksimal 3 percobaan perbaikan untuk setiap masalah/bug.
- **Deteksi Kegagalan Serupa**: Jika 2 percobaan berturut-turut menghasilkan kegagalan atau error yang sama, HENTIKAN perubahan kode dan segera lakukan Root Cause Analysis (RCA).
- **Larangan Repetisi**: Dilarang keras mengulang solusi yang identik tanpa hipotesis baru atau bukti baru yang valid.
- **Eskalasi Stop**: Setelah 3 percobaan gagal, hentikan proses otomatisasi perbaikan dan laporkan kendala serta batasan kepada pengguna.

## 2. Intelligent Debugging
- **Penyebab Utama (Root Cause First)**: Identifikasi akar penyebab masalah secara pasti sebelum mengubah atau menyentuh kode.
- **Pemeriksaan Komprehensif**: Periksa log sistem, konfigurasi environment, dependency, dan file terkait secara seksama.
- **Perubahan Minimal & Terisolasi**: Prioritaskan perubahan kecil (atomic changes) yang dapat diuji dan diverifikasi secara terpisah.
- **Fokus Masalah**: Hindari perubahan sampingan (side effects) atau modifikasi yang tidak berkaitan langsung dengan masalah utama.
- **Proteksi Kode Fungsional**: Jangan mengganti atau mengutak-atik kode yang sudah bekerja tanpa alasan terverifikasi dan bukti konkrit.

## 3. Terminal & Execution Safety
- **Perintah Non-Repetitif**: Jangan menjalankan perintah terminal yang sama berulang-ulang tanpa alasan atau parameter baru.
- **Timeout Management**: Terapkan batas waktu (timeout) pada proses atau perintah yang berpotensi menggantung (hang).
- **Hindari Interaktivitas Tanpa Batas**: Hindari memicu proses terminal interaktif yang memblokir eksekusi tanpa batas waktu.
- **Penanganan Deadlock**: Identifikasi dan hentikan secara aman proses yang mengalami deadlock, loop tak terbatas, atau hang.
- **Server Guard**: Jangan menjalankan ulang (restart) server jika instance sebelumnya masih berfungsi dengan baik.

## 4. Token & Context Efficiency
- **Pembacaan File Selektif**: Hindari membaca file identik berulang kali tanpa adanya perubahan konten yang relevan.
- **Pencarian Spesifik**: Gunakan pencarian terarah (targeted search/grep) sebelum memutuskan membaca seluruh codebase atau file besar.
- **Pencatatan Konteks**: Catat temuan penting, error trace, dan hasil pengujian sebelumnya agar tidak perlu dianalisis ulang.
- **Komunikasi Efisien**: Hindari penjelasan internal/narasi yang berulang-ulang tanpa memberikan progres atau informasi baru.
- **Checkpointing**: Gunakan checkpoint atau ringkasan berkala untuk mempertahankan konteks kerja yang padat dan jelas.

## 5. Change Management
- **Verifikasi Status Git**: Periksa Git status dan Git diff sebelum dan sesudah melakukan perubahan yang berisiko.
- **Hormati Kode Pengguna**: Jangan pernah melakukan rollback atau menimpa perubahan pengguna tanpa izin eksplisit.
- **Dokumentasi Strategi**: Catat perubahan yang dilakukan, hasil pengujian, serta alasan di balik strategi perbaikan.
- **Larangan Refactoring Prematur**: Jangan melakukan refactoring arsitektur besar hanya untuk menyelesaikan bug kecil yang terlokalisasi.
- **Disiplin Scope**: Jangan mengubah file di luar lingkup tugas yang diminta tanpa kebutuhan dan persetujuan yang jelas.

## 6. Completion & Verification
- **Kriteria Keberhasilan Terukur**: Setiap tugas perbaikan harus memiliki kriteria keberhasilan yang terdefinisi dan terukur.
- **Verifikasi Berbasis Pengujian**: Verifikasi hasil perbaikan menggunakan pengujian otomatis (unit/integration test), linter, atau verifikasi log yang relevan.
- **Bukti Konkrit**: Jangan pernah mengklaim masalah telah terselesaikan tanpa bukti verifikasi nyata dari output pengujian.
- **Transparansi Limitasi**: Jika solusi gagal berulang dan menemui jalan buntu, berhenti dan jelaskan batasannya secara transparan.
- **Hindari Over-Optimization**: Jangan terus melakukan optimasi tanpa adanya manfaat performa atau arsitektur yang terukur.

## 7. Circuit Breaker Protocol
Terapkan urutan mitigasi kegagalan bertahap berikut:
1. **Attempt 1:** Lakukan analisis akar masalah secara mendalam, buat perubahan minimal terarah, dan jalankan uji verifikasi.
2. **Attempt 2:** Jika Attempt 1 gagal, evaluasi ulang. Gunakan hipotesis baru atau pendekatan alternatif yang berbeda, lalu uji kembali.
3. **Attempt 3:** Jika Attempt 2 masih gagal, lakukan satu percobaan alternatif terakhir yang didukung bukti dan analisis error baru.
4. **STOP:** Jika Attempt 3 tetap gagal, hentikan percobaan secara otomatis dan permanen untuk siklus ini. Laporkan seluruh temuan, hipotesis yang telah diuji, akar kendala yang teridentifikasi, serta usulkan opsi keputusan manual selanjutnya kepada pengguna.

**Kondisi Khusus (Identical Error Breaker):**
Jika 2 percobaan berturut-turut menghasilkan gejala error yang identik, proses otomatis dihentikan sementara untuk melakukan Root Cause Analysis (RCA) secara menyeluruh sebelum melangkah ke percobaan berikutnya.
