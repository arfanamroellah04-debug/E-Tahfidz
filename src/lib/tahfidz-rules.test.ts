import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateJuzProgress,
  computeCompletionPrediction,
  computeMurojaahRecommendation,
  computeRadarMetrics,
  validatePageScore,
} from './tahfidz-rules';
import type { PageAssessmentRecord } from '../types/tahfidz';

function makeAssessment(overrides: Partial<PageAssessmentRecord>): PageAssessmentRecord {
  return {
    id: `pa-${Math.random()}`,
    session_id: 's-1',
    session_type: 'ziyadah',
    session_status: 'published',
    session_date: '2026-11-01',
    student_id: 'stu-1',
    teacher_id: 'tch-1',
    juz_number: 1,
    page_in_juz: 1,
    mushaf_page_number: 1,
    score: 5,
    fluency_score: 5,
    tajwid_score: 5,
    makhraj_score: 5,
    waqaf_score: 5,
    attempt_number: 1,
    assessment_status: 'resmi',
    notes: null,
    created_at: '2026-11-01T08:00:00Z',
    updated_at: '2026-11-01T08:00:00Z',
    ...overrides,
  };
}

test('validasi rentang nilai per halaman menolak < 0 dan > 5 serta menerima desimal', () => {
  assert.equal(validatePageScore(-0.5).valid, false);
  assert.equal(validatePageScore(5.1).valid, false);
  assert.equal(validatePageScore(Number.NaN).valid, false);
  assert.equal(validatePageScore(0).valid, true);
  assert.equal(validatePageScore(4.5).valid, true);
  assert.equal(validatePageScore(3.75).valid, true);
  assert.equal(validatePageScore(5).valid, true);
});

test('nilai 5 pada 20 halaman menghasilkan nilai juz tepat 100 dan status selesai dinilai', () => {
  const list = Array.from({ length: 20 }, (_, i) =>
    makeAssessment({ page_in_juz: i + 1, score: 5 })
  );
  const res = calculateJuzProgress(1, list, 20, 80);
  assert.equal(res.assessedPagesCount, 20);
  assert.equal(res.isComplete, true);
  assert.equal(res.totalScore, 100);
  assert.equal(res.juzStatus, 'selesai_dinilai');
  assert.equal(res.eligibilityStatus, 'layak');
});

test('nilai 4,5 pada satu halaman dan 5 pada 19 halaman menghasilkan 99,5', () => {
  const list = Array.from({ length: 20 }, (_, i) =>
    makeAssessment({ page_in_juz: i + 1, score: i === 1 ? 4.5 : 5 })
  );
  const res = calculateJuzProgress(1, list, 20, 80);
  assert.equal(res.totalScore, 99.5);
  assert.equal(res.isComplete, true);
});

test('penilaian 10 halaman tidak dianggap juz lengkap dan halaman kosong tidak dianggap 0', () => {
  const list = Array.from({ length: 10 }, (_, i) =>
    makeAssessment({ page_in_juz: i + 1, score: 4.5 })
  );
  const res = calculateJuzProgress(2, list.map((a) => ({ ...a, juz_number: 2 })), 20, 80);
  assert.equal(res.assessedPagesCount, 10);
  assert.equal(res.isComplete, false);
  assert.equal(res.totalScore, 45);
  assert.equal(res.maxPossibleCurrent, 50);
  assert.equal(res.juzStatus, 'sedang_berjalan');
  assert.equal(res.eligibilityStatus, 'belum_lengkap');
});

test('penilaian ulang pada halaman sama tidak menggandakan nilai dan memakai nilai resmi terbaru', () => {
  const list = [
    makeAssessment({ page_in_juz: 1, score: 3, attempt_number: 1, created_at: '2026-11-01T08:00:00Z' }),
    makeAssessment({ page_in_juz: 1, score: 4.75, attempt_number: 2, created_at: '2026-11-03T08:00:00Z' }),
    makeAssessment({ page_in_juz: 2, score: 5, attempt_number: 1 }),
  ];
  const res = calculateJuzProgress(1, list, 20, 80);
  assert.equal(res.assessedPagesCount, 2);
  assert.equal(res.totalScore, 9.75);
  assert.equal(res.allAttemptsCount, 3);
  assert.equal(res.activePages[1].score, 4.75);
});

test('sesi murojaah, tes_tahfidz, dan draft tidak menambah progres penyelesaian juz baru', () => {
  const list = [
    makeAssessment({ page_in_juz: 1, score: 5, session_type: 'ziyadah', session_status: 'published' }),
    makeAssessment({ page_in_juz: 2, score: 5, session_type: 'murojaah', session_status: 'published' }),
    makeAssessment({ page_in_juz: 4, score: 5, session_type: 'tes_tahfidz', session_status: 'published' }),
    makeAssessment({ page_in_juz: 3, score: 5, session_type: 'ziyadah', session_status: 'draft' }),
  ];
  const res = calculateJuzProgress(1, list, 20, 80);
  assert.equal(res.assessedPagesCount, 1);
  assert.equal(res.draftPagesCount, 1);
  assert.equal(res.totalScore, 5);
});

test('status penyelesaian juz memisahkan selesai dinilai dengan ambang kelulusan', () => {
  const list = Array.from({ length: 20 }, (_, i) =>
    makeAssessment({ page_in_juz: i + 1, score: 3.5 }) // total = 70 < 80
  );
  const res = calculateJuzProgress(1, list, 20, 80);
  assert.equal(res.isComplete, true);
  assert.equal(res.totalScore, 70);
  assert.equal(res.juzStatus, 'perlu_penguatan');
  assert.equal(res.eligibilityStatus, 'perlu_perbaikan');
});

test('konfigurasi jumlah halaman per juz dinamis (misal 15 halaman/juz)', () => {
  const list = Array.from({ length: 15 }, (_, i) =>
    makeAssessment({ page_in_juz: i + 1, score: 5 })
  );
  const res = calculateJuzProgress(1, list, 15, 60);
  assert.equal(res.isComplete, true);
  assert.equal(res.totalScore, 75);
  assert.equal(res.eligibilityStatus, 'layak');
});

test('Smart Murojaah Scheduler menentukan interval spaced repetition sesuai skor & tag kesalahan', () => {
  const critical = computeMurojaahRecommendation({
    score: 2.5,
    errorCount: 3,
    baseDateISO: '2026-11-10',
  });
  assert.equal(critical.intervalDays, 0);
  assert.equal(critical.priority, 'kritis');

  const high = computeMurojaahRecommendation({
    score: 3.5,
    errorCount: 2,
    baseDateISO: '2026-11-10',
  });
  assert.equal(high.intervalDays, 1);
  assert.equal(high.scheduledDate, '2026-11-11');

  const stable = computeMurojaahRecommendation({
    score: 5,
    errorCount: 0,
    baseDateISO: '2026-11-10',
  });
  assert.equal(stable.intervalDays, 14);
  assert.equal(stable.scheduledDate, '2026-11-24');
});

test('prediksi AI menolak jika data < 3 hari aktif dan menghitung jika data cukup', () => {
  const few = [
    makeAssessment({ session_date: '2026-11-01', page_in_juz: 1 }),
    makeAssessment({ session_date: '2026-11-02', page_in_juz: 2 }),
  ];
  const p1 = computeCompletionPrediction({ assessments: few, activeJuzNumber: 1 });
  assert.equal(p1.insufficientData, true);

  const enough = [
    makeAssessment({ session_date: '2026-11-01', page_in_juz: 1 }),
    makeAssessment({ session_date: '2026-11-02', page_in_juz: 2 }),
    makeAssessment({ session_date: '2026-11-03', page_in_juz: 3 }),
    makeAssessment({ session_date: '2026-11-04', page_in_juz: 4 }),
  ];
  const p2 = computeCompletionPrediction({ assessments: enough, activeJuzNumber: 1 });
  assert.equal(p2.insufficientData, false);
  assert.equal(p2.remainingPages, 16);
  assert.ok(p2.estimatedDays !== null && p2.estimatedDays > 0);
});

test('radar chart menghitung kelancaran, tajwid, makhraj dari nilai per komponen terpisah', () => {
  const list = [
    makeAssessment({ fluency_score: 5, tajwid_score: 4, makhraj_score: 3, session_date: '2026-11-10' }),
  ];
  const radar = computeRadarMetrics({ assessments: list, referenceDateISO: '2026-11-12' });
  assert.equal(radar.kelancaran, 100);
  assert.equal(radar.tajwid, 80);
  assert.equal(radar.makhraj, 60);
});
