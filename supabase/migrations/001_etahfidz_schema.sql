-- ==============================================================================
-- E-TAHFIDZ — PostgreSQL / Supabase Production Migration & Row Level Security
-- Mencakup 23 tabel inti relasional, index, constraint validasi, dan kebijakan RLS.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'ustadz', 'wali_santri', 'santri')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  account_status TEXT NOT NULL DEFAULT 'approved' CHECK (account_status IN ('pending', 'approved', 'rejected', 'needs_revision', 'suspended')),
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. classes
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_name TEXT NOT NULL UNIQUE,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'Reguler',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. students
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  student_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  enrollment_status TEXT NOT NULL DEFAULT 'aktif' CHECK (enrollment_status IN ('aktif', 'cuti', 'lulus', 'nonaktif')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. guardians
CREATE TABLE IF NOT EXISTS public.guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'Orang Tua',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. guardian_student_links
CREATE TABLE IF NOT EXISTS public.guardian_student_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id UUID NOT NULL REFERENCES public.guardians(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'Orang Tua',
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  audio_access_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guardian_id, student_id)
);

-- 5. guardian_link_invites
CREATE TABLE IF NOT EXISTS public.guardian_link_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id UUID REFERENCES public.guardians(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  invitation_code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired', 'revoked'))
);

-- 6. teachers
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_number TEXT NOT NULL UNIQUE,
  specialization TEXT NOT NULL DEFAULT 'Tahfidz & Tajwid',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. class_enrollments
CREATE TABLE IF NOT EXISTS public.class_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'selesai', 'pindah')),
  UNIQUE (class_id, student_id, status)
);

-- 9. teacher_assignments
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, class_id)
);

-- 10. mushaf_settings
CREATE TABLE IF NOT EXISTS public.mushaf_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mushaf_name TEXT NOT NULL,
  total_juz INTEGER NOT NULL DEFAULT 30 CHECK (total_juz BETWEEN 1 AND 30),
  default_pages_per_juz INTEGER NOT NULL DEFAULT 20 CHECK (default_pages_per_juz BETWEEN 10 AND 30),
  passing_threshold NUMERIC(5,2) NOT NULL DEFAULT 80.00,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. hafalan_sessions
CREATE TABLE IF NOT EXISTS public.hafalan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  session_type TEXT NOT NULL CHECK (session_type IN ('ziyadah', 'murojaah', 'tes_tahfidz')),
  exam_type TEXT CHECK (exam_type IN ('PTS', 'PAS')),
  semester TEXT CHECK (semester IN ('Ganjil', 'Genap')),
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  class_name TEXT,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'corrected')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. page_assessments
CREATE TABLE IF NOT EXISTS public.page_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.hafalan_sessions(id) ON DELETE CASCADE,
  juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
  page_in_juz INTEGER NOT NULL CHECK (page_in_juz >= 1),
  mushaf_page_number INTEGER,
  score NUMERIC(4,2) NOT NULL CHECK (score >= 0 AND score <= 5),
  fluency_score NUMERIC(4,2) NOT NULL CHECK (fluency_score >= 0 AND fluency_score <= 5),
  tajwid_score NUMERIC(4,2) NOT NULL CHECK (tajwid_score >= 0 AND tajwid_score <= 5),
  makhraj_score NUMERIC(4,2) NOT NULL CHECK (makhraj_score >= 0 AND makhraj_score <= 5),
  waqaf_score NUMERIC(4,2) NOT NULL CHECK (waqaf_score >= 0 AND waqaf_score <= 5),
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  assessment_status TEXT NOT NULL DEFAULT 'resmi' CHECK (assessment_status IN ('draft', 'resmi', 'revisi')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. error_tags
CREATE TABLE IF NOT EXISTS public.error_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('Tajwid', 'Makhraj & Sifat Huruf', 'Kelancaran', 'Waqaf & Ibtida')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 14. page_assessment_errors
CREATE TABLE IF NOT EXISTS public.page_assessment_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_assessment_id UUID NOT NULL REFERENCES public.page_assessments(id) ON DELETE CASCADE,
  error_tag_id UUID NOT NULL REFERENCES public.error_tags(id) ON DELETE RESTRICT,
  notes TEXT
);

-- 15. audio_attachments
CREATE TABLE IF NOT EXISTS public.audio_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.hafalan_sessions(id) ON DELETE CASCADE,
  page_assessment_id UUID REFERENCES public.page_assessments(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 120),
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. hafalan_targets
CREATE TABLE IF NOT EXISTS public.hafalan_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('harian', 'mingguan', 'bulanan')),
  target_pages INTEGER NOT NULL CHECK (target_pages > 0),
  target_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'tercapai', 'belum_tercapai')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT
);

-- 17. murojaah_schedules
CREATE TABLE IF NOT EXISTS public.murojaah_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  juz_number INTEGER NOT NULL CHECK (juz_number BETWEEN 1 AND 30),
  page_start INTEGER NOT NULL CHECK (page_start >= 1),
  page_end INTEGER NOT NULL CHECK (page_end >= page_start),
  scheduled_date DATE NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('kritis', 'tinggi', 'sedang', 'rutin')),
  source_assessment_id UUID REFERENCES public.page_assessments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'terjadwal' CHECK (status IN ('terjadwal', 'selesai', 'terlambat', 'dilewati')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. ai_analyses
CREATE TABLE IF NOT EXISTS public.ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  input_summary TEXT NOT NULL,
  insights JSONB NOT NULL,
  recommendations JSONB NOT NULL,
  prediction JSONB,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('rendah', 'sedang', 'tinggi')),
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. badges
CREATE TABLE IF NOT EXISTS public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  criteria TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 20. student_badges
CREATE TABLE IF NOT EXISTS public.student_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  badge_id UUID NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, badge_id)
);

-- 21. notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  related_entity_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. notification_preferences
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_consent_at TIMESTAMPTZ,
  phone_number TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 23. audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 24. pending_applications (TANPA kolom password; password dikelola eksklusif oleh Supabase Auth)
CREATE TABLE IF NOT EXISTS public.pending_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('santri', 'wali_santri', 'ustadz')),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  identity_number TEXT,
  halaqah_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_revision', 'suspended')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  admin_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_students_class ON public.students(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_student_date ON public.hafalan_sessions(student_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_session ON public.page_assessments(session_id);
CREATE INDEX IF NOT EXISTS idx_assessments_juz_page ON public.page_assessments(juz_number, page_in_juz);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_profile_id, is_read);
CREATE INDEX IF NOT EXISTS idx_murojaah_student_date ON public.murojaah_schedules(student_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_pending_apps_status ON public.pending_applications(status, submitted_at DESC);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) HELPER FUNCTIONS & POLICIES
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = TRUE
      AND account_status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = TRUE
    AND account_status = 'approved';
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(target_student_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    public.is_approved_user() AND (
      public.current_user_role() = 'admin'
      OR EXISTS (
        SELECT 1 FROM public.students s WHERE s.id = target_student_id AND s.profile_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.guardian_student_links gsl
        JOIN public.guardians g ON g.id = gsl.guardian_id
        WHERE gsl.student_id = target_student_id AND g.profile_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teacher_assignments ta ON ta.class_id = s.class_id
        JOIN public.teachers t ON t.id = ta.teacher_id
        WHERE s.id = target_student_id AND t.profile_id = auth.uid()
      )
    );
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hafalan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_or_admin" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.current_user_role() = 'admin');

CREATE POLICY "profiles_update_self_no_role_or_status_change" ON public.profiles
  FOR UPDATE USING (id = auth.uid() AND public.is_approved_user())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND account_status = (SELECT p.account_status FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "pending_apps_owner_select" ON public.pending_applications
  FOR SELECT USING (supabase_user_id = auth.uid() OR public.current_user_role() = 'admin');

CREATE POLICY "pending_apps_owner_insert_pending_only" ON public.pending_applications
  FOR INSERT WITH CHECK (
    supabase_user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

CREATE POLICY "pending_apps_owner_revise_rejected_only" ON public.pending_applications
  FOR UPDATE USING (
    supabase_user_id = auth.uid()
    AND status IN ('rejected', 'needs_revision')
  )
  WITH CHECK (
    supabase_user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
  );

CREATE POLICY "pending_apps_admin_manage_all" ON public.pending_applications
  FOR ALL USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "students_scoped_select" ON public.students
  FOR SELECT USING (public.can_access_student(id));

CREATE POLICY "sessions_scoped_select" ON public.hafalan_sessions
  FOR SELECT USING (public.can_access_student(student_id));

CREATE POLICY "sessions_teacher_insert" ON public.hafalan_sessions
  FOR INSERT WITH CHECK (
    public.current_user_role() IN ('admin', 'ustadz') AND public.can_access_student(student_id)
  );

CREATE POLICY "assessments_scoped_select" ON public.page_assessments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.hafalan_sessions hs
      WHERE hs.id = session_id AND public.can_access_student(hs.student_id)
    )
  );

CREATE POLICY "notifications_owner_only" ON public.notifications
  FOR ALL USING (
    (recipient_profile_id = auth.uid() AND public.is_approved_user())
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY "audit_logs_admin_only" ON public.audit_logs
  FOR SELECT USING (public.current_user_role() = 'admin');
