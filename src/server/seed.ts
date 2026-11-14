import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, db } from './db.ts';
import { hashCode, hashPassword } from './auth.ts';

function createGentleToneWav(filePath: string, durationSec = 4): void {
  if (fs.existsSync(filePath)) return;
  const sampleRate = 8000;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples);
    const freq = t < 2 ? 293.66 : 329.63; // D4 -> E4 gentle chime tone
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 4000 * envelope);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

export function seedDemoDatabase(): void {
  const existing = db.prepare(`SELECT COUNT(*) AS cnt FROM profiles`).get() as { cnt: number };
  if (existing.cnt > 0) return;

  const now = '2026-11-13T08:00:00+07:00';
  const demoPass = hashPassword('Tahfidz2026!');

  const tx = db.transaction(() => {
    // System Settings
    const settings: [string, string][] = [
      ['institution_name', 'Pondok Pesantren Tahfidz Al-Furqan'],
      ['passing_threshold', '80'],
      ['leaderboard_visible', 'true'],
      ['ai_auto_analyze', 'true'],
      ['whatsapp_provider', 'belum_dikonfigurasi'],
      ['whatsapp_template', "Assalamu'alaikum Bapak/Ibu {{wali_nama}}. Laporan setoran {{jenis_setoran}} Ananda {{santri_nama}} (Juz {{juz}}, Hal {{halaman}}) telah dipublikasikan. Nilai: {{nilai}}. Lihat detail di portal E-Tahfidz."],
      ['audio_retention_policy', 'Rekaman audio disimpan secara privat maksimal 180 hari untuk evaluasi pembelajaran dan hanya dapat diakses oleh ustadz pembimbing, santri, serta wali yang terhubung dan diberi izin.'],
    ];
    const insertSetting = db.prepare(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`
    );
    for (const [k, v] of settings) insertSetting.run(k, v, now);

    // Mushaf Settings
    db.prepare(
      `INSERT INTO mushaf_settings (id, mushaf_name, total_juz, default_pages_per_juz, passing_threshold, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('mushaf-madinah', 'Mushaf Madinah (Rasm Utsmani)', 30, 20, 80, 1, now);

    db.prepare(
      `INSERT INTO mushaf_settings (id, mushaf_name, total_juz, default_pages_per_juz, passing_threshold, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('mushaf-pojok-15', 'Mushaf Pojok 15 Baris (Khusus 15 Hal/Juz)', 30, 15, 60, 0, now);

    // Profiles (4 Roles)
    const profiles = [
      { id: 'prof-admin', full_name: 'H. Ridwan Kamil, S.Pd.I', email: 'admin@etahfidz.id', phone: '08111222333', role: 'admin', avatar: null },
      { id: 'prof-ustadz-1', full_name: 'Ustadz Ahmad Fauzi, Lc.', email: 'ustadz.ahmad@etahfidz.id', phone: '081234567890', role: 'ustadz', avatar: '/src/assets/images/avatar_ustadz_mentor_1794618126782.jpg' },
      { id: 'prof-ustadz-2', full_name: 'Ustadzah Aisyah Zahra, Al-Hafidzah', email: 'ustadzah.aisyah@etahfidz.id', phone: '081298765432', role: 'ustadz', avatar: null },
      { id: 'prof-wali-1', full_name: 'Bpk. Budi Santoso', email: 'wali.budi@etahfidz.id', phone: '081355566677', role: 'wali_santri', avatar: null },
      { id: 'prof-wali-2', full_name: 'Ibu Siti Aminah', email: 'wali.aminah@etahfidz.id', phone: '081377788899', role: 'wali_santri', avatar: null },
      { id: 'prof-santri-1', full_name: 'Zaid Al-Farisi', email: 'santri.zaid@etahfidz.id', phone: '085611122233', role: 'santri', avatar: null },
      { id: 'prof-santri-2', full_name: 'Fatimah Az-Zahra', email: 'santri.fatimah@etahfidz.id', phone: '085644455566', role: 'santri', avatar: null },
      { id: 'prof-santri-3', full_name: 'Yusuf Pratama', email: 'santri.yusuf@etahfidz.id', phone: '085677788899', role: 'santri', avatar: null },
      { id: 'prof-santri-4', full_name: 'Hana Humaira', email: 'santri.hana@etahfidz.id', phone: '085699900011', role: 'santri', avatar: null },
    ];
    const insertProfile = db.prepare(
      `INSERT INTO profiles (id, full_name, email, password_hash, phone, avatar_url, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const p of profiles) {
      insertProfile.run(p.id, p.full_name, p.email, demoPass, p.phone, p.avatar, p.role, now, now);
    }

    // Teachers
    db.prepare(
      `INSERT INTO teachers (id, profile_id, employee_number, specialization, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run('tch-1', 'prof-ustadz-1', 'UST-2024-001', 'Sanad 30 Juz & Qiraat Sab\'ah', now);
    db.prepare(
      `INSERT INTO teachers (id, profile_id, employee_number, specialization, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run('tch-2', 'prof-ustadz-2', 'UST-2024-002', 'Tahsin, Tajwid & Tahfidz Putri', now);

    // Classes
    db.prepare(
      `INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run('cls-1', 'Halaqah Al-Fatih', 'Kelas Tahfidz Intensif Putra Tingkat Lanjut', 'Intensif', now);
    db.prepare(
      `INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run('cls-2', 'Halaqah An-Naba', 'Kelas Tahfidz Reguler Juz 1-5 & Juz 30', 'Menengah', now);
    db.prepare(
      `INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run('cls-3', 'Halaqah Khadijah', 'Kelas Tahfidz Putri Binaan Ustadzah Aisyah', 'Intensif', now);

    // Teacher Assignments (Ustadz Ahmad -> Al-Fatih & An-Naba; Ustadzah Aisyah -> Khadijah)
    db.prepare(`INSERT INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`).run('ta-1', 'tch-1', 'cls-1', now);
    db.prepare(`INSERT INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`).run('ta-2', 'tch-1', 'cls-2', now);
    db.prepare(`INSERT INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`).run('ta-3', 'tch-2', 'cls-3', now);

    // Students
    const students = [
      { id: 'stu-1', profile_id: 'prof-santri-1', num: '2026-0101', name: 'Zaid Al-Farisi', class_id: 'cls-1' },
      { id: 'stu-2', profile_id: 'prof-santri-2', num: '2026-0102', name: 'Fatimah Az-Zahra', class_id: 'cls-1' },
      { id: 'stu-3', profile_id: 'prof-santri-3', num: '2026-0103', name: 'Yusuf Pratama', class_id: 'cls-2' },
      { id: 'stu-4', profile_id: 'prof-santri-4', num: '2026-0104', name: 'Hana Humaira', class_id: 'cls-3' },
    ];
    for (const s of students) {
      db.prepare(
        `INSERT INTO students (id, profile_id, student_number, full_name, class_id, enrollment_status, created_at)
         VALUES (?, ?, ?, ?, ?, 'aktif', ?)`
      ).run(s.id, s.profile_id, s.num, s.name, s.class_id, now);
      db.prepare(
        `INSERT INTO class_enrollments (id, class_id, student_id, start_date, status) VALUES (?, ?, ?, ?, 'aktif')`
      ).run(`ce-${s.id}`, s.class_id, s.id, '2026-07-15');
    }

    // Guardians
    db.prepare(`INSERT INTO guardians (id, profile_id, relationship, created_at) VALUES (?, ?, ?, ?)`).run('grd-1', 'prof-wali-1', 'Ayah Kandung', now);
    db.prepare(`INSERT INTO guardians (id, profile_id, relationship, created_at) VALUES (?, ?, ?, ?)`).run('grd-2', 'prof-wali-2', 'Ibu Kandung', now);

    // Guardian Student Links (Wali Budi linked to Zaid & Fatimah for Child Switcher!)
    db.prepare(
      `INSERT INTO guardian_student_links (id, guardian_id, student_id, relationship, is_primary, audio_access_allowed, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`
    ).run('gsl-1', 'grd-1', 'stu-1', 'Ayah Kandung', now);
    db.prepare(
      `INSERT INTO guardian_student_links (id, guardian_id, student_id, relationship, is_primary, audio_access_allowed, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`
    ).run('gsl-2', 'grd-1', 'stu-2', 'Ayah Kandung', now);
    db.prepare(
      `INSERT INTO guardian_student_links (id, guardian_id, student_id, relationship, is_primary, audio_access_allowed, created_at)
       VALUES (?, ?, ?, ?, 1, 1, ?)`
    ).run('gsl-3', 'grd-2', 'stu-3', 'Ibu Kandung', now);

    // Ready-to-test invite code for linking Hana Humaira (demo code: HUB-HANA-2026)
    db.prepare(
      `INSERT INTO guardian_link_invites (id, guardian_id, student_id, invitation_code_hash, plain_hint, expires_at, used_at, status, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, NULL, 'pending', ?)`
    ).run('inv-demo-1', 'stu-4', hashCode('HUB-HANA-2026'), 'HUB-HANA-2026', '2027-12-31T23:59:59Z', now);

    // Error Tags (4 categories)
    const errorTags: [string, string, string, string][] = [
      ['err-mad-kurang', 'Mad kurang panjang', 'Tajwid', 'Panjang mad thabi\'i atau mad far\'i kurang dari harakat standar'],
      ['err-mad-lebih', 'Mad berlebihan', 'Tajwid', 'Panjang bacaan mad melebihi batas harakat'],
      ['err-dengung', 'Dengung kurang tepat', 'Tajwid', 'Kualitas dan kadar ghunnah/dengung belum seimbang'],
      ['err-ghunnah', 'Ghunnah belum sesuai', 'Tajwid', 'Nun/mim bertasydid kurang berdengung 2 harakat'],
      ['err-nun-sukun', 'Kesalahan hukum nun sukun & tanwin', 'Tajwid', 'Kekeliruan penerapan idzhar, idgham, iqlab, atau ikhfa'],
      ['err-mim-sukun', 'Kesalahan hukum mim sukun', 'Tajwid', 'Kekeliruan ikhfa syafawi, idgham mimi, atau idzhar syafawi'],
      ['err-idgham', 'Kesalahan idgham', 'Tajwid', 'Peleburan huruf kurang sempurna'],
      ['err-ikhfa', 'Kesalahan ikhfa', 'Tajwid', 'Samar bunyi nun sukun kurang tepat pada makhraj huruf berikutnya'],
      ['err-izhar', 'Kesalahan izhar', 'Tajwid', 'Huruf halqi dibaca berdengung padahal harus jelas'],
      ['err-qalqalah', 'Kesalahan qalqalah', 'Tajwid', 'Pantulan qalqalah sughra/kubra lemah atau berlebih'],
      ['err-makhraj-huruf', 'Pengucapan huruf belum tepat', 'Makhraj & Sifat Huruf', 'Titik keluar huruf belum sesuai makhraj'],
      ['err-huruf-tertukar', 'Huruf tertukar', 'Makhraj & Sifat Huruf', 'Misalnya tertukar antara ain/hamzah, tsa/sin, atau dhad/dzal'],
      ['err-sifat-huruf', 'Sifat huruf belum sesuai', 'Makhraj & Sifat Huruf', 'Hams, jahr, syiddah, rakhawah, atau isti\'la belum tepat'],
      ['err-makhraj-perbaiki', 'Ketepatan makhraj perlu diperbaiki', 'Makhraj & Sifat Huruf', 'Perlu latihan pengucapan berulang per kata'],
      ['err-lupa-ayat', 'Lupa ayat', 'Kelancaran', 'Terhenti karena lupa kelanjutan lafaz ayat'],
      ['err-berhenti-lama', 'Berhenti terlalu lama', 'Kelancaran', 'Jeda berpikir terlalu panjang antar ayat'],
      ['err-ragu', 'Ragu-ragu melanjutkan ayat', 'Kelancaran', 'Mengulang potongan kalimat karena kurang yakin'],
      ['err-urut-ayat', 'Tertukar urutan ayat', 'Kelancaran', 'Melompat ke ayat serupa di halaman lain'],
      ['err-sambung-ayat', 'Belum mampu menyambung ayat', 'Kelancaran', 'Kesulitan transisi awal ke pertengahan halaman'],
      ['err-waqaf', 'Berhenti pada tempat kurang tepat', 'Waqaf & Ibtida', 'Waqaf memutus makna kalimat secara tidak tepat'],
      ['err-ibtida', 'Memulai bacaan pada tempat kurang tepat', 'Waqaf & Ibtida', 'Ibtida tidak mengambil awal kalimat yang sah'],
      ['err-kesinambungan', 'Belum memahami kesinambungan ayat', 'Waqaf & Ibtida', 'Penggalan napas mengganggu kesatuan makna'],
    ];
    const insertErrTag = db.prepare(
      `INSERT INTO error_tags (id, tag_name, category, description, is_active) VALUES (?, ?, ?, ?, 1)`
    );
    for (const [id, name, cat, desc] of errorTags) {
      insertErrTag.run(id, name, cat, desc);
    }

    // Badges
    const badgeDefs: [string, string, string, string, string][] = [
      ['bdg-istiqomah-7', 'Istiqomah 7 Hari', 'Menyetorkan hafalan atau murojaah selama 7 hari aktif.', 'Flame', 'streak_7'],
      ['bdg-istiqomah-30', 'Istiqomah 30 Hari', 'Konsisten menyetorkan hafalan selama 30 hari.', 'Award', 'streak_30'],
      ['bdg-zero-mistakes', 'Zero Mistakes', 'Memperoleh nilai sempurna 100 pada satu juz.', 'Sparkles', 'juz_100'],
      ['bdg-murojaah-champ', 'Murojaah Champion', 'Menyelesaikan minimal 5 sesi murojaah terstruktur.', 'Repeat', 'murojaah_5'],
      ['bdg-explorer', 'Hafalan Explorer', 'Menyetorkan minimal 10 halaman ziyadah resmi.', 'Compass', 'pages_10'],
      ['bdg-target', 'Target Achiever', 'Berhasil mencapai target hafalan mingguan.', 'Target', 'target_hit'],
      ['bdg-one-juz', 'One Juz Completed', 'Menyelesaikan 20 halaman penuh pada satu juz.', 'BookOpenCheck', 'juz_complete'],
      ['bdg-consistent', 'Consistent Learner', 'Menjaga rata-rata nilai di atas 4,5 pada bulan berjalan.', 'TrendingUp', 'avg_4_5'],
    ];
    const insertBadge = db.prepare(
      `INSERT INTO badges (id, badge_name, description, icon, criteria, is_active) VALUES (?, ?, ?, ?, ?, 1)`
    );
    for (const [id, name, desc, icon, crit] of badgeDefs) {
      insertBadge.run(id, name, desc, icon, crit);
    }

    // Helper to insert session + assessments
    const insertSession = db.prepare(
      `INSERT INTO hafalan_sessions (id, student_id, teacher_id, session_type, session_date, juz_number, notes, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAssessment = db.prepare(
      `INSERT INTO page_assessments (id, session_id, juz_number, page_in_juz, mushaf_page_number, score, fluency_score, tajwid_score, makhraj_score, waqaf_score, attempt_number, assessment_status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAssessmentErr = db.prepare(
      `INSERT INTO page_assessment_errors (id, page_assessment_id, error_tag_id, notes) VALUES (?, ?, ?, ?)`
    );

    // ------------------------------------------------------------------
    // SEED DATA FOR ZAID AL-FARISI (stu-1)
    // Juz 1: Completed 20 pages = 98.5 (one page 3.5 -> retried -> 4.5, one page 4.0)
    // Juz 2: 14/20 pages completed, showing realistic trend + Mad errors on pages 12-14
    // ------------------------------------------------------------------
    const zaidJuz1Dates = [
      '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-15'
    ];
    let paCounter = 1;
    zaidJuz1Dates.forEach((d, batchIdx) => {
      const sid = `ses-z-j1-${batchIdx + 1}`;
      insertSession.run(sid, 'stu-1', 'tch-1', 'ziyadah', d, 1, `Setoran Juz 1 Halaman ${batchIdx * 4 + 1}–${batchIdx * 4 + 4} berjalan lancar.`, 'published', `${d}T09:00:00+07:00`, `${d}T08:45:00+07:00`, `${d}T09:00:00+07:00`);
      for (let offset = 1; offset <= 4; offset++) {
        const page = batchIdx * 4 + offset;
        let score = 5;
        let tajwid = 5;
        let fluency = 5;
        if (page === 12) { score = 4; tajwid = 4; fluency = 4.25; }
        if (page === 17) { score = 4.5; tajwid = 4.25; }
        const paid = `pa-z-${paCounter++}`;
        insertAssessment.run(paid, sid, 1, page, page, score, fluency, tajwid, 5, 5, 1, 'resmi', page === 12 ? 'Perhatikan mad wajib muttashil' : 'Lancar', `${d}T08:45:00+07:00`, `${d}T09:00:00+07:00`);
        if (page === 12) {
          insertAssessmentErr.run(`pae-${paid}`, paid, 'err-mad-kurang', 'Panjang mad kurang konsisten 4-5 harakat');
        }
      }
    });

    // Zaid Juz 2 (14 pages across 5 dates, with page 13 initially 3.5 then retried to 4.25)
    const zaidJuz2Batches: { date: string; pages: { p: number; s: number; f: number; t: number; m: number; err?: string; note: string; attempt?: number }[] }[] = [
      {
        date: '2026-10-24',
        pages: [
          { p: 1, s: 5, f: 5, t: 5, m: 5, note: 'Sangat baik dan tartil' },
          { p: 2, s: 5, f: 5, t: 5, m: 4.75, note: 'Lancar' },
          { p: 3, s: 4.5, f: 4.5, t: 4.5, m: 4.75, err: 'err-mad-kurang', note: 'Mad arid lissukun jaga kestabilannya' },
        ],
      },
      {
        date: '2026-10-29',
        pages: [
          { p: 4, s: 4.75, f: 5, t: 4.5, m: 4.75, note: 'Bagus' },
          { p: 5, s: 4.5, f: 4.5, t: 4.5, m: 4.5, err: 'err-ghunnah', note: 'Ghunnah nun tasydid perlu ditahan' },
          { p: 6, s: 5, f: 5, t: 5, m: 5, note: 'Mutqin' },
        ],
      },
      {
        date: '2026-11-02',
        pages: [
          { p: 7, s: 4.5, f: 4.5, t: 4.5, m: 4.75, note: 'Cukup lancar' },
          { p: 8, s: 4.25, f: 4, t: 4.25, m: 4.5, err: 'err-ragu', note: 'Sedikit ragu di pertengahan ayat' },
          { p: 9, s: 4.5, f: 4.5, t: 4.25, m: 4.75, err: 'err-mad-kurang', note: 'Mad jaiz munfashil kurang panjang' },
        ],
      },
      {
        date: '2026-11-06',
        pages: [
          { p: 10, s: 4, f: 4, t: 4, m: 4.5, err: 'err-mad-kurang', note: 'Mad thabi\'i di akhir ayat sering pendek' },
          { p: 11, s: 4.25, f: 4.25, t: 4, m: 4.5, err: 'err-dengung', note: 'Ikhfa haqiqi perlu diperhalus' },
          { p: 12, s: 3.75, f: 3.5, t: 4, m: 4.25, err: 'err-lupa-ayat', note: 'Terhenti di ayat tentang qiblat' },
          { p: 13, s: 3.5, f: 3.25, t: 3.75, m: 4, err: 'err-lupa-ayat', note: 'Percobaan pertama, perlu murojaah ulang', attempt: 1 },
        ],
      },
      {
        date: '2026-11-11',
        pages: [
          { p: 13, s: 4.25, f: 4.25, t: 4.25, m: 4.5, err: 'err-mad-kurang', note: 'Sudah jauh lebih lancar pada setoran ulang', attempt: 2 },
          { p: 14, s: 3.75, f: 3.75, t: 3.75, m: 4.25, err: 'err-mad-kurang', note: 'Halaman baru, panjang mad perlu diperhatikan' },
        ],
      },
    ];

    zaidJuz2Batches.forEach((b, idx) => {
      const sid = `ses-z-j2-${idx + 1}`;
      insertSession.run(sid, 'stu-1', 'tch-1', 'ziyadah', b.date, 2, `Setoran Ziyadah Juz 2 — ${b.pages.length} halaman`, 'published', `${b.date}T09:15:00+07:00`, `${b.date}T08:50:00+07:00`, `${b.date}T09:15:00+07:00`);
      for (const pg of b.pages) {
        const paid = `pa-z-${paCounter++}`;
        insertAssessment.run(paid, sid, 2, pg.p, 21 + pg.p, pg.s, pg.f, pg.t, pg.m, 4.75, pg.attempt ?? 1, 'resmi', pg.note, `${b.date}T08:55:00+07:00`, `${b.date}T09:15:00+07:00`);
        if (pg.err) {
          insertAssessmentErr.run(`pae-${paid}`, paid, pg.err, pg.note);
        }
      }
    });

    // Zaid Murojaah Sessions (separate from Ziyadah!)
    const murojaahZaid = [
      { id: 'ses-z-mur-1', date: '2026-11-04', juz: 1, p1: 11, p2: 12, s1: 4.75, s2: 4.5, note: 'Murojaah Juz 1 hal 11-12 meningkat setelah latihan mad.' },
      { id: 'ses-z-mur-2', date: '2026-11-09', juz: 2, p1: 12, p2: 13, s1: 4.25, s2: 4.25, note: 'Penguatan Juz 2 hal 12-13.' },
      { id: 'ses-z-mur-3', date: '2026-11-12', juz: 2, p1: 10, p2: 14, s1: 4.5, s2: 4.0, note: 'Murojaah pekan ini cukup stabil, lanjutkan hal 14.' },
    ];
    murojaahZaid.forEach((m, i) => {
      insertSession.run(m.id, 'stu-1', 'tch-1', 'murojaah', m.date, m.juz, m.note, 'published', `${m.date}T16:30:00+07:00`, `${m.date}T16:15:00+07:00`, `${m.date}T16:30:00+07:00`);
      const pa1 = `pa-zm-${i * 2 + 1}`;
      const pa2 = `pa-zm-${i * 2 + 2}`;
      insertAssessment.run(pa1, m.id, m.juz, m.p1, m.p1, m.s1, m.s1, m.s1, 4.75, 4.75, 1, 'resmi', 'Murojaah lancar', `${m.date}T16:20:00+07:00`, `${m.date}T16:30:00+07:00`);
      insertAssessment.run(pa2, m.id, m.juz, m.p2, m.p2, m.s2, m.s2, m.s2, 4.5, 4.75, 1, 'resmi', m.note, `${m.date}T16:22:00+07:00`, `${m.date}T16:30:00+07:00`);
    });

    // Fatimah (stu-2) — Juz 30 complete (96.5), Juz 29 6/20 pages
    const fatimahDates = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08'];
    fatimahDates.forEach((d, bi) => {
      const sid = `ses-f-j30-${bi + 1}`;
      insertSession.run(sid, 'stu-2', 'tch-1', 'ziyadah', d, 30, `Setoran Juz 30 kelompok halaman ${bi * 5 + 1}-${bi * 5 + 5}`, 'published', `${d}T10:00:00+07:00`, `${d}T09:45:00+07:00`, `${d}T10:00:00+07:00`);
      for (let off = 1; off <= 5; off++) {
        const p = bi * 5 + off;
        const sc = p % 7 === 0 ? 4.5 : p === 19 ? 4.25 : 4.9;
        const paid = `pa-f-${p}`;
        insertAssessment.run(paid, sid, 30, p, 581 + p, sc, sc, 4.8, 4.9, 5, 1, 'resmi', 'Tartil dan jelas makhrajnya', `${d}T09:50:00+07:00`, `${d}T10:00:00+07:00`);
        if (p === 19) {
          insertAssessmentErr.run(`pae-${paid}`, paid, 'err-qalqalah', 'Qalqalah kubra akhir ayat perlu dipertegas');
        }
      }
    });
    // Fatimah Juz 29 (6 pages)
    insertSession.run('ses-f-j29-1', 'stu-2', 'tch-1', 'ziyadah', '2026-11-12', 29, 'Mulai Juz 29 Surah Al-Mulk', 'published', '2026-11-12T09:30:00+07:00', '2026-11-12T09:10:00+07:00', '2026-11-12T09:30:00+07:00');
    for (let p = 1; p <= 6; p++) {
      insertAssessment.run(`pa-f29-${p}`, 'ses-f-j29-1', 29, p, 561 + p, p <= 4 ? 4.75 : 4.5, 4.75, 4.6, 4.8, 4.75, 1, 'resmi', 'Baik, jaga tajwid idgham', '2026-11-12T09:15:00+07:00', '2026-11-12T09:30:00+07:00');
    }

    // Yusuf (stu-3) — Juz 1 10/20 pages
    ['2026-11-03', '2026-11-07', '2026-11-10'].forEach((d, idx) => {
      const sid = `ses-y-j1-${idx + 1}`;
      insertSession.run(sid, 'stu-3', 'tch-1', 'ziyadah', d, 1, `Setoran Juz 1 bagian ${idx + 1}`, 'published', `${d}T11:00:00+07:00`, `${d}T10:40:00+07:00`, `${d}T11:00:00+07:00`);
      const count = idx === 2 ? 4 : 3;
      const startP = idx === 0 ? 1 : idx === 1 ? 4 : 7;
      for (let k = 0; k < count; k++) {
        const p = startP + k;
        const paid = `pa-y-${p}`;
        const sc = p >= 8 ? 3.75 : 4.5;
        insertAssessment.run(paid, sid, 1, p, p, sc, sc, 4.25, 4.25, 4.5, 1, 'resmi', 'Terus murojaah harian', `${d}T10:45:00+07:00`, `${d}T11:00:00+07:00`);
        if (p >= 8) {
          insertAssessmentErr.run(`pae-${paid}`, paid, 'err-berhenti-lama', 'Berhenti cukup lama di pertengahan halaman');
        }
      }
    });

    // Hana (stu-4, binaan Ustadzah Aisyah — tch-2)
    insertSession.run('ses-h-j30-1', 'stu-4', 'tch-2', 'ziyadah', '2026-11-11', 30, 'Setoran Juz 30 binaan Ustadzah Aisyah', 'published', '2026-11-11T10:00:00+07:00', '2026-11-11T09:30:00+07:00', '2026-11-11T10:00:00+07:00');
    for (let p = 1; p <= 5; p++) {
      insertAssessment.run(`pa-h-${p}`, 'ses-h-j30-1', 30, p, 581 + p, 4.75, 4.75, 4.75, 5, 4.75, 1, 'resmi', 'Sangat tartil', '2026-11-11T09:40:00+07:00', '2026-11-11T10:00:00+07:00');
    }

    // Audio Attachment (private file stored in data/audio/)
    const wavName = 'demo-zaid-juz2-hal14.wav';
    createGentleToneWav(path.join(AUDIO_DIR, wavName), 4);
    db.prepare(
      `INSERT INTO audio_attachments (id, session_id, page_assessment_id, storage_path, mime_type, duration_seconds, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, 'audio/wav', 4, 'prof-ustadz-1', ?)`
    ).run('aud-demo-1', 'ses-z-j2-5', 'pa-z-35', wavName, '2026-11-11T09:15:00+07:00');

    // Targets
    db.prepare(
      `INSERT INTO hafalan_targets (id, student_id, target_type, target_pages, target_date, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('tgt-1', 'stu-1', 'mingguan', 5, '2026-11-15', 'aktif', 'prof-ustadz-1', now);
    db.prepare(
      `INSERT INTO hafalan_targets (id, student_id, target_type, target_pages, target_date, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('tgt-2', 'stu-2', 'mingguan', 6, '2026-11-15', 'tercapai', 'prof-ustadz-1', now);
    db.prepare(
      `INSERT INTO hafalan_targets (id, student_id, target_type, target_pages, target_date, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('tgt-3', 'stu-3', 'mingguan', 4, '2026-11-15', 'belum_tercapai', 'prof-ustadz-1', now);

    // Murojaah Schedules
    const scheds = [
      ['sch-1', 'stu-1', 2, 14, 14, '2026-11-13', 'tinggi', 'pa-z-35', 'Nilai 3,75 dengan catatan panjang mad; dijadwalkan penguatan hari ini.', 'terjadwal'],
      ['sch-2', 'stu-1', 2, 12, 12, '2026-11-12', 'tinggi', 'pa-z-32', 'Pernah terhenti pada ayat qiblat; perlu murojaah penguatan.', 'terlambat'],
      ['sch-3', 'stu-1', 2, 9, 11, '2026-11-15', 'sedang', 'pa-z-30', 'Pemantapan hukum mad dan ghunnah (siklus 3 hari).', 'terjadwal'],
      ['sch-4', 'stu-1', 1, 1, 20, '2026-11-20', 'rutin', 'pa-z-1', 'Siklus murojaah 14 hari untuk menjaga kemutqinan Juz 1.', 'terjadwal'],
      ['sch-5', 'stu-2', 30, 19, 19, '2026-11-14', 'sedang', 'pa-f-19', 'Pemantapan qalqalah kubra halaman 19 Juz 30.', 'terjadwal'],
      ['sch-6', 'stu-3', 1, 8, 10, '2026-11-13', 'tinggi', 'pa-y-8', 'Kelancaran halaman 8-10 Juz 1 perlu diulang hari ini.', 'terjadwal'],
    ];
    const insertSched = db.prepare(
      `INSERT INTO murojaah_schedules (id, student_id, juz_number, page_start, page_end, scheduled_date, priority, source_assessment_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of scheds) {
      insertSched.run(...s, now);
    }

    // Student Badges
    db.prepare(`INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`).run('sb-1', 'stu-1', 'bdg-one-juz', '2026-10-15T09:00:00+07:00');
    db.prepare(`INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`).run('sb-2', 'stu-1', 'bdg-explorer', '2026-10-29T09:00:00+07:00');
    db.prepare(`INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`).run('sb-3', 'stu-1', 'bdg-istiqomah-7', '2026-11-11T09:15:00+07:00');
    db.prepare(`INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`).run('sb-4', 'stu-2', 'bdg-one-juz', '2026-11-08T10:00:00+07:00');
    db.prepare(`INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`).run('sb-5', 'stu-2', 'bdg-target', '2026-11-12T09:30:00+07:00');

    // Notifications
    db.prepare(
      `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      'notif-1',
      'prof-wali-1',
      'Laporan Setoran Ziyadah Zaid Al-Farisi',
      "Assalamu'alaikum. Laporan setoran ziyadah Juz 2 halaman 13-14 telah dipublikasikan oleh Ustadz Ahmad Fauzi.",
      'setoran',
      'ses-z-j2-5',
      '2026-11-11T09:16:00+07:00'
    );
    db.prepare(
      `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      'notif-2',
      'prof-santri-1',
      'Jadwal Murojaah Hari Ini',
      'Pengingat: Halaman 14 Juz 2 dijadwalkan untuk penguatan mad hari ini.',
      'murojaah',
      'sch-1',
      now
    );

    // Notification Preferences
    db.prepare(
      `INSERT INTO notification_preferences (id, profile_id, in_app_enabled, whatsapp_enabled, whatsapp_consent_at, phone_number, updated_at)
       VALUES (?, ?, 1, 0, NULL, ?, ?)`
    ).run('np-wali-1', 'prof-wali-1', '081355566677', now);

    // Initial Audit Log
    db.prepare(
      `INSERT INTO audit_logs (id, actor_profile_id, action, entity_type, entity_id, old_values, new_values, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'aud-log-1',
      'prof-ustadz-1',
      'PENILAIAN_ULANG',
      'page_assessment',
      'pa-z-34',
      JSON.stringify({ juz: 2, halaman: 13, score: 3.5 }),
      JSON.stringify({ juz: 2, halaman: 13, score: 4.25, attempt: 2 }),
      '2026-11-11T09:15:00+07:00'
    );
  });

  tx();
}
