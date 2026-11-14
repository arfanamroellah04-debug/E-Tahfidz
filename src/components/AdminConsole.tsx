import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  KeyRound,
  Link2,
  Plus,
  Settings,
  Shield,
  Trash2,
  Unlink,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatTanggalWaktuWIB } from '../lib/formatters';
import type {
  AuditLogRecord,
  BadgeRecord,
  ErrorTag,
  GuardianRecord,
  MushafSetting,
  StudentRecord,
  TeacherRecord,
} from '../types/tahfidz';

interface AdminOverviewResponse {
  counts: {
    students: number;
    teachers: number;
    guardians: number;
    classes: number;
    sessionsToday: number;
    totalOfficialSessions: number;
    pendingApplications?: number;
  };
  classes: {
    id: string;
    class_name: string;
    description: string | null;
    level: string;
    teachers: { id: string; full_name: string }[];
    student_count: number;
  }[];
  teachers: TeacherRecord[];
  guardians: GuardianRecord[];
  invites: {
    id: string;
    student_id: string;
    student_name: string;
    plain_hint: string;
    expires_at: string;
    used_at: string | null;
    status: string;
    created_at: string;
  }[];
  badges: BadgeRecord[];
  mushafList: MushafSetting[];
  recentAuditLogs: AuditLogRecord[];
  whatsappLogs: {
    id: string;
    recipient_name: string;
    phone_number: string;
    message_preview: string;
    provider: string;
    status: string;
    error_detail: string | null;
    created_at: string;
  }[];
}

interface AdminConsoleProps {
  section: 'overview' | 'users' | 'linking' | 'settings' | 'erd';
  students: StudentRecord[];
  geminiConfigured: boolean;
  whatsappConfigured: boolean;
  whatsappProvider: string;
  systemSettings: Record<string, string>;
  onRefreshAll: () => void;
  onOpenApplications?: () => void;
}

const ERD_GROUPS = [
  {
    title: 'Identitas & Peran',
    tables: [
      { name: 'profiles', pk: 'id (UUID)', fk: '-', desc: 'Akun login 4 peran (admin, ustadz, wali_santri, santri)' },
      { name: 'students', pk: 'id', fk: 'profile_id, class_id', desc: 'Data akademik santri & NIS' },
      { name: 'teachers', pk: 'id', fk: 'profile_id', desc: 'Profil ustadz/musyrif & NIP' },
      { name: 'guardians', pk: 'id', fk: 'profile_id', desc: 'Profil wali santri' },
    ],
  },
  {
    title: 'Relasi Kelas & Wali-Anak',
    tables: [
      { name: 'classes', pk: 'id', fk: '-', desc: 'Halaqah / kelas tahfidz' },
      { name: 'class_enrollments', pk: 'id', fk: 'class_id, student_id', desc: 'Riwayat pendaftaran santri ke kelas' },
      { name: 'teacher_assignments', pk: 'id', fk: 'teacher_id, class_id', desc: 'Hak akses ustadz atas kelas binaan' },
      { name: 'guardian_student_links', pk: 'id', fk: 'guardian_id, student_id', desc: 'Relasi sah multi-anak & multi-wali + izin audio' },
      { name: 'guardian_link_invites', pk: 'id', fk: 'guardian_id, student_id', desc: 'Kode undangan terenkripsi berbatas waktu' },
    ],
  },
  {
    title: 'Penilaian Tahfidz & Audio',
    tables: [
      { name: 'mushaf_settings', pk: 'id', fk: '-', desc: 'Konfigurasi jumlah juz, halaman/juz & ambang nilai' },
      { name: 'hafalan_sessions', pk: 'id', fk: 'student_id, teacher_id', desc: 'Sesi ziyadah atau murojaah (draft/published/corrected)' },
      { name: 'page_assessments', pk: 'id', fk: 'session_id', desc: 'Nilai per halaman (0..5 desimal) & skor komponen' },
      { name: 'error_tags', pk: 'id', fk: '-', desc: 'Master tag kesalahan Tajwid, Makhraj, Kelancaran, Waqaf' },
      { name: 'page_assessment_errors', pk: 'id', fk: 'page_assessment_id, error_tag_id', desc: 'Relasi penilaian dengan tag kesalahan' },
      { name: 'audio_attachments', pk: 'id', fk: 'session_id, page_assessment_id, uploaded_by', desc: 'Metadata rekaman audio privat (signed URL)' },
    ],
  },
  {
    title: 'AI, Scheduler, Gamifikasi & Audit',
    tables: [
      { name: 'hafalan_targets', pk: 'id', fk: 'student_id, created_by', desc: 'Target hafalan harian/mingguan/bulanan' },
      { name: 'murojaah_schedules', pk: 'id', fk: 'student_id, source_assessment_id', desc: 'Jadwal pengulangan berbasis spaced repetition' },
      { name: 'ai_analyses', pk: 'id', fk: 'student_id', desc: 'Hasil analisis Gemini AI, periode & prediksi' },
      { name: 'badges', pk: 'id', fk: '-', desc: 'Master lencana pencapaian santri' },
      { name: 'student_badges', pk: 'id', fk: 'student_id, badge_id', desc: 'Lencana yang diperoleh santri' },
      { name: 'notifications', pk: 'id', fk: 'recipient_profile_id', desc: 'Notifikasi in-app real-time' },
      { name: 'notification_preferences', pk: 'id', fk: 'profile_id', desc: 'Preferensi notifikasi & persetujuan WhatsApp' },
      { name: 'audit_logs', pk: 'id', fk: 'actor_profile_id', desc: 'Catatan perubahan nilai, relasi & keamanan' },
    ],
  },
];

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  section,
  students,
  geminiConfigured,
  whatsappConfigured,
  whatsappProvider,
  systemSettings,
  onRefreshAll,
  onOpenApplications,
}) => {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forms
  const [newStudent, setNewStudent] = useState({ full_name: '', student_number: '', class_id: '', email: '' });
  const [newTeacher, setNewTeacher] = useState({ full_name: '', email: '', employee_number: '', specialization: '', class_id: '', halaqah_name: '' });
  const [newGuardian, setNewGuardian] = useState({ full_name: '', email: '', phone: '', relationship: 'Orang Tua' });
  const [newClass, setNewClass] = useState({ class_name: '', level: 'Reguler', description: '' });
  const [assignForm, setAssignForm] = useState({ teacher_id: '', class_id: '' });

  // Invite code generator
  const [inviteStudentId, setInviteStudentId] = useState('');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Settings
  const [thresholdInput, setThresholdInput] = useState(systemSettings.passing_threshold || '80');
  const [leaderboardVis, setLeaderboardVis] = useState(systemSettings.leaderboard_visible === 'true');
  const [waTemplate, setWaTemplate] = useState(systemSettings.whatsapp_template || '');
  const [newTag, setNewTag] = useState({ tag_name: '', category: 'Tajwid' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, tagsRes] = await Promise.all([
        apiFetch<AdminOverviewResponse>('/api/admin/overview'),
        apiFetch<{ errorTags: ErrorTag[] }>('/api/error-tags'),
      ]);
      setOverview(ov);
      setErrorTags(tagsRes.errorTags);
      if (!inviteStudentId && students[0]) setInviteStudentId(students[0].id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat konsol admin.');
    } finally {
      setLoading(false);
    }
  }, [inviteStudentId, students]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const notifyAction = async (fn: () => Promise<void>, msg: string) => {
    setFeedback(null);
    setErrorMsg(null);
    try {
      await fn();
      setFeedback(msg);
      await loadData();
      onRefreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Operasi gagal.');
    }
  };

  if (loading && !overview) {
    return <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }
  if (!overview) return null;

  return (
    <div className="space-y-6">
      {feedback && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {/* SECTION: OVERVIEW */}
      {section === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricBox label="Total Santri" value={overview.counts.students} />
            <MetricBox label="Total Ustadz" value={overview.counts.teachers} />
            <MetricBox label="Total Wali" value={overview.counts.guardians} />
            <MetricBox label="Total Kelas" value={overview.counts.classes} />
            <MetricBox label="Setoran Hari Ini" value={overview.counts.sessionsToday} />
            <MetricBox label="Total Setoran Resmi" value={overview.counts.totalOfficialSessions} />
          </div>

          {typeof overview.counts.pendingApplications === 'number' && overview.counts.pendingApplications > 0 && onOpenApplications && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-amber-950">
                <p className="font-bold text-sm">
                  {overview.counts.pendingApplications} Permohonan Akun Baru Menunggu Verifikasi
                </p>
                <p className="mt-0.5 text-amber-900">
                  Tinjau pengajuan akun Santri, Wali Santri, atau Ustadz pada menu Manajemen Permohonan Akun.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenApplications}
                className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap"
              >
                Tinjau Permohonan Akun
              </button>
            </div>
          )}

          {/* Status Integrasi Sistem */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-base font-semibold text-slate-900 mb-3">
              Status Integrasi &amp; Infrastruktur Sistem
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="rounded-lg border border-slate-200 p-4 space-y-1">
                <span className="font-semibold text-slate-900">AI Engine (Gemini Server-Side)</span>
                <p className={geminiConfigured ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                  {geminiConfigured ? 'Terhubung (gemini-4-hydrogen)' : 'Belum Dikonfigurasi (Fallback Statistik Aktif)'}
                </p>
                <p className="text-slate-500">
                  Konfigurasikan GEMINI_API_KEY melalui secret server untuk analisis AI generatif penuh.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4 space-y-1">
                <span className="font-semibold text-slate-900">WhatsApp Gateway</span>
                <p className={whatsappConfigured ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                  {whatsappConfigured ? `Terhubung (${whatsappProvider})` : 'Belum Dikonfigurasi'}
                </p>
                <p className="text-slate-500">
                  Isi WHATSAPP_GATEWAY_PROVIDER, API_URL, dan TOKEN di environment server. Pengiriman tetap menunggu izin wali.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4 space-y-1">
                <span className="font-semibold text-slate-900">Database &amp; Real-Time</span>
                <p className="text-emerald-700 font-semibold">Aktif (SQLite Relasional + WebSocket + Skema PostgreSQL RLS)</p>
                <p className="text-slate-500">
                  Migrasi produksi Supabase tersedia di /supabase/migrations/001_etahfidz_schema.sql.
                </p>
              </div>
            </div>
          </div>

          {/* Audit Log Terbaru */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Riwayat Aktivitas &amp; Audit Perubahan Nilai
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Waktu (WIB)</th>
                    <th className="py-2.5 px-4 font-semibold">Pengguna</th>
                    <th className="py-2.5 px-4 font-semibold">Aksi</th>
                    <th className="py-2.5 px-4 font-semibold">Detail Perubahan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.recentAuditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 whitespace-nowrap text-slate-500">
                        {formatTanggalWaktuWIB(log.created_at)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {log.actor_name} ({log.actor_role})
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">{log.action}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 max-w-md truncate">
                        {log.old_values ? `Lama: ${log.old_values} → ` : ''}
                        {log.new_values ? `Baru: ${log.new_values}` : log.entity_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: KELOLA PENGGUNA & KELAS */}
      {section === 'users' && (
        <div className="space-y-6">
          {/* Tambah Santri & Kelas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void notifyAction(async () => {
                  await apiFetch('/api/admin/students', {
                    method: 'POST',
                    body: JSON.stringify({
                      ...newStudent,
                      create_account: Boolean(newStudent.email),
                    }),
                  });
                  setNewStudent({ full_name: '', student_number: '', class_id: '', email: '' });
                }, 'Data santri berhasil ditambahkan.');
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Tambah Santri Baru
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <input
                  required
                  placeholder="Nama Lengkap Santri"
                  value={newStudent.full_name}
                  onChange={(e) => setNewStudent({ ...newStudent, full_name: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="NIS (misal: 2026-0105)"
                  value={newStudent.student_number}
                  onChange={(e) => setNewStudent({ ...newStudent, student_number: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={newStudent.class_id}
                  onChange={(e) => setNewStudent({ ...newStudent, class_id: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">-- Pilih Kelas / Halaqah --</option>
                  {overview.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.class_name}
                    </option>
                  ))}
                </select>
                <input
                  type="email"
                  placeholder="Email Akun Santri (Opsional)"
                  value={newStudent.email}
                  onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Simpan Santri
              </button>
            </form>

            {/* Tambah Kelas & Penugasan Ustadz */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void notifyAction(async () => {
                    await apiFetch('/api/admin/classes', { method: 'POST', body: JSON.stringify(newClass) });
                    setNewClass({ class_name: '', level: 'Reguler', description: '' });
                  }, 'Kelas tahfidz baru berhasil dibuat.');
                }}
                className="space-y-3"
              >
                <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Tambah Kelas / Halaqah
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    required
                    placeholder="Nama Halaqah (misal: Halaqah Abu Bakar)"
                    value={newClass.class_name}
                    onChange={(e) => setNewClass({ ...newClass, class_name: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <select
                    value={newClass.level}
                    onChange={(e) => setNewClass({ ...newClass, level: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="Reguler">Reguler</option>
                    <option value="Menengah">Menengah</option>
                    <option value="Intensif">Intensif</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Buat Kelas
                </button>
              </form>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void notifyAction(async () => {
                    await apiFetch('/api/admin/teacher-assignments', {
                      method: 'POST',
                      body: JSON.stringify(assignForm),
                    });
                  }, 'Ustadz berhasil ditugaskan ke kelas.');
                }}
                className="pt-4 border-t border-slate-100 space-y-2"
              >
                <span className="block text-xs font-semibold text-slate-800">
                  Hubungkan Ustadz ke Kelas Binaan
                </span>
                <div className="flex flex-wrap gap-2">
                  <select
                    required
                    value={assignForm.teacher_id}
                    onChange={(e) => setAssignForm({ ...assignForm, teacher_id: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs flex-1"
                  >
                    <option value="">Pilih Ustadz...</option>
                    {overview.teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name}
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={assignForm.class_id}
                    onChange={(e) => setAssignForm({ ...assignForm, class_id: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs flex-1"
                  >
                    <option value="">Pilih Kelas...</option>
                    {overview.classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.class_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg border border-emerald-700/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900"
                  >
                    Tugaskan
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Tambah Ustadz & Wali Santri */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void notifyAction(async () => {
                  await apiFetch('/api/admin/teachers', { method: 'POST', body: JSON.stringify(newTeacher) });
                  setNewTeacher({ full_name: '', email: '', employee_number: '', specialization: '', class_id: '', halaqah_name: '' });
                }, 'Akun ustadz baru berhasil dibuat (kata sandi awal: Tahfidz2026!).');
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <h3 className="font-display text-base font-semibold text-slate-900">Tambah Akun Ustadz / Musyrif</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Nama Ustadz"
                  value={newTeacher.full_name}
                  onChange={(e) => setNewTeacher({ ...newTeacher, full_name: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  type="email"
                  placeholder="Email Login"
                  value={newTeacher.email}
                  onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="NIP Ustadz"
                  value={newTeacher.employee_number}
                  onChange={(e) => setNewTeacher({ ...newTeacher, employee_number: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  list="halaqah-diampu-options"
                  placeholder="Nama Halaqah yang Diampu"
                  aria-label="Nama Halaqah yang Diampu"
                  value={newTeacher.halaqah_name}
                  onChange={(e) => setNewTeacher({ ...newTeacher, halaqah_name: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <datalist id="halaqah-diampu-options">
                {overview.classes.map((c) => (
                  <option key={c.id} value={c.class_name} />
                ))}
              </datalist>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Buat Akun Ustadz
              </button>
            </form>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void notifyAction(async () => {
                  await apiFetch('/api/admin/guardians', { method: 'POST', body: JSON.stringify(newGuardian) });
                  setNewGuardian({ full_name: '', email: '', phone: '', relationship: 'Orang Tua' });
                }, 'Akun wali santri baru berhasil dibuat (kata sandi awal: Tahfidz2026!).');
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
            >
              <h3 className="font-display text-base font-semibold text-slate-900">Tambah Akun Wali Santri</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Nama Wali Santri"
                  value={newGuardian.full_name}
                  onChange={(e) => setNewGuardian({ ...newGuardian, full_name: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  type="email"
                  placeholder="Email Login Wali"
                  value={newGuardian.email}
                  onChange={(e) => setNewGuardian({ ...newGuardian, email: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Nomor HP / WhatsApp"
                  value={newGuardian.phone}
                  onChange={(e) => setNewGuardian({ ...newGuardian, phone: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Hubungan (Ayah / Ibu / Wali)"
                  value={newGuardian.relationship}
                  onChange={(e) => setNewGuardian({ ...newGuardian, relationship: e.target.value })}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Buat Akun Wali
              </button>
            </form>
          </div>

          {/* Tabel Ringkasan Kelas & Santri */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">Daftar Santri Terdaftar</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-semibold">NIS</th>
                    <th className="py-3 px-4 font-semibold">Nama Santri</th>
                    <th className="py-3 px-4 font-semibold">Kelas</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 px-4 font-mono">{s.student_number}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{s.full_name}</td>
                      <td className="py-2.5 px-4 text-slate-600">{s.class_name || '-'}</td>
                      <td className="py-2.5 px-4 capitalize text-slate-700">{s.enrollment_status}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Hapus data santri ${s.full_name}?`)) {
                              void notifyAction(async () => {
                                await apiFetch(`/api/admin/students/${s.id}`, { method: 'DELETE' });
                              }, `Santri ${s.full_name} dihapus.`);
                            }
                          }}
                          aria-label={`Hapus santri ${s.full_name}`}
                          className="text-red-600 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: INTEGRASI AKUN WALI & SANTRI */}
      {section === 'linking' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Buat Kode Penghubung Resmi Wali &amp; Anak
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sistem tidak pernah menghubungkan akun berdasarkan kesamaan nama. Wali harus memasukkan kode undangan yang sah.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={inviteStudentId}
                onChange={(e) => setInviteStudentId(e.target.value)}
                aria-label="Pilih santri untuk kode undangan"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm flex-1 min-w-[220px]"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.student_number})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  void notifyAction(async () => {
                    const res = await apiFetch<{ invitation_code: string }>('/api/admin/link-invites', {
                      method: 'POST',
                      body: JSON.stringify({ student_id: inviteStudentId, expires_days: 7 }),
                    });
                    setGeneratedCode(res.invitation_code);
                  }, 'Kode penghubung berhasil dibuat dan berlaku 7 hari.')
                }
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Hasilkan Kode Penghubung
              </button>
            </div>

            {generatedCode && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-emerald-800">Kode Penghubung Aktif (Berikan ke Wali Santri):</span>
                  <p className="font-mono text-lg font-bold text-emerald-950 tracking-wider mt-0.5">
                    {generatedCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(generatedCode);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1500);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/30 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Disalin' : 'Salin Kode'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Daftar Relasi Aktif Wali <-> Santri */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              Relasi Akun Wali &amp; Santri Aktif
            </h3>
            <div className="space-y-3">
              {overview.guardians.map((g) => (
                <div key={g.id} className="rounded-lg border border-slate-200 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{g.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {g.email} · {g.phone || '-'} · {g.relationship}
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    {!g.linked_students || g.linked_students.length === 0 ? (
                      <p className="text-xs text-slate-400">Belum terhubung dengan santri mana pun.</p>
                    ) : (
                      g.linked_students.map((ls) => (
                        <div key={ls.link_id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-50 px-3 py-2 rounded-md">
                          <span className="font-medium text-slate-800">
                            {ls.student_name} ({ls.student_number}) · {ls.relationship}
                          </span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(ls.audio_access_allowed)}
                                onChange={(e) =>
                                  void notifyAction(async () => {
                                    await apiFetch(`/api/admin/guardian-links/${ls.link_id}`, {
                                      method: 'PATCH',
                                      body: JSON.stringify({ audio_access_allowed: e.target.checked }),
                                    });
                                  }, 'Izin akses audio wali diperbarui.')
                                }
                              />
                              <span>Izin Audio</span>
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                void notifyAction(async () => {
                                  await apiFetch(`/api/admin/guardian-links/${ls.link_id}`, { method: 'DELETE' });
                                }, 'Hubungan akun wali dan santri diputus.')
                              }
                              className="inline-flex items-center gap-1 text-red-600 hover:underline"
                            >
                              <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Putus Relasi</span>
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Riwayat Kode Undangan */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="p-5 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">Riwayat Kode Undangan Penghubung</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Kode</th>
                    <th className="py-2.5 px-4 font-semibold">Santri</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold">Kedaluwarsa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.invites.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{inv.plain_hint}</td>
                      <td className="py-2.5 px-4">{inv.student_name}</td>
                      <td className="py-2.5 px-4 capitalize">{inv.status}</td>
                      <td className="py-2.5 px-4 text-slate-500">{formatTanggalWaktuWIB(inv.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: PENGATURAN MUSHAF, TAG KESALAHAN, BADGE & WHATSAPP */}
      {section === 'settings' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pengaturan Mushaf & Kelulusan */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Pedoman Penilaian, Mushaf &amp; Leaderboard
              </h3>
              <div className="space-y-3">
                {overview.mushafList.map((m) => (
                  <div key={m.id} className="rounded-lg border border-slate-200 p-3.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">{m.mushaf_name}</p>
                      <p className="text-slate-500">
                        {m.total_juz} Juz · {m.default_pages_per_juz} halaman/juz · Ambang {m.passing_threshold}
                      </p>
                    </div>
                    {m.is_default ? (
                      <span className="font-semibold text-emerald-700">Aktif</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void notifyAction(async () => {
                            await apiFetch(`/api/admin/mushaf-settings/${m.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ set_default: true }),
                            });
                          }, `Mushaf aktif diubah ke ${m.mushaf_name}.`)
                        }
                        className="rounded-lg border border-slate-300 px-3 py-1 font-medium hover:bg-slate-50"
                      >
                        Aktifkan
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="threshold-input" className="font-medium text-slate-700">
                    Ambang Kelulusan Juz (Default 80)
                  </label>
                  <input
                    id="threshold-input"
                    type="number"
                    min={40}
                    max={100}
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-sm"
                  />
                </div>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="font-medium text-slate-700">
                    Tampilkan Papan Apresiasi Konsistensi ke Santri &amp; Wali
                  </span>
                  <input
                    type="checkbox"
                    checked={leaderboardVis}
                    onChange={(e) => setLeaderboardVis(e.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void notifyAction(async () => {
                      const activeMushaf = overview.mushafList.find((m) => m.is_default) || overview.mushafList[0];
                      await apiFetch(`/api/admin/mushaf-settings/${activeMushaf.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ passing_threshold: Number(thresholdInput) }),
                      });
                      await apiFetch('/api/admin/system-settings', {
                        method: 'PATCH',
                        body: JSON.stringify({
                          passing_threshold: thresholdInput,
                          leaderboard_visible: leaderboardVis ? 'true' : 'false',
                          whatsapp_template: waTemplate,
                        }),
                      });
                    }, 'Pengaturan penilaian dan sistem berhasil disimpan.')
                  }
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Simpan Pengaturan
                </button>
              </div>
            </div>

            {/* Kategori Tag Kesalahan */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Manajemen Tag Kesalahan Tajwid &amp; Makhraj
              </h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void notifyAction(async () => {
                    await apiFetch('/api/admin/error-tags', { method: 'POST', body: JSON.stringify(newTag) });
                    setNewTag({ tag_name: '', category: 'Tajwid' });
                  }, 'Tag kesalahan baru ditambahkan.');
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  required
                  placeholder="Nama kesalahan baru..."
                  value={newTag.tag_name}
                  onChange={(e) => setNewTag({ ...newTag, tag_name: e.target.value })}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
                <select
                  value={newTag.category}
                  onChange={(e) => setNewTag({ ...newTag, category: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="Tajwid">Tajwid</option>
                  <option value="Makhraj & Sifat Huruf">Makhraj &amp; Sifat Huruf</option>
                  <option value="Kelancaran">Kelancaran</option>
                  <option value="Waqaf & Ibtida">Waqaf &amp; Ibtida</option>
                </select>
                <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                  Tambah
                </button>
              </form>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
                {errorTags.map((t) => (
                  <div key={t.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-800">{t.tag_name}</span>
                      <span className="text-slate-400"> · {t.category}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void notifyAction(async () => {
                          await apiFetch(`/api/admin/error-tags/${t.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_active: !t.is_active }),
                          });
                        }, 'Status tag kesalahan diperbarui.')
                      }
                      className={`font-semibold ${t.is_active ? 'text-emerald-700' : 'text-slate-400'}`}
                    >
                      {t.is_active ? 'Aktif' : 'Nonaktif'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* WhatsApp Gateway Template & Delivery Logs */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Struktur Integrasi WhatsApp Gateway &amp; Log Pengiriman
                </h3>
                <p className="text-xs text-slate-500">
                  Status saat ini: <strong>{whatsappConfigured ? `Aktif (${whatsappProvider})` : 'Belum Dikonfigurasi pada Env Server'}</strong>. Pesan hanya dikirim jika wali menyetujui.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Templat Pesan Notifikasi Wali
              </label>
              <textarea
                rows={2}
                value={waTemplate}
                onChange={(e) => setWaTemplate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>

            {overview.whatsappLogs.length > 0 && (
              <div className="overflow-x-auto border-t border-slate-100 pt-3">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Waktu</th>
                      <th className="py-2 px-3">Penerima</th>
                      <th className="py-2 px-3">Nomor</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview.whatsappLogs.map((wl) => (
                      <tr key={wl.id}>
                        <td className="py-2 px-3 whitespace-nowrap">{formatTanggalWaktuWIB(wl.created_at)}</td>
                        <td className="py-2 px-3 font-medium">{wl.recipient_name}</td>
                        <td className="py-2 px-3 font-mono">{wl.phone_number}</td>
                        <td className="py-2 px-3 font-mono">{wl.status}</td>
                        <td className="py-2 px-3 text-slate-500">{wl.error_detail || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION: ERD VISUAL 23 TABEL & PANDUAN DEPLOYMENT */}
      {section === 'erd' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              Entity Relationship Diagram (ERD) — 23 Tabel Inti E-Tahfidz
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Seluruh relasi foreign key aktif di SQLite lokal dan siap dimigrasikan ke PostgreSQL / Supabase RLS melalui file <span className="font-mono">/supabase/migrations/001_etahfidz_schema.sql</span>.
            </p>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              {ERD_GROUPS.map((grp) => (
                <div key={grp.title} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <h4 className="font-display text-sm font-bold text-slate-900">{grp.title}</h4>
                  <div className="space-y-2">
                    {grp.tables.map((t) => (
                      <div key={t.name} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-bold text-emerald-800">{t.name}</span>
                          <span className="font-mono text-[11px] text-slate-500">PK: {t.pk}</span>
                        </div>
                        <p className="mt-1 text-slate-600">{t.desc}</p>
                        {t.fk !== '-' && (
                          <p className="mt-1 font-mono text-[11px] text-slate-500">FK → {t.fk}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricBox: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <span className="block text-xs text-slate-500">{label}</span>
    <span className="mt-1 block font-mono text-2xl font-bold text-slate-900">{value}</span>
  </div>
);
