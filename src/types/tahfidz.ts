export type UserRole = 'admin' | 'ustadz' | 'wali_santri' | 'santri';
export type RequestableRole = 'santri' | 'wali_santri' | 'ustadz';
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'needs_revision' | 'suspended';

export type SessionType = 'ziyadah' | 'murojaah' | 'tes_tahfidz';
export type ExamType = 'PTS' | 'PAS';
export type SemesterType = 'Ganjil' | 'Genap';
export type SessionStatus = 'draft' | 'published' | 'corrected';

export type JuzProgressStatus =
  | 'belum_dimulai'
  | 'sedang_berjalan'
  | 'menunggu_evaluasi'
  | 'selesai_dinilai'
  | 'perlu_penguatan';

export type EligibilityStatus = 'belum_lengkap' | 'layak' | 'perlu_perbaikan';

export type MurojaahPriority = 'kritis' | 'tinggi' | 'sedang' | 'rutin';

export type ErrorCategory =
  | 'Tajwid'
  | 'Makhraj & Sifat Huruf'
  | 'Kelancaran'
  | 'Waqaf & Ibtida';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  account_status?: AccountStatus;
  email_verified?: boolean;
  auth_provider?: string;
  created_at: string;
  updated_at: string;
}

export interface PendingApplicationRecord {
  id: string;
  supabase_user_id: string | null;
  profile_id: string | null;
  requested_role: RequestableRole;
  full_name: string;
  email: string;
  phone: string | null;
  identity_number: string | null;
  halaqah_name: string | null;
  status: AccountStatus;
  email_verified: boolean;
  admin_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewer_name?: string | null;
  updated_at: string;
}

export interface EmailNotificationRecord {
  id: string;
  recipient_email: string;
  recipient_name: string;
  subject: string;
  body: string;
  status: 'terkirim' | 'simulasi_lokal' | 'gagal';
  created_at: string;
}

export interface MushafSetting {
  id: string;
  mushaf_name: string;
  total_juz: number;
  default_pages_per_juz: number;
  passing_threshold: number;
  is_default: boolean;
  created_at: string;
}

export interface ClassGroup {
  id: string;
  class_name: string;
  description: string | null;
  level: string;
  created_at: string;
  teacher_names?: string[];
  student_count?: number;
}

export interface TeacherRecord {
  id: string;
  profile_id: string;
  employee_number: string;
  specialization: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  assigned_classes?: { id: string; class_name: string }[];
  created_at: string;
}

export interface StudentRecord {
  id: string;
  profile_id: string | null;
  student_number: string;
  full_name: string;
  class_id: string | null;
  class_name?: string | null;
  enrollment_status: 'aktif' | 'cuti' | 'lulus' | 'nonaktif';
  email?: string | null;
  avatar_url?: string | null;
  created_at: string;
}

export interface GuardianRecord {
  id: string;
  profile_id: string;
  relationship: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  linked_students?: {
    link_id: string;
    student_id: string;
    student_name: string;
    student_number: string;
    relationship: string;
    is_primary: boolean;
    audio_access_allowed: boolean;
  }[];
  created_at: string;
}

export interface ErrorTag {
  id: string;
  tag_name: string;
  category: ErrorCategory;
  description: string | null;
  is_active: boolean;
}

export interface PageAssessmentInput {
  juz_number: number;
  page_in_juz: number;
  mushaf_page_number?: number | null;
  score: number;
  fluency_score: number;
  tajwid_score: number;
  makhraj_score: number;
  waqaf_score: number;
  notes?: string | null;
  error_tag_ids?: string[];
}

export interface PageAssessmentRecord {
  id: string;
  session_id: string;
  session_type: SessionType;
  exam_type?: ExamType | null;
  semester?: SemesterType | null;
  class_id?: string | null;
  class_name?: string | null;
  session_status: SessionStatus;
  session_date: string;
  student_id: string;
  teacher_id: string;
  teacher_name?: string;
  juz_number: number;
  page_in_juz: number;
  mushaf_page_number: number | null;
  score: number;
  fluency_score: number;
  tajwid_score: number;
  makhraj_score: number;
  waqaf_score: number;
  attempt_number: number;
  assessment_status: 'draft' | 'resmi' | 'revisi';
  notes: string | null;
  errors?: { id: string; tag_name: string; category: ErrorCategory; notes: string | null }[];
  created_at: string;
  updated_at: string;
}

export interface HafalanSessionRecord {
  id: string;
  student_id: string;
  student_name?: string;
  teacher_id: string;
  teacher_name?: string;
  session_type: SessionType;
  exam_type?: ExamType | null;
  semester?: SemesterType | null;
  class_id?: string | null;
  class_name?: string | null;
  session_date: string;
  juz_number: number;
  notes: string | null;
  status: SessionStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  assessments: PageAssessmentRecord[];
  audio_attachments?: AudioAttachmentRecord[];
}

export interface AudioAttachmentRecord {
  id: string;
  session_id: string;
  page_assessment_id: string | null;
  duration_seconds: number;
  uploaded_by: string;
  uploader_name?: string;
  juz_number?: number;
  page_in_juz?: number | null;
  session_type?: SessionType;
  exam_type?: ExamType | null;
  semester?: SemesterType | null;
  class_name?: string | null;
  session_date?: string;
  signed_url?: string;
  can_listen?: boolean;
  created_at: string;
}

export interface JuzProgressSummary {
  juzNumber: number;
  pagesPerJuz: number;
  assessedPagesCount: number;
  draftPagesCount: number;
  isComplete: boolean;
  totalScore: number;
  maxPossibleCurrent: number;
  maxPossibleFull: number;
  averagePerPage: number | null;
  juzStatus: JuzProgressStatus;
  eligibilityStatus: EligibilityStatus;
  activePages: Record<number, PageAssessmentRecord>;
  allAttemptsCount: number;
}

export interface RadarSkillMetrics {
  kelancaran: number;
  tajwid: number;
  makhraj: number;
  konsistensi: number;
  kecepatan: number;
  sampleCount: number;
}

export interface CompletionPrediction {
  insufficientData: boolean;
  reason?: string;
  targetJuz: number;
  remainingPages: number;
  activeDaysObserved: number;
  pagesPerActiveDay: number;
  estimatedDays: number | null;
  estimatedDateStart: string | null;
  estimatedDateEnd: string | null;
  periodStart: string;
  periodEnd: string;
  confidenceLevel: 'rendah' | 'sedang' | 'tinggi';
}

export interface MurojaahScheduleRecord {
  id: string;
  student_id: string;
  student_name?: string;
  juz_number: number;
  page_start: number;
  page_end: number;
  scheduled_date: string;
  priority: MurojaahPriority;
  source_assessment_id: string | null;
  reason?: string | null;
  status: 'terjadwal' | 'selesai' | 'terlambat' | 'dilewati';
  created_at: string;
}

export interface AIAnalysisRecord {
  id: string;
  student_id: string;
  analysis_type: string;
  period_start: string;
  period_end: string;
  input_summary: string;
  insights: {
    kelancaran: string;
    kelemahan: string;
    konsistensi: string;
  };
  recommendations: string[];
  prediction: CompletionPrediction | null;
  confidence_level: 'rendah' | 'sedang' | 'tinggi';
  model_name: string;
  is_live_ai: boolean;
  created_at: string;
}

export interface BadgeRecord {
  id: string;
  badge_name: string;
  description: string;
  icon: string;
  criteria: string;
  is_active: boolean;
  earned_at?: string;
}

export interface HafalanTargetRecord {
  id: string;
  student_id: string;
  target_type: 'harian' | 'mingguan' | 'bulanan';
  target_pages: number;
  target_date: string;
  status: 'aktif' | 'tercapai' | 'belum_tercapai';
  created_by: string;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  recipient_profile_id: string;
  title: string;
  message: string;
  notification_type: 'setoran' | 'nilai' | 'target' | 'murojaah' | 'badge' | 'integrasi';
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_profile_id: string;
  actor_name?: string;
  actor_role?: UserRole;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: string | null;
  new_values: string | null;
  created_at: string;
}
