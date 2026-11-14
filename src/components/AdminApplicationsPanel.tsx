import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Mail,
  ShieldCheck,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatTanggalWaktuWIB } from '../lib/formatters';
import type {
  AccountStatus,
  EmailNotificationRecord,
  PendingApplicationRecord,
  StudentRecord,
} from '../types/tahfidz';

interface AdminApplicationsResponse {
  applications: PendingApplicationRecord[];
  counts: {
    pending: number;
    needs_revision: number;
    approved: number;
    rejected: number;
    suspended: number;
    total: number;
  };
  emailLogs: EmailNotificationRecord[];
  classes: { id: string; class_name: string; level: string }[];
  supabaseStatus: {
    configured: boolean;
    adminConfigured: boolean;
    urlConfigured: boolean;
  };
}

interface AdminApplicationsPanelProps {
  students: StudentRecord[];
  onRefreshAll: () => void;
}

const ROLE_TEXT: Record<string, string> = {
  santri: 'Santri',
  wali_santri: 'Wali Santri',
  ustadz: 'Ustadz / Musyrif',
};

const STATUS_BADGES: Record<AccountStatus, { label: string; cls: string }> = {
  pending: { label: 'Menunggu Verifikasi', cls: 'text-amber-800 bg-amber-50 border-amber-200' },
  needs_revision: { label: 'Perlu Perbaikan', cls: 'text-sky-800 bg-sky-50 border-sky-200' },
  approved: { label: 'Disetujui (Aktif)', cls: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
  rejected: { label: 'Ditolak', cls: 'text-red-800 bg-red-50 border-red-200' },
  suspended: { label: 'Dinonaktifkan', cls: 'text-slate-700 bg-slate-100 border-slate-300' },
};

export const AdminApplicationsPanel: React.FC<AdminApplicationsPanelProps> = ({
  students,
  onRefreshAll,
}) => {
  const [data, setData] = useState<AdminApplicationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | AccountStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal state for Approve / Reject / Request Revision
  const [approveTarget, setApproveTarget] = useState<PendingApplicationRecord | null>(null);
  const [approveClassId, setApproveClassId] = useState('');
  const [approveStudentIds, setApproveStudentIds] = useState<string[]>([]);
  const [approveNotes, setApproveNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [noteModal, setNoteModal] = useState<{
    app: PendingApplicationRecord;
    mode: 'reject' | 'revision';
  } | null>(null);
  const [noteInput, setNoteInput] = useState('');

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminApplicationsResponse>('/api/admin/applications');
      setData(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat daftar permohonan akun.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const filteredApps = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();
    return data.applications.filter((app) => {
      if (filterStatus !== 'all' && app.status !== filterStatus) return false;
      if (!q) return true;
      return (
        app.full_name.toLowerCase().includes(q) ||
        app.email.toLowerCase().includes(q) ||
        (app.identity_number || '').toLowerCase().includes(q) ||
        (app.halaqah_name || '').toLowerCase().includes(q) ||
        (app.phone || '').toLowerCase().includes(q)
      );
    });
  }, [data, filterStatus, searchQuery]);

  const openApproveModal = (app: PendingApplicationRecord) => {
    setApproveTarget(app);
    const matchedClass = data?.classes.find(
      (c) => c.class_name.trim().toLowerCase() === (app.halaqah_name || '').trim().toLowerCase()
    );
    setApproveClassId(matchedClass?.id || '');
    setApproveStudentIds([]);
    setApproveNotes('');
  };

  const handleConfirmApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    setActionBusy(true);
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/api/admin/applications/${approveTarget.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            class_id: approveClassId || undefined,
            student_ids: approveStudentIds,
            admin_notes: approveNotes || undefined,
          }),
        }
      );
      setFeedback(res.message);
      setApproveTarget(null);
      await loadApplications();
      onRefreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyetujui permohonan akun.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmNoteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteModal) return;
    setActionBusy(true);
    setFeedback(null);
    setErrorMsg(null);
    const endpoint =
      noteModal.mode === 'reject'
        ? `/api/admin/applications/${noteModal.app.id}/reject`
        : `/api/admin/applications/${noteModal.app.id}/request-revision`;
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ admin_notes: noteInput }),
      });
      setFeedback(res.message);
      setNoteModal(null);
      setNoteInput('');
      await loadApplications();
      onRefreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses permohonan.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleAccountStatus = async (app: PendingApplicationRecord) => {
    if (!app.profile_id) return;
    const nextStatus = app.status === 'suspended' ? 'approved' : 'suspended';
    setFeedback(null);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/admin/profiles/${app.profile_id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      setFeedback(
        nextStatus === 'suspended'
          ? `Akun ${app.full_name} dinonaktifkan.`
          : `Akun ${app.full_name} diaktifkan kembali.`
      );
      await loadApplications();
      onRefreshAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengubah status akun.');
    }
  };

  if (loading && !data) {
    return <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }
  if (!data) return null;

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

      {/* Ringkasan KPI Permohonan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Menunggu Verifikasi</span>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-700">{data.counts.pending}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Perlu Perbaikan</span>
          <p className="mt-1 font-mono text-2xl font-bold text-sky-700">{data.counts.needs_revision}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Akun Disetujui</span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-800">{data.counts.approved}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Ditolak / Nonaktif</span>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-700">
            {data.counts.rejected + data.counts.suspended}
          </p>
        </div>
      </div>

      {/* Status Keamanan & Supabase Auth */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-700">
          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>
            <strong>Keamanan Password:</strong> Password tidak pernah disimpan di tabel{' '}
            <span className="font-mono">pending_applications</span> dan tidak pernah ditampilkan kepada administrator.
          </span>
        </div>
        <span className={data.supabaseStatus.configured ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
          {data.supabaseStatus.configured
            ? 'Supabase Auth: Terhubung'
            : 'Supabase Auth: Belum Dikonfigurasi (Mode Auth Lokal Terenkripsi Aktif)'}
        </span>
      </div>

      {/* Tabel Manajemen Permohonan Akun */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              Manajemen Permohonan Akun
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Verifikasi pengajuan akun Santri, Wali Santri, dan Ustadz sebelum memberikan akses dashboard.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'pending', label: 'Pending' },
                  { id: 'needs_revision', label: 'Perbaikan' },
                  { id: 'approved', label: 'Disetujui' },
                  { id: 'rejected', label: 'Ditolak' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterStatus(tab.id)}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                    filterStatus === tab.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, email, NIS/NIP..."
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-52"
            />
          </div>
        </div>

        {filteredApps.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada permohonan akun pada filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 font-semibold">Pemohon &amp; Jenis Akun</th>
                  <th className="py-3 px-4 font-semibold">NIS / NIP &amp; Halaqah</th>
                  <th className="py-3 px-4 font-semibold">Email &amp; Nomor HP</th>
                  <th className="py-3 px-4 font-semibold">Tgl Pendaftaran</th>
                  <th className="py-3 px-4 font-semibold">Status Verifikasi</th>
                  <th className="py-3 px-4 font-semibold text-right">Tindakan Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApps.map((app) => {
                  const badge = STATUS_BADGES[app.status] || STATUS_BADGES.pending;
                  return (
                    <tr key={app.id} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900 text-sm">{app.full_name}</p>
                        <p className="text-slate-600 mt-0.5">
                          {ROLE_TEXT[app.requested_role] || app.requested_role}
                        </p>
                      </td>
                      <td className="py-3 px-4 space-y-0.5">
                        <p className="font-mono text-slate-800">{app.identity_number || '-'}</p>
                        <p className="text-slate-500">{app.halaqah_name || '-'}</p>
                      </td>
                      <td className="py-3 px-4 space-y-0.5">
                        <p className="font-mono text-slate-800">{app.email}</p>
                        <p className="font-mono text-slate-500">{app.phone || '-'}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {formatTanggalWaktuWIB(app.submitted_at)}
                      </td>
                      <td className="py-3 px-4 space-y-1">
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {app.admin_notes && (
                          <p className="text-[11px] text-slate-500 max-w-xs">
                            Catatan: {app.admin_notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {(app.status === 'pending' || app.status === 'needs_revision' || app.status === 'rejected') && (
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openApproveModal(app)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800"
                            >
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Setujui</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteModal({ app, mode: 'revision' });
                                setNoteInput(app.admin_notes || '');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-900 hover:bg-sky-100"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Minta Perbaikan</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteModal({ app, mode: 'reject' });
                                setNoteInput(app.admin_notes || '');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-800 hover:bg-red-100"
                            >
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Tolak</span>
                            </button>
                          </div>
                        )}
                        {(app.status === 'approved' || app.status === 'suspended') && app.profile_id && (
                          <button
                            type="button"
                            onClick={() => void handleToggleAccountStatus(app)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                              app.status === 'suspended'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{app.status === 'suspended' ? 'Aktifkan Kembali' : 'Nonaktifkan'}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Email Pemberitahuan Persetujuan / Penolakan */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            Riwayat Email Pemberitahuan Akun (Tanpa Password)
          </h3>
        </div>
        {data.emailLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Belum ada email pemberitahuan yang dikirim.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.emailLogs.map((log) => (
              <div key={log.id} className="p-4 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {log.subject} → {log.recipient_name} ({log.recipient_email})
                  </span>
                  <span className="font-mono text-slate-500">
                    {formatTanggalWaktuWIB(log.created_at)} · {log.status}
                  </span>
                </div>
                <p className="text-slate-600 whitespace-pre-line">{log.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Persetujuan Akun */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmApprove}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center gap-2 text-slate-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <h3 className="font-display text-lg font-bold">Setujui &amp; Aktifkan Akun</h3>
            </div>
            <p className="text-xs text-slate-600">
              Pemohon: <strong>{approveTarget.full_name}</strong> ({ROLE_TEXT[approveTarget.requested_role]}) ·{' '}
              <span className="font-mono">{approveTarget.email}</span>
            </p>

            {(approveTarget.requested_role === 'santri' || approveTarget.requested_role === 'ustadz') && (
              <div>
                <label htmlFor="approve-class-select" className="block text-xs font-semibold text-slate-700 mb-1">
                  Hubungkan ke Kelas / Halaqah
                </label>
                <select
                  id="approve-class-select"
                  value={approveClassId}
                  onChange={(e) => setApproveClassId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">
                    Otomatis sesuai pengajuan ({approveTarget.halaqah_name || 'Buat / cocokkan halaqah'})
                  </option>
                  {data.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.class_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {approveTarget.requested_role === 'wali_santri' && (
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Hubungkan dengan Profil Santri (Anak)
                </span>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {students.map((stu) => {
                    const checked = approveStudentIds.includes(stu.id);
                    return (
                      <label key={stu.id} className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setApproveStudentIds([...approveStudentIds, stu.id]);
                            } else {
                              setApproveStudentIds(approveStudentIds.filter((id) => id !== stu.id));
                            }
                          }}
                        />
                        <span className="font-medium text-slate-900">{stu.full_name}</span>
                        <span className="text-slate-500 font-mono">
                          ({stu.student_number} · {stu.class_name || '-'})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="approve-notes" className="block text-xs font-semibold text-slate-700 mb-1">
                Catatan Persetujuan (Opsional)
              </label>
              <textarea
                id="approve-notes"
                rows={2}
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="Misal: Selamat bergabung di Halaqah Al-Fatih..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {actionBusy ? 'Memproses...' : 'Konfirmasi & Setujui Akun'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Tolak / Minta Perbaikan */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmNoteAction}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center gap-2 text-slate-900">
              <Clock className="w-5 h-5 text-amber-600" aria-hidden="true" />
              <h3 className="font-display text-lg font-bold">
                {noteModal.mode === 'reject' ? 'Tolak Permohonan Akun' : 'Minta Perbaikan Data'}
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Pemohon: <strong>{noteModal.app.full_name}</strong> ({noteModal.app.email})
            </p>
            <div>
              <label htmlFor="admin-note-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                {noteModal.mode === 'reject' ? 'Alasan Penolakan *' : 'Instruksi Perbaikan Data *'}
              </label>
              <textarea
                id="admin-note-reason"
                required
                rows={3}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder={
                  noteModal.mode === 'reject'
                    ? 'Jelaskan alasan penolakan agar pemohon dapat menindaklanjuti...'
                    : 'Tuliskan bagian data yang perlu diperbaiki (misal: perbaiki NIS atau nama halaqah)...'
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNoteModal(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 ${
                  noteModal.mode === 'reject' ? 'bg-red-700 hover:bg-red-800' : 'bg-sky-700 hover:bg-sky-800'
                }`}
              >
                {actionBusy
                  ? 'Menyimpan...'
                  : noteModal.mode === 'reject'
                    ? 'Tolak Permohonan'
                    : 'Kirim Permintaan Perbaikan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
