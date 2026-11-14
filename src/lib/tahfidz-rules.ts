import type {
  CompletionPrediction,
  EligibilityStatus,
  JuzProgressStatus,
  JuzProgressSummary,
  MurojaahPriority,
  PageAssessmentRecord,
  RadarSkillMetrics,
} from '../types/tahfidz';

export function validatePageScore(score: number): { valid: boolean; error?: string } {
  if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
    return { valid: false, error: 'Nilai halaman harus berupa angka yang valid.' };
  }
  if (score < 0) {
    return { valid: false, error: 'Nilai halaman tidak boleh kurang dari 0.' };
  }
  if (score > 5) {
    return { valid: false, error: 'Nilai halaman tidak boleh lebih dari 5.' };
  }
  return { valid: true };
}

export function roundScore(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Menghitung progres dan nilai resmi satu juz secara deterministik:
 * - Hanya menghitung sesi 'ziyadah' (murojaah TIDAK menambah progres juz baru).
 * - Halaman tanpa penilaian resmi tidak dihitung bernilai 0.
 * - Penilaian ulang pada halaman yang sama tidak menggandakan halaman;
 *   hanya nilai resmi terbaru (attempt_number/created_at tertinggi) yang aktif.
 * - Nilai maksimal satu juz = pagesPerJuz * 5 (default 20 * 5 = 100).
 */
export function calculateJuzProgress(
  juzNumber: number,
  assessments: PageAssessmentRecord[],
  pagesPerJuz = 20,
  passingThreshold = 80
): JuzProgressSummary {
  const juzZiyadah = assessments.filter(
    (a) => a.juz_number === juzNumber && a.session_type === 'ziyadah'
  );

  const officialAssessments = juzZiyadah.filter(
    (a) => a.session_status === 'published' || a.session_status === 'corrected'
  );
  const draftAssessments = juzZiyadah.filter((a) => a.session_status === 'draft');

  // Pilih penilaian resmi terbaru per halaman (1..pagesPerJuz)
  const activePages: Record<number, PageAssessmentRecord> = {};
  for (const item of officialAssessments) {
    if (item.page_in_juz < 1 || item.page_in_juz > pagesPerJuz) continue;
    const existing = activePages[item.page_in_juz];
    if (!existing) {
      activePages[item.page_in_juz] = item;
    } else {
      const existingTime = new Date(existing.created_at).getTime();
      const itemTime = new Date(item.created_at).getTime();
      if (
        item.attempt_number > existing.attempt_number ||
        (item.attempt_number === existing.attempt_number && itemTime >= existingTime)
      ) {
        activePages[item.page_in_juz] = item;
      }
    }
  }

  const activeList = Object.values(activePages);
  const assessedPagesCount = activeList.length;
  const draftPagesSet = new Set(
    draftAssessments
      .filter((d) => !activePages[d.page_in_juz])
      .map((d) => d.page_in_juz)
  );
  const draftPagesCount = draftPagesSet.size;

  const maxPossibleFull = pagesPerJuz * 5;
  const maxPossibleCurrent = assessedPagesCount * 5;
  const rawSum = activeList.reduce((acc, p) => acc + p.score, 0);
  const totalScore = roundScore(Math.min(rawSum, maxPossibleFull));
  const averagePerPage =
    assessedPagesCount > 0 ? roundScore(totalScore / assessedPagesCount) : null;
  const isComplete = assessedPagesCount === pagesPerJuz;

  let juzStatus: JuzProgressStatus = 'belum_dimulai';
  if (assessedPagesCount === 0 && draftPagesCount === 0) {
    juzStatus = 'belum_dimulai';
  } else if (assessedPagesCount === 0 && draftPagesCount > 0) {
    juzStatus = 'menunggu_evaluasi';
  } else if (!isComplete) {
    juzStatus = 'sedang_berjalan';
  } else {
    juzStatus = totalScore >= passingThreshold ? 'selesai_dinilai' : 'perlu_penguatan';
  }

  let eligibilityStatus: EligibilityStatus = 'belum_lengkap';
  if (isComplete) {
    eligibilityStatus = totalScore >= passingThreshold ? 'layak' : 'perlu_perbaikan';
  }

  return {
    juzNumber,
    pagesPerJuz,
    assessedPagesCount,
    draftPagesCount,
    isComplete,
    totalScore,
    maxPossibleCurrent,
    maxPossibleFull,
    averagePerPage,
    juzStatus,
    eligibilityStatus,
    activePages,
    allAttemptsCount: officialAssessments.length,
  };
}

/**
 * Rekomendasi Spaced Repetition untuk Smart Murojaah Scheduler.
 */
export function computeMurojaahRecommendation(params: {
  score: number;
  errorCount: number;
  previousScore?: number | null;
  baseDateISO: string; // YYYY-MM-DD
}): {
  intervalDays: number;
  priority: MurojaahPriority;
  scheduledDate: string;
  reason: string;
} {
  const { score, errorCount, previousScore, baseDateISO } = params;
  const isDeclining =
    typeof previousScore === 'number' && score < previousScore - 0.25;

  let intervalDays = 7;
  let priority: MurojaahPriority = 'rutin';
  let reason = 'Hafalan stabil dan baik.';

  if (score < 3 || errorCount >= 3) {
    intervalDays = 0; // ulangi pada kesempatan berikutnya (hari yang sama / besok pagi)
    priority = 'kritis';
    reason = `Nilai rendah (${score}) dengan ${errorCount} catatan kesalahan; perlu pengulangan segera.`;
  } else if (score < 3.75 || isDeclining || errorCount === 2) {
    intervalDays = 1;
    priority = 'tinggi';
    reason = isDeclining
      ? `Terjadi penurunan nilai dari ${previousScore} menjadi ${score}; dijadwalkan ulang 1 hari.`
      : `Membutuhkan penguatan dasar (nilai ${score}); dijadwalkan dalam 1 hari.`;
  } else if (score < 4.5 || errorCount === 1) {
    intervalDays = 3;
    priority = 'sedang';
    reason = `Kelancaran cukup baik (${score}), perlu pemantapan ringan dalam 3 hari.`;
  } else if (score < 4.9) {
    intervalDays = 7;
    priority = 'rutin';
    reason = `Hafalan baik (${score}); masuk siklus murojaah mingguan (7 hari).`;
  } else {
    intervalDays = 14;
    priority = 'rutin';
    reason = `Hafalan sangat baik & stabil (${score}); masuk siklus pemeliharaan 14 hari.`;
  }

  const base = new Date(`${baseDateISO}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + intervalDays);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');

  return {
    intervalDays,
    priority,
    scheduledDate: `${yyyy}-${mm}-${dd}`,
    reason,
  };
}

/**
 * Menghitung Radar Chart 5 indikator (skala 0-100) dari data database yang terukur:
 * - Kelancaran, Tajwid, Makhraj: rata-rata skor dimensi dari penilai (0..5 -> 0..100).
 * - Konsistensi: rasio hari aktif setoran dalam 30 hari terakhir vs target 20 hari aktif.
 * - Kecepatan: laju halaman ziyadah per minggu aktif vs target standar 4 halaman/minggu.
 */
export function computeRadarMetrics(params: {
  assessments: PageAssessmentRecord[];
  referenceDateISO?: string;
}): RadarSkillMetrics {
  const official = params.assessments.filter(
    (a) => a.session_status === 'published' || a.session_status === 'corrected'
  );
  if (official.length === 0) {
    return {
      kelancaran: 0,
      tajwid: 0,
      makhraj: 0,
      konsistensi: 0,
      kecepatan: 0,
      sampleCount: 0,
    };
  }

  const avgFluency =
    official.reduce((s, a) => s + (a.fluency_score ?? a.score), 0) / official.length;
  const avgTajwid =
    official.reduce((s, a) => s + (a.tajwid_score ?? a.score), 0) / official.length;
  const avgMakhraj =
    official.reduce((s, a) => s + (a.makhraj_score ?? a.score), 0) / official.length;

  const refDate = params.referenceDateISO
    ? new Date(`${params.referenceDateISO}T23:59:59+07:00`)
    : new Date();
  const windowStart = new Date(refDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recentDates = new Set<string>();
  const ziyadahRecentPages = new Set<string>();

  for (const a of official) {
    const d = new Date(`${a.session_date}T12:00:00+07:00`);
    if (d >= windowStart && d <= refDate) {
      recentDates.add(a.session_date);
      if (a.session_type === 'ziyadah') {
        ziyadahRecentPages.add(`${a.juz_number}:${a.page_in_juz}`);
      }
    }
  }

  // Fallback to all recorded dates if the 30-day window has none (historical seed)
  const uniqueDates =
    recentDates.size > 0
      ? recentDates
      : new Set(official.map((a) => a.session_date));
  const ziyadahPagesCount =
    ziyadahRecentPages.size > 0
      ? ziyadahRecentPages.size
      : new Set(
          official
            .filter((a) => a.session_type === 'ziyadah')
            .map((a) => `${a.juz_number}:${a.page_in_juz}`)
        ).size;

  const konsistensi = Math.min(100, Math.round((uniqueDates.size / 15) * 100));
  const weeksSpan = Math.max(1, uniqueDates.size / 4);
  const pagesPerWeek = ziyadahPagesCount / weeksSpan;
  const kecepatan = Math.min(100, Math.round((pagesPerWeek / 5) * 100));

  return {
    kelancaran: Math.round((avgFluency / 5) * 100),
    tajwid: Math.round((avgTajwid / 5) * 100),
    makhraj: Math.round((avgMakhraj / 5) * 100),
    konsistensi,
    kecepatan,
    sampleCount: official.length,
  };
}

/**
 * Prediksi penyelesaian juz berikutnya berdasarkan kecepatan riil di database.
 * Tidak menghasilkan prediksi jika data aktif < 3 hari setoran ziyadah.
 */
export function computeCompletionPrediction(params: {
  assessments: PageAssessmentRecord[];
  activeJuzNumber: number;
  pagesPerJuz?: number;
}): CompletionPrediction {
  const pagesPerJuz = params.pagesPerJuz ?? 20;
  const ziyadahOfficial = params.assessments.filter(
    (a) =>
      a.session_type === 'ziyadah' &&
      (a.session_status === 'published' || a.session_status === 'corrected')
  );

  const dates = Array.from(new Set(ziyadahOfficial.map((a) => a.session_date))).sort();
  const periodStart = dates[0] ?? new Date().toISOString().slice(0, 10);
  const periodEnd = dates[dates.length - 1] ?? periodStart;

  const currentJuzSummary = calculateJuzProgress(
    params.activeJuzNumber,
    ziyadahOfficial,
    pagesPerJuz
  );
  const remainingPages = Math.max(0, pagesPerJuz - currentJuzSummary.assessedPagesCount);

  if (dates.length < 3) {
    return {
      insufficientData: true,
      reason: `Data belum mencukupi untuk prediksi akurat (minimal 3 hari aktif setoran ziyadah; saat ini tercatat ${dates.length} hari).`,
      targetJuz: params.activeJuzNumber,
      remainingPages,
      activeDaysObserved: dates.length,
      pagesPerActiveDay: 0,
      estimatedDays: null,
      estimatedDateStart: null,
      estimatedDateEnd: null,
      periodStart,
      periodEnd,
      confidenceLevel: 'rendah',
    };
  }

  const uniqueZiyadahPages = new Set(
    ziyadahOfficial.map((a) => `${a.juz_number}:${a.page_in_juz}`)
  ).size;
  const pagesPerActiveDay = roundScore(uniqueZiyadahPages / dates.length);

  // Hitung kepadatan kalender (aktif hari per hari kalender)
  const startMs = new Date(`${periodStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${periodEnd}T00:00:00Z`).getTime();
  const calendarSpanDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  const effectivePagesPerCalendarDay = Math.max(0.2, uniqueZiyadahPages / calendarSpanDays);

  const pagesToPredict = remainingPages > 0 ? remainingPages : pagesPerJuz;
  const targetJuz = remainingPages > 0 ? params.activeJuzNumber : Math.min(30, params.activeJuzNumber + 1);
  const estimatedDays = Math.max(1, Math.ceil(pagesToPredict / effectivePagesPerCalendarDay));

  const base = new Date(`${periodEnd}T00:00:00Z`);
  const lowDate = new Date(base.getTime() + Math.max(1, Math.floor(estimatedDays * 0.85)) * 86400000);
  const highDate = new Date(base.getTime() + Math.ceil(estimatedDays * 1.2) * 86400000);

  const confidenceLevel =
    dates.length >= 10 ? 'tinggi' : dates.length >= 5 ? 'sedang' : 'rendah';

  return {
    insufficientData: false,
    targetJuz,
    remainingPages: pagesToPredict,
    activeDaysObserved: dates.length,
    pagesPerActiveDay,
    estimatedDays,
    estimatedDateStart: lowDate.toISOString().slice(0, 10),
    estimatedDateEnd: highDate.toISOString().slice(0, 10),
    periodStart,
    periodEnd,
    confidenceLevel,
  };
}
