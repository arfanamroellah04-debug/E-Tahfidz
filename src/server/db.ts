import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'etahfidz.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    -- 1. profiles
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'ustadz', 'wali_santri', 'santri')),
      is_active INTEGER NOT NULL DEFAULT 1,
      account_status TEXT NOT NULL DEFAULT 'approved' CHECK (account_status IN ('pending', 'approved', 'rejected', 'needs_revision', 'suspended')),
      email_verified INTEGER NOT NULL DEFAULT 1,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 7. classes
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      class_name TEXT NOT NULL UNIQUE,
      description TEXT,
      level TEXT NOT NULL DEFAULT 'Reguler',
      created_at TEXT NOT NULL
    );

    -- 2. students
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      profile_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
      student_number TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      enrollment_status TEXT NOT NULL DEFAULT 'aktif' CHECK (enrollment_status IN ('aktif', 'cuti', 'lulus', 'nonaktif')),
      created_at TEXT NOT NULL
    );

    -- 3. guardians
    CREATE TABLE IF NOT EXISTS guardians (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL DEFAULT 'Orang Tua',
      created_at TEXT NOT NULL
    );

    -- 4. guardian_student_links
    CREATE TABLE IF NOT EXISTS guardian_student_links (
      id TEXT PRIMARY KEY,
      guardian_id TEXT NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL DEFAULT 'Orang Tua',
      is_primary INTEGER NOT NULL DEFAULT 1,
      audio_access_allowed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (guardian_id, student_id)
    );

    -- 5. guardian_link_invites
    CREATE TABLE IF NOT EXISTS guardian_link_invites (
      id TEXT PRIMARY KEY,
      guardian_id TEXT REFERENCES guardians(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      invitation_code_hash TEXT NOT NULL,
      plain_hint TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'revoked')),
      created_at TEXT NOT NULL
    );

    -- 6. teachers
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      employee_number TEXT NOT NULL UNIQUE,
      specialization TEXT NOT NULL DEFAULT 'Tahfidz & Tajwid',
      created_at TEXT NOT NULL
    );

    -- 8. class_enrollments
    CREATE TABLE IF NOT EXISTS class_enrollments (
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'selesai', 'pindah'))
    );

    -- 9. teacher_assignments
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL,
      UNIQUE (teacher_id, class_id)
    );

    -- 10. mushaf_settings
    CREATE TABLE IF NOT EXISTS mushaf_settings (
      id TEXT PRIMARY KEY,
      mushaf_name TEXT NOT NULL,
      total_juz INTEGER NOT NULL DEFAULT 30,
      default_pages_per_juz INTEGER NOT NULL DEFAULT 20,
      passing_threshold REAL NOT NULL DEFAULT 80,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 11. hafalan_sessions
    CREATE TABLE IF NOT EXISTS hafalan_sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
      session_type TEXT NOT NULL CHECK (session_type IN ('ziyadah', 'murojaah', 'tes_tahfidz')),
      exam_type TEXT CHECK (exam_type IN ('PTS', 'PAS')),
      semester TEXT CHECK (semester IN ('Ganjil', 'Genap')),
      class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
      class_name TEXT,
      session_date TEXT NOT NULL,
      juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'corrected')),
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 12. page_assessments
    CREATE TABLE IF NOT EXISTS page_assessments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES hafalan_sessions(id) ON DELETE CASCADE,
      juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
      page_in_juz INTEGER NOT NULL CHECK (page_in_juz >= 1),
      mushaf_page_number INTEGER,
      score REAL NOT NULL CHECK (score >= 0 AND score <= 5),
      fluency_score REAL NOT NULL CHECK (fluency_score >= 0 AND fluency_score <= 5),
      tajwid_score REAL NOT NULL CHECK (tajwid_score >= 0 AND tajwid_score <= 5),
      makhraj_score REAL NOT NULL CHECK (makhraj_score >= 0 AND makhraj_score <= 5),
      waqaf_score REAL NOT NULL CHECK (waqaf_score >= 0 AND waqaf_score <= 5),
      attempt_number INTEGER NOT NULL DEFAULT 1,
      assessment_status TEXT NOT NULL DEFAULT 'resmi' CHECK (assessment_status IN ('draft', 'resmi', 'revisi')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 13. error_tags
    CREATE TABLE IF NOT EXISTS error_tags (
      id TEXT PRIMARY KEY,
      tag_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK (category IN ('Tajwid', 'Makhraj & Sifat Huruf', 'Kelancaran', 'Waqaf & Ibtida')),
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    -- 14. page_assessment_errors
    CREATE TABLE IF NOT EXISTS page_assessment_errors (
      id TEXT PRIMARY KEY,
      page_assessment_id TEXT NOT NULL REFERENCES page_assessments(id) ON DELETE CASCADE,
      error_tag_id TEXT NOT NULL REFERENCES error_tags(id) ON DELETE RESTRICT,
      notes TEXT
    );

    -- 15. audio_attachments
    CREATE TABLE IF NOT EXISTS audio_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES hafalan_sessions(id) ON DELETE CASCADE,
      page_assessment_id TEXT REFERENCES page_assessments(id) ON DELETE SET NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'audio/wav',
      duration_seconds INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    -- 16. hafalan_targets
    CREATE TABLE IF NOT EXISTS hafalan_targets (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('harian', 'mingguan', 'bulanan')),
      target_pages INTEGER NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'tercapai', 'belum_tercapai')),
      created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    -- 17. murojaah_schedules
    CREATE TABLE IF NOT EXISTS murojaah_schedules (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      scheduled_date TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('kritis', 'tinggi', 'sedang', 'rutin')),
      source_assessment_id TEXT REFERENCES page_assessments(id) ON DELETE SET NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'terjadwal' CHECK (status IN ('terjadwal', 'selesai', 'terlambat', 'dilewati')),
      created_at TEXT NOT NULL
    );

    -- 18. ai_analyses
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      insights TEXT NOT NULL,
      recommendations TEXT NOT NULL,
      prediction TEXT,
      confidence_level TEXT NOT NULL CHECK (confidence_level IN ('rendah', 'sedang', 'tinggi')),
      model_name TEXT NOT NULL,
      is_live_ai INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 19. badges
    CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      badge_name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      criteria TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    -- 20. student_badges
    CREATE TABLE IF NOT EXISTS student_badges (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      earned_at TEXT NOT NULL,
      UNIQUE (student_id, badge_id)
    );

    -- 21. notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      recipient_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      notification_type TEXT NOT NULL,
      related_entity_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 22. notification_preferences
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
      whatsapp_consent_at TEXT,
      phone_number TEXT,
      updated_at TEXT NOT NULL
    );

    -- 23. audit_logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT NOT NULL
    );

    -- 24. system_settings (Konfigurasi Lembaga, Leaderboard, AI, WhatsApp Gateway)
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 25. whatsapp_logs
    CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id TEXT PRIMARY KEY,
      recipient_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      message_preview TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('terkirim', 'gagal', 'belum_dikonfigurasi', 'ditunda_tanpa_izin')),
      error_detail TEXT,
      created_at TEXT NOT NULL
    );

    -- 26. pending_applications (TANPA kolom password demi keamanan)
    CREATE TABLE IF NOT EXISTS pending_applications (
      id TEXT PRIMARY KEY,
      supabase_user_id TEXT UNIQUE,
      profile_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      requested_role TEXT NOT NULL CHECK (requested_role IN ('santri', 'wali_santri', 'ustadz')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      identity_number TEXT,
      halaqah_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_revision', 'suspended')),
      email_verified INTEGER NOT NULL DEFAULT 1,
      admin_notes TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );

    -- 27. email_notifications (Log email pemberitahuan verifikasi/persetujuan tanpa password)
    CREATE TABLE IF NOT EXISTS email_notifications (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('terkirim', 'simulasi_lokal', 'gagal')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_student_date ON hafalan_sessions(student_id, session_date DESC);
    CREATE INDEX IF NOT EXISTS idx_assessments_session ON page_assessments(session_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_profile_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_murojaah_student_date ON murojaah_schedules(student_id, scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_pending_apps_status ON pending_applications(status, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_apps_email ON pending_applications(email);
  `);

  // Safe migration for existing SQLite DBs missing tes_tahfidz / PTS-PAS columns
  const sessionTableMeta = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'hafalan_sessions'`)
    .get() as { sql: string } | undefined;

  if (sessionTableMeta && !sessionTableMeta.sql.includes('tes_tahfidz')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE hafalan_sessions_migrated (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
        session_type TEXT NOT NULL CHECK (session_type IN ('ziyadah', 'murojaah', 'tes_tahfidz')),
        exam_type TEXT CHECK (exam_type IN ('PTS', 'PAS')),
        semester TEXT CHECK (semester IN ('Ganjil', 'Genap')),
        class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
        class_name TEXT,
        session_date TEXT NOT NULL,
        juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'corrected')),
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO hafalan_sessions_migrated (
        id, student_id, teacher_id, session_type, session_date, juz_number,
        notes, status, published_at, created_at, updated_at
      )
      SELECT
        id, student_id, teacher_id, session_type, session_date, juz_number,
        notes, status, published_at, created_at, updated_at
      FROM hafalan_sessions;
      DROP TABLE hafalan_sessions;
      ALTER TABLE hafalan_sessions_migrated RENAME TO hafalan_sessions;
      CREATE INDEX IF NOT EXISTS idx_sessions_student_date ON hafalan_sessions(student_id, session_date DESC);
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Safe migration for existing profiles table missing account_status / email_verified / auth_provider
  const profileCols = db.prepare(`PRAGMA table_info(profiles)`).all() as { name: string }[];
  const colNames = new Set(profileCols.map((c) => c.name));
  if (!colNames.has('account_status')) {
    db.exec(
      `ALTER TABLE profiles ADD COLUMN account_status TEXT NOT NULL DEFAULT 'approved' CHECK (account_status IN ('pending', 'approved', 'rejected', 'needs_revision', 'suspended'));`
    );
  }
  if (!colNames.has('email_verified')) {
    db.exec(`ALTER TABLE profiles ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!colNames.has('auth_provider')) {
    db.exec(`ALTER TABLE profiles ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local';`);
  }
}
