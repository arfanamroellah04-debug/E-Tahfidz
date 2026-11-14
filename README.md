# E-Tahfidz — Platform Manajemen & Penilaian Hafalan Al-Qur'an

Aplikasi web responsif dan PWA (*Progressive Web App*) untuk pengelolaan, penilaian per halaman/juz, pemantauan real-time wali santri, *Smart Murojaah Scheduler*, dan analisis AI perkembangan hafalan Al-Qur'an.

---

## Struktur Proyek

```text
├── server.ts                          # Express + WebSocket (ws) server + Vite middleware
├── supabase/migrations/
│   └── 001_etahfidz_schema.sql        # Skema PostgreSQL lengkap (23 tabel) + Index + RLS Policies
├── src/
│   ├── App.tsx                        # Shell utama berbasis 4 peran + WebSocket live sync
│   ├── components/
│   │   ├── LoginView.tsx              # Login 4 peran, Reset Password & Demo Quick Login
│   │   ├── SessionInputForm.tsx       # Input setoran cepat Ziyadah/Murojaah + Audio + Tag Kesalahan
│   │   ├── StudentDetailWorkspace.tsx # Progres Juz/Halaman, AI, Scheduler, Audio, Badge & Ekspor
│   │   ├── ChartsPanel.tsx            # 5 grafik interaktif Recharts (Area, Bar, Halaman, Radar, Konsistensi)
│   │   ├── ErrorStatsPanel.tsx        # Statistik kesalahan Tajwid, Makhraj, Kelancaran & Waqaf
│   │   ├── AdminConsole.tsx           # CRUD Pengguna, Kelas, Relasi Wali-Anak, Pengaturan & ERD Visual
│   │   ├── ProfileAndNotifications.tsx# Profil (role terkunci), kode penghubung anak & notifikasi
│   │   └── PWAInstallBanner.tsx       # Tombol instalasi PWA & indikator offline
│   ├── lib/
│   │   ├── tahfidz-rules.ts           # Logika murni penilaian juz, spaced repetition, radar & prediksi
│   │   ├── tahfidz-rules.test.ts      # Unit test (node:test)
│   │   ├── formatters.ts              # Format tanggal Indonesia, WIB (Asia/Jakarta), desimal koma
│   │   ├── export-utils.ts            # Ekspor laporan PDF (jsPDF) & Excel (xlsx)
│   │   └── api.ts                     # Fetch wrapper, WebSocket hook & PWA hooks
│   └── server/
│       ├── db.ts                      # Inisialisasi SQLite relasional 23+ tabel & foreign key
│       ├── auth.ts                    # Hash password scrypt, HMAC token, RBAC & Audit Log
│       ├── seed.ts                    # Data demo pengujian 4 peran + contoh audio privat
│       ├── tahfidz-service.ts         # Ringkasan santri, badge evaluator, notifikasi & WA logger
│       └── ai-service.ts              # Integrasi Gemini AI server-side (@google/genai)
└── .env.example                       # Contoh variabel environment (tanpa kredensial asli)
```

---

## Menjalankan Proyek Secara Lokal

1. Salin `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Pasang dependensi dan jalankan unit test:
   ```bash
   npm install
   npx --yes tsx --test src/lib/tahfidz-rules.test.ts
   ```
3. Jalankan server pengembangan (port `3000`):
   ```bash
   npm run dev
   ```

### Akun Demo Pengujian (Kata Sandi: `Tahfidz2026!`)
- **Admin**: `admin@etahfidz.id`
- **Ustadz / Musyrif**: `ustadz.ahmad@etahfidz.id`
- **Wali Santri (2 Anak)**: `wali.budi@etahfidz.id` *(Kode undangan demo tersedia: `HUB-HANA-2026`)*
- **Santri**: `santri.zaid@etahfidz.id`

---

## Konfigurasi Integrasi Lanjutan

### 1. Supabase PostgreSQL & Row Level Security (Produksi)
1. Buat proyek baru di [Supabase](https://supabase.com).
2. Buka **SQL Editor** dan jalankan isi file `supabase/migrations/001_etahfidz_schema.sql` untuk membuat seluruh 23 tabel, index, constraint validasi, serta kebijakan Row Level Security (RLS).
3. Isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` pada environment deployment.

### 2. Gemini AI (`@google/genai`)
- Atur `GEMINI_API_KEY` pada environment server (di AI Studio melalui **Settings > Secrets**).
- Seluruh pemanggilan AI dilakukan di server (`/api/ai/analyze` -> `src/server/ai-service.ts`) menggunakan model `gemini-4-hydrogen` dan tidak pernah mengekspos kunci ke browser.
- Apabila `GEMINI_API_KEY` belum diisi, sistem secara jujur menampilkan status belum dikonfigurasi dan menyediakan ringkasan statistik deterministik.

### 3. WhatsApp Gateway
- Atur variabel berikut pada environment server:
  - `WHATSAPP_GATEWAY_PROVIDER` (`fonnte` / `wablas` / `meta_cloud_api`)
  - `WHATSAPP_GATEWAY_API_URL`
  - `WHATSAPP_GATEWAY_TOKEN`
- Pesan hanya dikirimkan apabila gateway telah dikonfigurasi **dan** wali santri mengaktifkan persetujuan WhatsApp pada menu **Profil & Notifikasi**.

---

## Deployment
- **Build produksi**: `npm run build`
- **Menjalankan server produksi**: `npm start`
