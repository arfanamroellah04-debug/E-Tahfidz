import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { exportStudentReportExcel, exportStudentReportPDF } from '../lib/export-utils';
import {
  formatNilaiID,
  formatSessionTypeLabel,
  formatTanggalID,
  formatTanggalWaktuWIB,
  labelEligibility,
  labelJuzStatus,
} from '../lib/formatters';
import { ChartsPanel } from './ChartsPanel';
import type {
  AIAnalysisRecord,
  AudioAttachmentRecord,
  BadgeRecord,
  CompletionPrediction,
  HafalanSessionRecord,
  HafalanTargetRecord,
  JuzProgressSummary,
  MurojaahScheduleRecord,
  MushafSetting,
  RadarSkillMetrics,
  StudentRecord,
  UserRole,
} from '../types/tahfidz';

interface OverviewPayload {
  student: StudentRecord;
  mushaf: MushafSetting;
  summary: {
    completedJuzCount: number;
    totalZiyadahPages: number;
    averageScore: number | null;
    totalSessionsCount: number;
    totalMurojaahCount: number;
    activeJuz: number;
  };
  juzSummaries: JuzProgressSummary[];
  sessions: HafalanSessionRecord[];
  radar: RadarSkillMetrics;
  prediction: CompletionPrediction;
  targets: HafalanTargetRecord[];
  schedules: MurojaahScheduleRecord[];
  aiAnalyses: AIAnalysisRecord[];
  badges: BadgeRecord[];
  audioAttachments: AudioAttachmentRecord[];
}

interface StudentDetailWorkspaceProps {
  studentId: string;
  viewerRole: UserRole;
  institutionName: string;
  geminiConfigured: boolean;
  refreshTrigger: number;
}

type DetailTab = 'ringkasan' | 'grafik' | 'riwayat' | 'murojaah' | 'ai' | 'penghargaan';

export const StudentDetailWorkspace: React.FC<StudentDetailWorkspaceProps> = ({
  studentId,
  viewerRole,
  institutionName,
  geminiConfigured,
  refreshTrigger,
}) => {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('ringkasan');
  const [selectedJuzDetail, setSelectedJuzDetail] = useState<number | null>(null);

  // History filter
  const [historyFilter, setHistoryFilter] = useState<'semua' | 'ziyadah' | 'murojaah' | 'tes_tahfidz'>('semua');

  // Edit Session Modal (ONLY for Ustadz & Admin)
  const [editingSession, setEditingSession] = useState<HafalanSessionRecord | null>(null);
  const [editScores, setEditScores] = useState<Record<string, number>>({});
  const [editNotes, setEditNotes] = useState<string>('');

  // AI Trigger
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<{
    visible: boolean;
    entries: { student_id: string; full_name: string; class_name: string | null; active_days: number; total_pages: number; badge_count: number }[];
  } | null>(null);

  const canEdit = viewerRole === 'admin' || viewerRole === 'ustadz';

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<OverviewPayload>(`/api/students/${studentId}/overview`);
      setData(res);
      if (res.juzSummaries.length > 0 && selectedJuzDetail === null) {
        setSelectedJuzDetail(res.juzSummaries[res.juzSummaries.length - 1].juzNumber);
      }
      const lb = await apiFetch<{
        visible: boolean;
        entries: { student_id: string; full_name: string; class_name: string | null; active_days: number; total_pages: number; badge_count: number }[];
      }>('/api/leaderboard');
      setLeaderboard(lb);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data santri.');
    } finally {
      setLoading(false);
    }
  }, [studentId, selectedJuzDetail]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshTrigger]);

  const activeJuzObj = useMemo(() => {
    if (!data) return null;
    return (
      data.juzSummaries.find((j) => j.juzNumber === selectedJuzDetail) ||
      data.juzSummaries[data.juzSummaries.length - 1] ||
      null
    );
  }, [data, selectedJuzDetail]);

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    return data.sessions.filter((s) => {
      if (!canEdit && s.status === 'draft') return false;
      if (historyFilter !== 'semua' && s.session_type !== historyFilter) return false;
      return true;
    });
  }, [data, canEdit, historyFilter]);

  const latestSession = filteredSessions[0];
  const latestAvgScore = useMemo(() => {
    if (!latestSession || latestSession.assessments.length === 0) return null;
    const sum = latestSession.assessments.reduce((a, p) => a + p.score, 0);
    return sum / latestSession.assessments.length;
  }, [latestSession]);

  const handleTriggerAI = async (analysisType: string) => {
    if (!data) return;
    setAiLoading(true);
    setAiNotice(null);
    try {
      const res = await apiFetch<{ analysis: AIAnalysisRecord & { notice?: string } }>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ student_id: data.student.id, analysis_type: analysisType }),
      });
      if (res.analysis.notice) setAiNotice(res.analysis.notice);
      await loadOverview();
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : 'Gagal menjalankan analisis AI.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveSessionEdit = async () => {
    if (!editingSession) return;
    const updates = editingSession.assessments.map((a) => ({
      id: a.id,
      score: editScores[a.id] ?? a.score,
    }));
    await apiFetch(`/api/sessions/${editingSession.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: editingSession.status === 'draft' ? 'published' : 'corrected',
        notes: editNotes,
        updates,
      }),
    });
    setEditingSession(null);
    await loadOverview();
  };

  const handleScheduleStatus = async (scheduleId: string, status: string) => {
    await apiFetch(`/api/murojaah-schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadOverview();
  };

  const handleDeleteAudio = async (audioId: string) => {
    await apiFetch(`/api/audio/${audioId}`, { method: 'DELETE' });
    await loadOverview();
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-slate-200 bg-white animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {error || 'Data santri tidak tersedia.'}
      </div>
    );
  }

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'ringkasan', label: 'Progres & Nilai Juz' },
    { id: 'grafik', label: 'Grafik Perkembangan' },
    { id: 'riwayat', label: 'Riwayat & Audio' },
    { id: 'murojaah', label: 'Jadwal Murojaah' },
    { id: 'ai', label: 'Analisis AI' },
    { id: 'penghargaan', label: 'Lencana & Ekspor' },
  ];

  return (
    <div className="space-y-6">
      {/* Header Identitas Santri + Tombol Ekspor */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500">
            NIS {data.student.student_number} · {data.student.class_name || 'Tanpa Kelas'} · Status {data.student.enrollment_status}
          </p>
          <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
            {data.student.full_name}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportStudentReportPDF({
                institutionName,
                student: data.student,
                periodLabel: 'Seluruh Periode Aktif',
                teacherName: data.sessions[0]?.teacher_name || 'Ustadz Pembimbing',
                summary: data.summary,
                juzSummaries: data.juzSummaries,
                sessions: filteredSessions,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
            <span>Ekspor PDF</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportStudentReportExcel({
                institutionName,
                student: data.student,
                periodLabel: 'Seluruh Periode Aktif',
                teacherName: data.sessions[0]?.teacher_name || 'Ustadz Pembimbing',
                summary: data.summary,
                juzSummaries: data.juzSummaries,
                sessions: filteredSessions,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
            <span>Ekspor Excel</span>
          </button>
        </div>
      </div>

      {/* Kartu Statistik Utama (5 KPI sejajar penuh) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total Juz Selesai" value={`${data.summary.completedJuzCount} Juz`} sub={`Dari ${data.mushaf.total_juz} juz`} />
        <StatCard label="Total Halaman Ziyadah" value={`${data.summary.totalZiyadahPages}`} sub="Halaman resmi dinilai" />
        <StatCard
          label="Nilai Setoran Terakhir"
          value={latestAvgScore !== null ? formatNilaiID(latestAvgScore) : '-'}
          sub={latestSession ? `Juz ${latestSession.juz_number} · ${formatTanggalID(latestSession.session_date)}` : 'Belum ada setoran'}
        />
        <StatCard
          label="Rata-Rata Nilai"
          value={data.summary.averageScore !== null ? `${formatNilaiID(data.summary.averageScore)} / 5` : '-'}
          sub="Ziyadah resmi"
        />
        <StatCard
          label="Aktivitas Tercatat"
          value={`${data.summary.totalSessionsCount} Sesi`}
          sub={`${data.summary.totalMurojaahCount} sesi murojaah`}
        />
      </div>

      {/* Tab Navigasi Sub-Halaman */}
      <div className="flex items-center gap-1 overflow-x-auto p-1 bg-slate-100 rounded-xl border border-slate-200/70">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: RINGKASAN & PROGRES PER JUZ / PER HALAMAN */}
      {tab === 'ringkasan' && (
        <div className="space-y-6">
          {/* Target Hafalan Aktif */}
          {data.targets.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Target Hafalan Santri
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {data.targets.slice(0, 3).map((tgt) => (
                  <div key={tgt.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="capitalize font-medium text-slate-700">Target {tgt.target_type}</span>
                      <span>{formatTanggalID(tgt.target_date)}</span>
                    </div>
                    <p className="mt-1 font-mono text-base font-bold text-slate-900">
                      {tgt.target_pages} Halaman
                    </p>
                    <p className="mt-1 text-xs font-medium text-emerald-800 capitalize">
                      Status: {tgt.status.replace('_', ' ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daftar Juz yang Sudah Memiliki Aktivitas */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Perkembangan &amp; Nilai Per Juz
                </h3>
                <p className="text-xs text-slate-500">
                  Ambang kelayakan: {data.mushaf.passing_threshold} / {data.mushaf.default_pages_per_juz * 5} · Status penyelesaian dipisahkan dari kelayakan nilai
                </p>
              </div>
            </div>

            {data.juzSummaries.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                Belum ada setoran ziyadah resmi yang tercatat untuk santri ini.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.juzSummaries.map((j) => {
                  const pct = Math.round((j.assessedPagesCount / j.pagesPerJuz) * 100);
                  const active = activeJuzObj?.juzNumber === j.juzNumber;
                  return (
                    <button
                      key={j.juzNumber}
                      type="button"
                      onClick={() => setSelectedJuzDetail(j.juzNumber)}
                      className={`text-left rounded-xl border p-4 transition-colors ${
                        active
                          ? 'border-emerald-600 bg-emerald-50/40'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display text-base font-bold text-slate-900">
                          Juz {j.juzNumber}
                        </span>
                        <span className="font-mono text-sm font-bold text-emerald-800">
                          {formatNilaiID(j.totalScore)} / {j.isComplete ? j.maxPossibleFull : j.maxPossibleCurrent}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {j.assessedPagesCount} dari {j.pagesPerJuz} halaman dinilai · {labelJuzStatus(j.juzStatus)}
                      </p>
                      <div className="mt-2.5 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Kelayakan: <strong className="text-slate-700">{labelEligibility(j.eligibilityStatus)}</strong>
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tabel Nilai Per Halaman (1..20) untuk Juz Terpilih */}
          {activeJuzObj && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Rincian Nilai Halaman Juz {activeJuzObj.juzNumber} (1–{activeJuzObj.pagesPerJuz})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Menampilkan nilai resmi terbaru per halaman · Halaman yang belum disetor tidak bernilai 0
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-slate-900">
                  Total: {formatNilaiID(activeJuzObj.totalScore)} poin ({activeJuzObj.assessedPagesCount}/{activeJuzObj.pagesPerJuz} hal.)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Halaman</th>
                      <th className="py-3 px-4 font-semibold">Nilai Resmi</th>
                      <th className="py-3 px-4 font-semibold">Percobaan</th>
                      <th className="py-3 px-4 font-semibold">Kesalahan Tajwid/Makhraj</th>
                      <th className="py-3 px-4 font-semibold">Catatan Ustadz</th>
                      <th className="py-3 px-4 font-semibold">Tanggal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from({ length: activeJuzObj.pagesPerJuz }, (_, idx) => {
                      const p = idx + 1;
                      const rec = activeJuzObj.activePages[p];
                      return (
                        <tr key={p} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                            Hal. {p}
                          </td>
                          <td className="py-2.5 px-4 font-mono">
                            {rec ? (
                              <span className={rec.score < 4 ? 'font-bold text-amber-700' : 'font-bold text-emerald-800'}>
                                {formatNilaiID(rec.score)} / 5
                              </span>
                            ) : (
                              <span className="text-slate-400">Belum disetor</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600">
                            {rec ? `Ke-${rec.attempt_number}` : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">
                            {rec && rec.errors && rec.errors.length > 0
                              ? rec.errors.map((e) => e.tag_name).join(' · ')
                              : rec
                                ? '-'
                                : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate">
                            {rec?.notes || '-'}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                            {rec ? formatTanggalID(rec.session_date) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: GRAFIK PERKEMBANGAN */}
      {tab === 'grafik' && (
        <ChartsPanel
          sessions={data.sessions}
          juzSummaries={data.juzSummaries}
          radar={data.radar}
          passingThreshold={data.mushaf.passing_threshold}
          pagesPerJuz={data.mushaf.default_pages_per_juz}
        />
      )}

      {/* TAB 3: RIWAYAT SETORAN ZIYADAH & MUROJAAH + AUDIO PRIVAT */}
      {tab === 'riwayat' && (
        <div className="space-y-6">
          {/* Audio Setoran */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2 mb-3">
              <Volume2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
              Dokumentasi Audio Setoran (Akses Terotorisasi)
            </h3>
            {data.audioAttachments.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada rekaman audio untuk santri ini.</p>
            ) : (
              <div className="space-y-3">
                {data.audioAttachments.map((aud) => (
                  <div
                    key={aud.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5"
                  >
                    <div className="text-xs space-y-0.5">
                      <p className="font-semibold text-slate-900">
                        {formatSessionTypeLabel(aud)} · Juz {aud.juz_number}
                        {aud.page_in_juz ? ` · Hal. ${aud.page_in_juz}` : ''}
                      </p>
                      <p className="text-slate-500">
                        {formatTanggalID(aud.session_date)} · Penguji: {aud.uploader_name} · Durasi {aud.duration_seconds} detik
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {aud.can_listen && aud.signed_url ? (
                        <audio controls src={aud.signed_url} className="h-9 max-w-[260px]" />
                      ) : (
                        <span className="text-xs text-amber-800">
                          Akses audio belum diizinkan untuk akun wali ini.
                        </span>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteAudio(aud.id)}
                          aria-label="Hapus rekaman audio"
                          className="text-xs text-red-600 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Daftar Riwayat Setoran */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Riwayat Laporan Setoran
              </h3>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['semua', 'ziyadah', 'murojaah', 'tes_tahfidz'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                      historyFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {f === 'semua'
                      ? 'Semua'
                      : f === 'ziyadah'
                        ? 'Ziyadah'
                        : f === 'murojaah'
                          ? 'Murojaah'
                          : 'Tes Tahfidz'}
                  </button>
                ))}
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">Belum ada riwayat setoran.</p>
            ) : (
              <div className="space-y-3">
                {filteredSessions.map((ses) => {
                  const avg =
                    ses.assessments.length > 0
                      ? ses.assessments.reduce((s, a) => s + a.score, 0) / ses.assessments.length
                      : 0;
                  return (
                    <div key={ses.id} className="rounded-lg border border-slate-200 p-4 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-900">
                              {formatSessionTypeLabel(ses)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Juz {ses.juz_number}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTanggalID(ses.session_date)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ses.teacher_name}</span>
                            {ses.status === 'draft' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-amber-700 font-semibold">Draft</span>
                              </>
                            )}
                          </div>
                          {ses.notes && (
                            <p className="mt-1 text-sm text-slate-700">{ses.notes}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-bold text-emerald-800">
                            Rata-rata {formatNilaiID(avg)}
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSession(ses);
                                setEditNotes(ses.notes || '');
                                const map: Record<string, number> = {};
                                ses.assessments.forEach((a) => {
                                  map[a.id] = a.score;
                                });
                                setEditScores(map);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{ses.status === 'draft' ? 'Edit / Publikasi' : 'Revisi Nilai'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-slate-100">
                        {ses.assessments.map((a) => (
                          <div key={a.id} className="text-xs bg-slate-50 rounded-md px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-semibold text-slate-800">
                                Hal. {a.page_in_juz} (ke-{a.attempt_number})
                              </span>
                              <span className="font-mono font-bold text-slate-900">
                                {formatNilaiID(a.score)} / 5
                              </span>
                            </div>
                            {a.errors && a.errors.length > 0 && (
                              <p className="text-[11px] text-amber-800 mt-1">
                                Tag: {a.errors.map((e) => e.tag_name).join(', ')}
                              </p>
                            )}
                            {a.notes && <p className="text-[11px] text-slate-500 mt-0.5">{a.notes}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SMART MUROJAAH SCHEDULER */}
      {tab === 'murojaah' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Smart Murojaah Scheduler (Spaced Repetition)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Halaman bernilai rendah atau memiliki tag kesalahan otomatis dijadwalkan lebih rapat
              </p>
            </div>
          </div>

          {data.schedules.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Belum ada jadwal murojaah terjadwal.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.schedules.map((sch) => (
                <div key={sch.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900">
                        Juz {sch.juz_number} · Hal. {sch.page_start}
                        {sch.page_end > sch.page_start ? `–${sch.page_end}` : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">{formatTanggalID(sch.scheduled_date)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold capitalize ${
                          sch.priority === 'kritis' || sch.priority === 'tinggi'
                            ? 'text-red-700'
                            : sch.priority === 'sedang'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        Prioritas {sch.priority}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600 capitalize">Status: {sch.status}</span>
                    </div>
                    {sch.reason && <p className="text-xs text-slate-500">{sch.reason}</p>}
                  </div>

                  {canEdit && sch.status !== 'selesai' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleScheduleStatus(sch.id, 'selesai')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Tandai Selesai</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ANALISIS AI */}
      {tab === 'ai' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Analisis Perkembangan Hafalan Berbasis AI
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  AI hanya membaca data penilaian resmi di database, tidak mengarang nilai, dan tidak dapat mengubah nilai ustadz.
                  {!geminiConfigured && ' (Status: GEMINI_API_KEY belum dikonfigurasi — menggunakan mesin statistik deterministik).'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                'Analisis Perkembangan',
                'Analisis Kesalahan',
                'Rekomendasi Murojaah',
                'Laporan Mingguan',
                'Laporan Bulanan',
              ].map((btnLabel) => (
                <button
                  key={btnLabel}
                  type="button"
                  disabled={aiLoading}
                  onClick={() => void handleTriggerAI(btnLabel)}
                  className="rounded-lg border border-emerald-700/30 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60 transition-colors"
                >
                  {aiLoading ? 'Menganalisis...' : btnLabel}
                </button>
              ))}
            </div>

            {aiNotice && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                {aiNotice}
              </div>
            )}

            {/* Estimasi Prediksi Perkembangan */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Estimasi Penyelesaian Juz {data.prediction.targetJuz}
              </div>
              {data.prediction.insufficientData ? (
                <p className="text-xs text-slate-600">{data.prediction.reason}</p>
              ) : (
                <div className="text-xs text-slate-700 space-y-1">
                  <p>
                    Berdasarkan kecepatan riil{' '}
                    <strong className="font-mono">{formatNilaiID(data.prediction.pagesPerActiveDay)} halaman/hari aktif</strong>{' '}
                    pada periode observasi {formatTanggalID(data.prediction.periodStart)} s.d. {formatTanggalID(data.prediction.periodEnd)}{' '}
                    ({data.prediction.activeDaysObserved} hari aktif), sisa {data.prediction.remainingPages} halaman diperkirakan selesai dalam{' '}
                    <strong className="font-mono">~{data.prediction.estimatedDays} hari</strong>{' '}
                    ({formatTanggalID(data.prediction.estimatedDateStart)} – {formatTanggalID(data.prediction.estimatedDateEnd)}).
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Tingkat keyakinan: <strong className="capitalize">{data.prediction.confidenceLevel}</strong>
                  </p>
                </div>
              )}
            </div>
          </div>

          {data.aiAnalyses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Klik salah satu tombol analisis di atas untuk menghasilkan ringkasan perkembangan terbaru dari data santri.
            </div>
          ) : (
            <div className="space-y-4">
              {data.aiAnalyses.map((ana) => (
                <article key={ana.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-b border-slate-100 pb-2.5">
                    <span className="font-semibold text-slate-900">{ana.analysis_type}</span>
                    <span>
                      Periode {formatTanggalID(ana.period_start)} – {formatTanggalID(ana.period_end)} · Dibuat {formatTanggalWaktuWIB(ana.created_at)} · Model: {ana.model_name}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-relaxed">
                    <div>
                      <h4 className="font-semibold text-slate-900 mb-1">Analisis Kelancaran</h4>
                      <p className="text-slate-700">{ana.insights.kelancaran}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 mb-1">Analisis Kelemahan</h4>
                      <p className="text-slate-700">{ana.insights.kelemahan}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 mb-1">Analisis Konsistensi</h4>
                      <p className="text-slate-700">{ana.insights.konsistensi}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-100">
                    <h4 className="text-xs font-semibold text-slate-900 mb-1.5">Rekomendasi Pembelajaran</h4>
                    <ul className="list-disc list-inside space-y-1 text-xs text-slate-700">
                      {ana.recommendations.map((rec, idx) => (
                        <li key={idx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: PENGHARGAAN, BADGE & LEADERBOARD OPSIONAL */}
      {tab === 'penghargaan' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Award className="w-4 h-4 text-amber-600" aria-hidden="true" />
              Lencana &amp; Pencapaian Santri ({data.badges.length})
            </h3>
            {data.badges.length === 0 ? (
              <p className="text-xs text-slate-500">Belum ada lencana diperoleh. Terus istiqomah menyetor dan murojaah!</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.badges.map((b) => (
                  <div key={b.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-700" aria-hidden="true" />
                      <span className="font-display text-sm font-bold text-slate-900">{b.badge_name}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600">{b.description}</p>
                    {b.earned_at && (
                      <p className="mt-2 text-[11px] text-slate-500">
                        Diraih pada {formatTanggalID(b.earned_at)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {leaderboard && leaderboard.visible && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-base font-semibold text-slate-900 mb-1">
                Apresiasi Konsistensi Setoran
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Menampilkan konsistensi hari aktif dan pencapaian pribadi untuk saling memotivasi (visibilitas diatur Admin).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Santri</th>
                      <th className="py-2.5 px-3 font-semibold">Kelas</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Hari Aktif</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Halaman Ziyadah</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Lencana</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaderboard.entries.map((entry) => (
                      <tr key={entry.student_id}>
                        <td className="py-2.5 px-3 font-medium text-slate-900">{entry.full_name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{entry.class_name || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{entry.active_days} hari</td>
                        <td className="py-2.5 px-3 text-right font-mono">{entry.total_pages} hal</td>
                        <td className="py-2.5 px-3 text-right font-mono">{entry.badge_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Edit Nilai Ustadz / Admin */}
      {editingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Revisi / Publikasi Setoran Juz {editingSession.juz_number}
            </h3>
            <p className="text-xs text-slate-500">
              Setiap perubahan nilai otomatis dicatat pada Audit Log beserta nilai lama, nilai baru, dan waktu perubahan.
            </p>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {editingSession.assessments.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm font-medium text-slate-800">Halaman {a.page_in_juz}</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.25}
                    value={editScores[a.id] ?? a.score}
                    onChange={(e) =>
                      setEditScores((prev) => ({ ...prev, [a.id]: Number(e.target.value) }))
                    }
                    className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-sm font-mono text-right"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Evaluasi</label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSessionEdit()}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <span className="block text-xs font-medium text-slate-500">{label}</span>
    <span className="mt-1 block font-mono text-xl font-bold text-slate-900">{value}</span>
    <span className="mt-1 block text-[11px] text-slate-500 truncate">{sub}</span>
  </div>
);
