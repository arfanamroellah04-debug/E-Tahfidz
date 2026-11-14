import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mic,
  Plus,
  Save,
  Send,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatNilaiID, todayJakartaISO } from '../lib/formatters';
import { calculateJuzProgress, validatePageScore } from '../lib/tahfidz-rules';
import type {
  ClassGroup,
  ErrorCategory,
  ErrorTag,
  ExamType,
  MushafSetting,
  PageAssessmentRecord,
  SemesterType,
  SessionType,
  StudentRecord,
} from '../types/tahfidz';

interface PageDraftRow {
  page_in_juz: number;
  score: number;
  fluency_score: number;
  tajwid_score: number;
  makhraj_score: number;
  waqaf_score: number;
  notes: string;
  error_tag_ids: string[];
  manualMode: boolean;
}

interface SessionInputFormProps {
  students: StudentRecord[];
  defaultStudentId?: string;
  defaultSessionType?: SessionType;
  mushaf: MushafSetting;
  onSaved: (result: { studentId: string; status: string; newlyAwardedBadges: string[] }) => void;
}

const QUICK_SCORES = [5, 4.5, 4, 3.5, 3];
const ERROR_CATEGORIES: ErrorCategory[] = [
  'Tajwid',
  'Makhraj & Sifat Huruf',
  'Kelancaran',
  'Waqaf & Ibtida',
];

export const SessionInputForm: React.FC<SessionInputFormProps> = ({
  students,
  defaultStudentId,
  defaultSessionType = 'ziyadah',
  mushaf,
  onSaved,
}) => {
  const [studentId, setStudentId] = useState(defaultStudentId || students[0]?.id || '');
  const [sessionDate, setSessionDate] = useState(todayJakartaISO());
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType);
  const [examType, setExamType] = useState<ExamType>('PTS');
  const [semester, setSemester] = useState<SemesterType>('Ganjil');
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [juzNumber, setJuzNumber] = useState(2);
  const [sessionNotes, setSessionNotes] = useState('');
  const [nextTargetPages, setNextTargetPages] = useState<string>('');
  const [nextTargetDate, setNextTargetDate] = useState<string>('');

  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [existingAssessments, setExistingAssessments] = useState<PageAssessmentRecord[]>([]);
  const [rows, setRows] = useState<PageDraftRow[]>([
    {
      page_in_juz: 15,
      score: 4.5,
      fluency_score: 4.5,
      tajwid_score: 4.5,
      makhraj_score: 4.75,
      waqaf_score: 4.75,
      notes: '',
      error_tag_ids: [],
      manualMode: false,
    },
  ]);

  // Audio recording state (10-15 detik)
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>('audio/webm');
  const [audioConsent, setAudioConsent] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (defaultStudentId) setStudentId(defaultStudentId);
  }, [defaultStudentId]);

  useEffect(() => {
    setSessionType(defaultSessionType);
  }, [defaultSessionType]);

  useEffect(() => {
    const stu = students.find((s) => s.id === studentId);
    if (stu?.class_id) {
      setSelectedClassId(stu.class_id);
    }
  }, [studentId, students]);

  useEffect(() => {
    apiFetch<{ errorTags: ErrorTag[] }>('/api/error-tags')
      .then((res) => setErrorTags(res.errorTags.filter((t) => t.is_active)))
      .catch(() => {});
    apiFetch<{ classes: ClassGroup[] }>('/api/classes')
      .then((res) => {
        setClasses(res.classes);
        setSelectedClassId((prev) => prev || res.classes[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!studentId) return;
    apiFetch<{
      juzSummaries: { juzNumber: number; assessedPagesCount: number; activePages: Record<number, PageAssessmentRecord> }[];
      sessions: { assessments: PageAssessmentRecord[] }[];
    }>(`/api/students/${studentId}/overview`)
      .then((data) => {
        const flat = data.sessions.flatMap((s) => s.assessments);
        setExistingAssessments(flat);
        const firstIncomplete = data.juzSummaries.find(
          (j) => j.assessedPagesCount < mushaf.default_pages_per_juz
        );
        if (firstIncomplete) {
          setJuzNumber(firstIncomplete.juzNumber);
          const nextPage = Math.min(
            mushaf.default_pages_per_juz,
            firstIncomplete.assessedPagesCount + 1
          );
          setRows((prev) =>
            prev.length === 1
              ? [{ ...prev[0], page_in_juz: nextPage }]
              : prev
          );
        }
      })
      .catch(() => {});
  }, [studentId, mushaf.default_pages_per_juz]);

  const currentJuzPreview = useMemo(() => {
    const base = calculateJuzProgress(
      juzNumber,
      existingAssessments,
      mushaf.default_pages_per_juz,
      mushaf.passing_threshold
    );

    if (sessionType === 'murojaah' || sessionType === 'tes_tahfidz') {
      return {
        base,
        projectedPages: base.assessedPagesCount,
        projectedScore: base.totalScore,
        draftAvg:
          rows.length > 0
            ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100) / 100
            : 0,
      };
    }

    const simulatedPages = { ...base.activePages };
    for (const r of rows) {
      simulatedPages[r.page_in_juz] = {
        ...(simulatedPages[r.page_in_juz] || ({} as PageAssessmentRecord)),
        score: r.score,
      };
    }
    const vals = Object.values(simulatedPages);
    const projectedScore = Math.round(vals.reduce((s, p) => s + p.score, 0) * 100) / 100;
    return {
      base,
      projectedPages: vals.length,
      projectedScore: Math.min(projectedScore, mushaf.default_pages_per_juz * 5),
      draftAvg:
        rows.length > 0
          ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100) / 100
          : 0,
    };
  }, [juzNumber, existingAssessments, rows, sessionType, mushaf]);

  const addPageRow = () => {
    const maxPage = Math.max(...rows.map((r) => r.page_in_juz), 0);
    const nextPage = Math.min(mushaf.default_pages_per_juz, maxPage + 1);
    setRows((prev) => [
      ...prev,
      {
        page_in_juz: nextPage,
        score: 5,
        fluency_score: 5,
        tajwid_score: 5,
        makhraj_score: 5,
        waqaf_score: 5,
        notes: '',
        error_tag_ids: [],
        manualMode: false,
      },
    ]);
  };

  const updateRow = (index: number, patch: Partial<PageDraftRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const toggleErrorTag = (index: number, tagId: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const exists = r.error_tag_ids.includes(tagId);
        return {
          ...r,
          error_tag_ids: exists
            ? r.error_tag_ids.filter((id) => id !== tagId)
            : [...r.error_tag_ids, tagId],
        };
      })
    );
  };

  const startRecording = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('Peramban tidak mendukung perekaman audio mikrofon.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });
        setAudioMimeType(mime);
        setAudioBlobUrl(URL.createObjectURL(blob));
        const reader = new FileReader();
        reader.onloadend = () => {
          setAudioBase64(String(reader.result || ''));
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= 15) {
            stopRecording();
            return 15;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setErrorMsg('Izin mikrofon ditolak atau tidak tersedia.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleSubmit = async (status: 'draft' | 'published') => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!studentId) {
      setErrorMsg('Silakan pilih nama santri terlebih dahulu.');
      return;
    }
    for (const r of rows) {
      const v = validatePageScore(r.score);
      if (!v.valid) {
        setErrorMsg(`Halaman ${r.page_in_juz}: ${v.error}`);
        return;
      }
      if (r.page_in_juz < 1 || r.page_in_juz > mushaf.default_pages_per_juz) {
        setErrorMsg(`Nomor halaman harus antara 1 dan ${mushaf.default_pages_per_juz}.`);
        return;
      }
    }

    if (audioBase64 && !audioConsent) {
      setErrorMsg('Harap centang persetujuan perekaman & penyimpanan audio privat sebelum menyimpan rekaman.');
      return;
    }

    const chosenClass = classes.find((c) => c.id === selectedClassId);
    const chosenStudent = students.find((s) => s.id === studentId);

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        sessionId: string;
        status: string;
        assessmentIds: string[];
        newlyAwardedBadges: string[];
      }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          student_id: studentId,
          session_type: sessionType,
          ...(sessionType === 'tes_tahfidz'
            ? {
                exam_type: examType,
                semester,
                class_id: chosenClass?.id || chosenStudent?.class_id || undefined,
                class_name: chosenClass?.class_name || chosenStudent?.class_name || undefined,
              }
            : {}),
          session_date: sessionDate,
          juz_number: juzNumber,
          notes: sessionNotes.trim() || undefined,
          status,
          next_target_pages: nextTargetPages ? Number(nextTargetPages) : undefined,
          next_target_date: nextTargetDate || undefined,
          assessments: rows.map((r) => ({
            juz_number: juzNumber,
            page_in_juz: r.page_in_juz,
            score: r.score,
            fluency_score: r.fluency_score,
            tajwid_score: r.tajwid_score,
            makhraj_score: r.makhraj_score,
            waqaf_score: r.waqaf_score,
            notes: r.notes.trim() || undefined,
            error_tag_ids: r.error_tag_ids,
          })),
        }),
      });

      if (audioBase64) {
        await apiFetch('/api/audio/upload', {
          method: 'POST',
          body: JSON.stringify({
            session_id: res.sessionId,
            page_assessment_id: res.assessmentIds[0],
            audio_base64: audioBase64,
            mime_type: audioMimeType,
            duration_seconds: Math.max(1, recordSeconds),
            consent_confirmed: audioConsent,
          }),
        });
      }

      setSuccessMsg(
        status === 'published'
          ? 'Laporan setoran berhasil disimpan dan dipublikasikan secara real-time ke santri & wali.'
          : 'Setoran berhasil disimpan sebagai draft.'
      );
      setAudioBase64(null);
      setAudioBlobUrl(null);
      setRecordSeconds(0);
      setSessionNotes('');
      onSaved({
        studentId,
        status,
        newlyAwardedBadges: res.newlyAwardedBadges || [],
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan setoran.');
    } finally {
      setSubmitting(false);
    }
  };

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        Belum ada santri binaan yang ditugaskan ke akun Anda. Hubungi Admin untuk penugasan halaqah.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Kontrol Cepat */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Input Setoran Hafalan Cepat
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mushaf.mushaf_name} · {mushaf.default_pages_per_juz} halaman/juz · Nilai maks. {mushaf.default_pages_per_juz * 5}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSessionType('ziyadah')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                sessionType === 'ziyadah'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Setoran Ziyadah
            </button>
            <button
              type="button"
              onClick={() => setSessionType('murojaah')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                sessionType === 'murojaah'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Laporan Murojaah
            </button>
            <button
              type="button"
              onClick={() => setSessionType('tes_tahfidz')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                sessionType === 'tes_tahfidz'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tes Tahfidz
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="input-santri" className="block text-xs font-medium text-slate-700 mb-1">
              Nama Santri
            </label>
            <select
              id="input-santri"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.class_name || s.student_number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="input-tanggal" className="block text-xs font-medium text-slate-700 mb-1">
              {sessionType === 'tes_tahfidz' ? 'Tanggal Tes Tahfidz' : 'Tanggal Setoran'}
            </label>
            <input
              id="input-tanggal"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="input-juz" className="block text-xs font-medium text-slate-700 mb-1">
              Pilih Juz (1–{mushaf.total_juz})
            </label>
            <select
              id="input-juz"
              value={juzNumber}
              onChange={(e) => setJuzNumber(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {Array.from({ length: mushaf.total_juz }, (_, i) => i + 1).map((j) => (
                <option key={j} value={j}>
                  Juz {j}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sessionType === 'tes_tahfidz' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <div>
              <label htmlFor="input-exam-type" className="block text-xs font-medium text-slate-700 mb-1">
                Jenis Ujian (PTS / PAS)
              </label>
              <select
                id="input-exam-type"
                value={examType}
                onChange={(e) => setExamType(e.target.value as ExamType)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
              >
                <option value="PTS">PTS (Penilaian Tengah Semester)</option>
                <option value="PAS">PAS (Penilaian Akhir Semester)</option>
              </select>
            </div>

            <div>
              <label htmlFor="input-semester" className="block text-xs font-medium text-slate-700 mb-1">
                Semester
              </label>
              <select
                id="input-semester"
                value={semester}
                onChange={(e) => setSemester(e.target.value as SemesterType)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
              >
                <option value="Ganjil">Semester Ganjil</option>
                <option value="Genap">Semester Genap</option>
              </select>
            </div>

            <div>
              <label htmlFor="input-tes-kelas" className="block text-xs font-medium text-slate-700 mb-1">
                Kelas / Halaqah
              </label>
              <select
                id="input-tes-kelas"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
              >
                {classes.length > 0 ? (
                  classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.class_name} ({c.level})
                    </option>
                  ))
                ) : (
                  <option value="">
                    {students.find((s) => s.id === studentId)?.class_name || 'Kelas Santri'}
                  </option>
                )}
              </select>
            </div>
          </div>
        )}

        {/* Kalkulasi Nilai Sementara Langsung */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          {sessionType === 'ziyadah' ? (
            <>
              <div className="space-y-0.5">
                <span className="text-slate-500">Proyeksi Progres Juz {juzNumber}</span>
                <p className="font-semibold text-slate-900 font-mono">
                  {currentJuzPreview.projectedPages} / {mushaf.default_pages_per_juz} halaman
                  {currentJuzPreview.projectedPages < mushaf.default_pages_per_juz
                    ? ' (Sedang berjalan)'
                    : ' (Lengkap)'}
                </p>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-500">Nilai Juz Sementara</span>
                <p className="font-semibold text-emerald-800 font-mono text-sm">
                  {formatNilaiID(currentJuzPreview.projectedScore)} / {currentJuzPreview.projectedPages * 5}
                </p>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-500">Rata-rata Setoran Ini</span>
                <p className="font-semibold text-slate-900 font-mono">
                  {formatNilaiID(currentJuzPreview.draftAvg)} / 5
                </p>
              </div>
            </>
          ) : sessionType === 'tes_tahfidz' ? (
            <div className="flex flex-wrap items-center justify-between w-full gap-3">
              <span className="text-slate-700">
                Mode <strong>Tes Tahfidz ({examType} · Semester {semester})</strong> —{' '}
                {classes.find((c) => c.id === selectedClassId)?.class_name ||
                  students.find((s) => s.id === studentId)?.class_name ||
                  'Kelas Santri'}{' '}
                · Model penilaian 0–5 per halaman.
              </span>
              <span className="font-mono font-semibold text-slate-900">
                Rata-rata Tes: {formatNilaiID(currentJuzPreview.draftAvg)} / 5
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between w-full gap-3">
              <span className="text-slate-700">
                Mode <strong>Murojaah</strong>: Pengulangan hafalan lama — tidak menambah progres halaman ziyadah baru.
              </span>
              <span className="font-mono font-semibold text-amber-800">
                Rata-rata Murojaah: {formatNilaiID(currentJuzPreview.draftAvg)} / 5
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Daftar Kartu Penilaian Per Halaman */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Penilaian Per Halaman ({rows.length} halaman)
          </h3>
          <button
            type="button"
            onClick={addPageRow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Tambah Halaman</span>
          </button>
        </div>

        {rows.map((row, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <label htmlFor={`page-num-${idx}`} className="text-xs font-semibold text-slate-700">
                  Halaman Juz
                </label>
                <input
                  id={`page-num-${idx}`}
                  type="number"
                  min={1}
                  max={mushaf.default_pages_per_juz}
                  value={row.page_in_juz}
                  onChange={(e) => updateRow(idx, { page_in_juz: Number(e.target.value) })}
                  className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-mono font-semibold text-slate-900"
                />
                <span className="text-xs text-slate-500">
                  Nilai aktif: <strong className="font-mono text-slate-900">{formatNilaiID(row.score)}</strong> / 5
                </span>
              </div>

              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label={`Hapus halaman ${row.page_in_juz}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hapus</span>
                </button>
              )}
            </div>

            {/* Tombol Cepat Nilai */}
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_SCORES.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() =>
                    updateRow(idx, {
                      score: val,
                      fluency_score: val,
                      tajwid_score: val,
                      makhraj_score: Math.min(5, val + 0.25),
                      waqaf_score: Math.min(5, val + 0.25),
                      manualMode: false,
                    })
                  }
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-colors ${
                    !row.manualMode && row.score === val
                      ? 'border-emerald-700 bg-emerald-700 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  Nilai {formatNilaiID(val)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => updateRow(idx, { manualMode: !row.manualMode })}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  row.manualMode
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Input Manual
              </button>

              {row.manualMode && (
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  max={5}
                  value={row.score}
                  aria-label={`Nilai manual halaman ${row.page_in_juz}`}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    updateRow(idx, {
                      score: num,
                      fluency_score: num,
                      tajwid_score: num,
                      makhraj_score: num,
                      waqaf_score: num,
                    });
                  }}
                  className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
              )}
            </div>

            {/* Skor Komponen Terpisah (Kelancaran, Tajwid, Makhraj, Waqaf) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {(
                [
                  ['fluency_score', 'Kelancaran'],
                  ['tajwid_score', 'Tajwid'],
                  ['makhraj_score', 'Makhraj'],
                  ['waqaf_score', 'Waqaf & Ibtida'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    {label} ({formatNilaiID(row[field])})
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.25}
                    value={row[field]}
                    onChange={(e) => updateRow(idx, { [field]: Number(e.target.value) })}
                    className="w-full accent-emerald-700"
                  />
                </div>
              ))}
            </div>

            {/* Tag Kesalahan (otomatis muncul jika nilai < 5) */}
            {row.score < 5 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 space-y-3">
                <p className="text-xs font-semibold text-amber-900">
                  Tag Kesalahan Tajwid, Makhraj &amp; Kelancaran (Nilai &lt; 5)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ERROR_CATEGORIES.map((cat) => {
                    const tagsInCat = errorTags.filter((t) => t.category === cat);
                    if (tagsInCat.length === 0) return null;
                    return (
                      <div key={cat} className="space-y-1.5">
                        <span className="block text-[11px] font-semibold text-slate-700">{cat}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {tagsInCat.map((tag) => {
                            const selected = row.error_tag_ids.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => toggleErrorTag(idx, tag.id)}
                                className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                                  selected
                                    ? 'border-amber-700 bg-amber-700 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-amber-400'
                                }`}
                              >
                                {tag.tag_name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Catatan Evaluasi Halaman {row.page_in_juz}
              </label>
              <input
                type="text"
                value={row.notes}
                onChange={(e) => updateRow(idx, { notes: e.target.value })}
                placeholder="Contoh: Mad wajib muttashil perlu dipanjangkan 4-5 harakat"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Catatan Umum, Target Berikutnya & Rekaman Audio */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="session-notes" className="block text-xs font-medium text-slate-700 mb-1">
              Catatan Umum Ustadz / Tindak Lanjut
            </label>
            <textarea
              id="session-notes"
              rows={2}
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder="Ringkasan evaluasi setoran hari ini untuk dibaca santri & wali santri..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="next-target-pages" className="block text-xs font-medium text-slate-700 mb-1">
              Target Setoran Berikutnya (Halaman / Pekan, Opsional)
            </label>
            <input
              id="next-target-pages"
              type="number"
              min={1}
              max={40}
              value={nextTargetPages}
              onChange={(e) => setNextTargetPages(e.target.value)}
              placeholder="Contoh: 5"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="next-target-date" className="block text-xs font-medium text-slate-700 mb-1">
              Batas Tanggal Target (Opsional)
            </label>
            <input
              id="next-target-date"
              type="date"
              value={nextTargetDate}
              onChange={(e) => setNextTargetDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </div>

        {/* Perekam Audio Singkat (10-15 detik, privat) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Rekaman Audio Bacaan Singkat (Maks. 15 Detik · Penyimpanan Privat)
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Audio hanya dapat diakses dengan tautan bertanda tangan sementara oleh ustadz, santri, dan wali yang berizin.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <Mic className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
                  <span>Rekam Audio</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  <Square className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hentikan ({recordSeconds}d / 15d)</span>
                </button>
              )}
            </div>
          </div>

          {audioBlobUrl && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-3">
                <audio controls src={audioBlobUrl} className="h-9 flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    setAudioBlobUrl(null);
                    setAudioBase64(null);
                    setRecordSeconds(0);
                  }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Hapus Audio
                </button>
              </div>
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={audioConsent}
                  onChange={(e) => setAudioConsent(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700"
                />
                <span>
                  Saya mengonfirmasi persetujuan perekaman bacaan santri untuk dokumentasi evaluasi privat sesuai kebijakan penyimpanan lembaga.
                </span>
              </label>
            </div>
          )}
        </div>

        {errorMsg && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit('draft')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>Simpan sebagai Draft</span>
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit('published')}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
            <span>{submitting ? 'Menyimpan...' : 'Simpan & Publikasikan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
