import crypto from 'node:crypto';
import { db } from './db.ts';
import { signToken } from './auth.ts';
import {
  calculateJuzProgress,
  computeCompletionPrediction,
  computeRadarMetrics,
} from '../lib/tahfidz-rules.ts';
import type {
  AIAnalysisRecord,
  AudioAttachmentRecord,
  BadgeRecord,
  ErrorCategory,
  ExamType,
  HafalanSessionRecord,
  HafalanTargetRecord,
  MurojaahScheduleRecord,
  MushafSetting,
  PageAssessmentRecord,
  SemesterType,
  SessionType,
} from '../types/tahfidz.ts';

export function getActiveMushafSetting(): MushafSetting {
  const row = db
    .prepare(`SELECT * FROM mushaf_settings WHERE is_default = 1 LIMIT 1`)
    .get() as (Omit<MushafSetting, 'is_default'> & { is_default: number }) | undefined;
  const fallback =
    row ??
    (db.prepare(`SELECT * FROM mushaf_settings LIMIT 1`).get() as
      | (Omit<MushafSetting, 'is_default'> & { is_default: number })
      | undefined);
  const thresholdSetting = db
    .prepare(`SELECT value FROM system_settings WHERE key = 'passing_threshold'`)
    .get() as { value: string } | undefined;

  if (!fallback) {
    return {
      id: 'default',
      mushaf_name: 'Mushaf Madinah (Rasm Utsmani)',
      total_juz: 30,
      default_pages_per_juz: 20,
      passing_threshold: Number(thresholdSetting?.value ?? 80),
      is_default: true,
      created_at: new Date().toISOString(),
    };
  }
  return {
    ...fallback,
    passing_threshold: thresholdSetting ? Number(thresholdSetting.value) : fallback.passing_threshold,
    is_default: Boolean(fallback.is_default),
  };
}

export function getStudentAssessments(studentId: string): PageAssessmentRecord[] {
  const rows = db
    .prepare(
      `SELECT pa.*, hs.session_type, hs.exam_type, hs.semester, hs.class_id, hs.class_name,
              hs.status AS session_status, hs.session_date,
              hs.student_id, hs.teacher_id, p.full_name AS teacher_name
       FROM page_assessments pa
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       JOIN teachers t ON t.id = hs.teacher_id
       JOIN profiles p ON p.id = t.profile_id
       WHERE hs.student_id = ?
       ORDER BY hs.session_date DESC, pa.created_at DESC`
    )
    .all(studentId) as PageAssessmentRecord[];

  const errStmt = db.prepare(
    `SELECT et.id, et.tag_name, et.category, pae.notes
     FROM page_assessment_errors pae
     JOIN error_tags et ON et.id = pae.error_tag_id
     WHERE pae.page_assessment_id = ?`
  );

  for (const r of rows) {
    r.errors = errStmt.all(r.id) as {
      id: string;
      tag_name: string;
      category: ErrorCategory;
      notes: string | null;
    }[];
  }
  return rows;
}

export function getStudentSessions(studentId: string): HafalanSessionRecord[] {
  const sessions = db
    .prepare(
      `SELECT hs.*, s.full_name AS student_name, p.full_name AS teacher_name
       FROM hafalan_sessions hs
       JOIN students s ON s.id = hs.student_id
       JOIN teachers t ON t.id = hs.teacher_id
       JOIN profiles p ON p.id = t.profile_id
       WHERE hs.student_id = ?
       ORDER BY hs.session_date DESC, hs.created_at DESC`
    )
    .all(studentId) as HafalanSessionRecord[];

  const allAssessments = getStudentAssessments(studentId);
  const bySession = new Map<string, PageAssessmentRecord[]>();
  for (const a of allAssessments) {
    const arr = bySession.get(a.session_id) ?? [];
    arr.push(a);
    bySession.set(a.session_id, arr);
  }

  for (const s of sessions) {
    s.assessments = (bySession.get(s.id) ?? []).sort((a, b) => a.page_in_juz - b.page_in_juz);
  }
  return sessions;
}

export function getStudentAudioAttachments(
  studentId: string,
  viewerProfileId: string,
  canListenAudio: boolean
): AudioAttachmentRecord[] {
  const rows = db
    .prepare(
      `SELECT aa.id, aa.session_id, aa.page_assessment_id, aa.duration_seconds,
              aa.uploaded_by, aa.created_at, p.full_name AS uploader_name,
              hs.juz_number, hs.session_type, hs.exam_type, hs.semester, hs.class_name,
              hs.session_date, pa.page_in_juz
       FROM audio_attachments aa
       JOIN hafalan_sessions hs ON hs.id = aa.session_id
       JOIN profiles p ON p.id = aa.uploaded_by
       LEFT JOIN page_assessments pa ON pa.id = aa.page_assessment_id
       WHERE hs.student_id = ?
       ORDER BY aa.created_at DESC`
    )
    .all(studentId) as Omit<AudioAttachmentRecord, 'signed_url' | 'can_listen'>[];

  return rows.map((r) => {
    const token = canListenAudio
      ? signToken({ aid: r.id, uid: viewerProfileId }, 60 * 30) // 30 min signed URL
      : null;
    return {
      ...r,
      can_listen: canListenAudio,
      signed_url: token ? `/api/audio/${r.id}/stream?token=${encodeURIComponent(token)}` : undefined,
    };
  });
}

export function getStudentOverview(studentId: string, viewerProfileId: string, canListenAudio: boolean) {
  const student = db
    .prepare(
      `SELECT s.*, c.class_name, p.email, p.avatar_url
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN profiles p ON p.id = s.profile_id
       WHERE s.id = ?`
    )
    .get(studentId);

  if (!student) return null;

  const mushaf = getActiveMushafSetting();
  const assessments = getStudentAssessments(studentId);
  const sessions = getStudentSessions(studentId);

  const juzSummaries = [];
  for (let j = 1; j <= mushaf.total_juz; j++) {
    const summary = calculateJuzProgress(
      j,
      assessments,
      mushaf.default_pages_per_juz,
      mushaf.passing_threshold
    );
    if (summary.assessedPagesCount > 0 || summary.draftPagesCount > 0) {
      juzSummaries.push(summary);
    }
  }

  const activeJuz =
    juzSummaries.find((j) => !j.isComplete)?.juzNumber ??
    (juzSummaries.length > 0 ? Math.min(30, juzSummaries[juzSummaries.length - 1].juzNumber + 1) : 1);

  const radar = computeRadarMetrics({ assessments });
  const prediction = computeCompletionPrediction({
    assessments,
    activeJuzNumber: activeJuz,
    pagesPerJuz: mushaf.default_pages_per_juz,
  });

  const targets = db
    .prepare(`SELECT * FROM hafalan_targets WHERE student_id = ? ORDER BY target_date DESC`)
    .all(studentId) as HafalanTargetRecord[];

  const schedules = db
    .prepare(`SELECT * FROM murojaah_schedules WHERE student_id = ? ORDER BY scheduled_date ASC`)
    .all(studentId) as MurojaahScheduleRecord[];

  const analysesRaw = db
    .prepare(`SELECT * FROM ai_analyses WHERE student_id = ? ORDER BY created_at DESC LIMIT 10`)
    .all(studentId) as (Omit<AIAnalysisRecord, 'insights' | 'recommendations' | 'prediction' | 'is_live_ai'> & {
    insights: string;
    recommendations: string;
    prediction: string | null;
    is_live_ai: number;
  })[];

  const aiAnalyses: AIAnalysisRecord[] = analysesRaw.map((a) => ({
    ...a,
    insights: JSON.parse(a.insights),
    recommendations: JSON.parse(a.recommendations),
    prediction: a.prediction ? JSON.parse(a.prediction) : null,
    is_live_ai: Boolean(a.is_live_ai),
  }));

  const badges = db
    .prepare(
      `SELECT b.*, sb.earned_at
       FROM student_badges sb
       JOIN badges b ON b.id = sb.badge_id
       WHERE sb.student_id = ?
       ORDER BY sb.earned_at DESC`
    )
    .all(studentId) as BadgeRecord[];

  const audioAttachments = getStudentAudioAttachments(studentId, viewerProfileId, canListenAudio);

  // Totals
  const completedJuzCount = juzSummaries.filter((j) => j.isComplete).length;
  const totalZiyadahPages = juzSummaries.reduce((s, j) => s + j.assessedPagesCount, 0);
  const officialZiyadah = assessments.filter(
    (a) =>
      a.session_type === 'ziyadah' &&
      (a.session_status === 'published' || a.session_status === 'corrected')
  );
  const averageScore =
    officialZiyadah.length > 0
      ? Math.round((officialZiyadah.reduce((s, a) => s + a.score, 0) / officialZiyadah.length) * 100) / 100
      : null;

  return {
    student,
    mushaf,
    summary: {
      completedJuzCount,
      totalZiyadahPages,
      averageScore,
      totalSessionsCount: sessions.filter((s) => s.status !== 'draft').length,
      totalMurojaahCount: sessions.filter((s) => s.session_type === 'murojaah' && s.status !== 'draft').length,
      activeJuz,
    },
    juzSummaries,
    sessions,
    radar,
    prediction,
    targets,
    schedules,
    aiAnalyses,
    badges,
    audioAttachments,
  };
}

export function evaluateAndAwardBadges(studentId: string): string[] {
  const mushaf = getActiveMushafSetting();
  const assessments = getStudentAssessments(studentId);
  const official = assessments.filter(
    (a) => a.session_status === 'published' || a.session_status === 'corrected'
  );
  const ziyadah = official.filter((a) => a.session_type === 'ziyadah');
  const murojaahSessions = new Set(
    official.filter((a) => a.session_type === 'murojaah').map((a) => a.session_id)
  );
  const activeDates = new Set(official.map((a) => a.session_date));
  const uniquePages = new Set(ziyadah.map((a) => `${a.juz_number}:${a.page_in_juz}`)).size;
  const avgScore =
    official.length > 0 ? official.reduce((s, a) => s + a.score, 0) / official.length : 0;

  let hasCompletedJuz = false;
  let hasPerfectJuz = false;
  for (let j = 1; j <= mushaf.total_juz; j++) {
    const sum = calculateJuzProgress(j, assessments, mushaf.default_pages_per_juz, mushaf.passing_threshold);
    if (sum.isComplete) {
      hasCompletedJuz = true;
      if (sum.totalScore >= mushaf.default_pages_per_juz * 5) hasPerfectJuz = true;
    }
  }

  const criteriaMatched: string[] = [];
  if (activeDates.size >= 7) criteriaMatched.push('streak_7');
  if (activeDates.size >= 30) criteriaMatched.push('streak_30');
  if (hasPerfectJuz) criteriaMatched.push('juz_100');
  if (murojaahSessions.size >= 5) criteriaMatched.push('murojaah_5');
  if (uniquePages >= 10) criteriaMatched.push('pages_10');
  if (hasCompletedJuz) criteriaMatched.push('juz_complete');
  if (official.length >= 5 && avgScore >= 4.5) criteriaMatched.push('avg_4_5');

  const newlyAwarded: string[] = [];
  const allBadges = db.prepare(`SELECT * FROM badges WHERE is_active = 1`).all() as BadgeRecord[];
  const checkStmt = db.prepare(`SELECT 1 FROM student_badges WHERE student_id = ? AND badge_id = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO student_badges (id, student_id, badge_id, earned_at) VALUES (?, ?, ?, ?)`
  );

  for (const b of allBadges) {
    if (criteriaMatched.includes(b.criteria)) {
      const exists = checkStmt.get(studentId, b.id);
      if (!exists) {
        insertStmt.run(crypto.randomUUID(), studentId, b.id, new Date().toISOString());
        newlyAwarded.push(b.badge_name);
      }
    }
  }
  return newlyAwarded;
}

export async function dispatchSessionNotifications(params: {
  studentId: string;
  sessionId: string;
  sessionType: SessionType;
  examType?: ExamType | null;
  semester?: SemesterType | null;
  className?: string | null;
  juzNumber: number;
  pagesLabel: string;
  avgScore: number;
  teacherName: string;
  newlyAwardedBadges: string[];
}): Promise<{ recipientProfileIds: string[] }> {
  const student = db
    .prepare(`SELECT id, full_name, profile_id FROM students WHERE id = ?`)
    .get(params.studentId) as { id: string; full_name: string; profile_id: string | null } | undefined;
  if (!student) return { recipientProfileIds: [] };

  const guardianRows = db
    .prepare(
      `SELECT p.id AS profile_id, p.full_name, p.phone
       FROM guardian_student_links gsl
       JOIN guardians g ON g.id = gsl.guardian_id
       JOIN profiles p ON p.id = g.profile_id
       WHERE gsl.student_id = ?`
    )
    .all(params.studentId) as { profile_id: string; full_name: string; phone: string | null }[];

  const recipientProfileIds: string[] = [];
  if (student.profile_id) recipientProfileIds.push(student.profile_id);
  for (const g of guardianRows) recipientProfileIds.push(g.profile_id);

  const now = new Date().toISOString();
  const jenisLabel =
    params.sessionType === 'tes_tahfidz'
      ? `Tes Tahfidz (${[params.examType, params.semester ? `Semester ${params.semester}` : null, params.className].filter(Boolean).join(' · ')})`
      : params.sessionType === 'ziyadah'
        ? 'Ziyadah'
        : 'Murojaah';
  const scoreFormatted = params.avgScore.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');

  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  );

  for (const pid of recipientProfileIds) {
    insertNotif.run(
      crypto.randomUUID(),
      pid,
      `Laporan ${jenisLabel} — ${student.full_name}`,
      `Assalamu'alaikum. Laporan ${jenisLabel.toLowerCase()} Juz ${params.juzNumber} (${params.pagesLabel}) oleh ${params.teacherName} telah dipublikasikan dengan rata-rata nilai ${scoreFormatted}.`,
      'setoran',
      params.sessionId,
      now
    );

    for (const badgeName of params.newlyAwardedBadges) {
      insertNotif.run(
        crypto.randomUUID(),
        pid,
        `Penghargaan Baru: ${badgeName}`,
        `Selamat! ${student.full_name} baru saja meraih lencana "${badgeName}".`,
        'badge',
        params.sessionId,
        now
      );
    }
  }

  // Cek kesiapan WhatsApp Gateway (server-side) untuk Wali Santri
  const providerRow = db
    .prepare(`SELECT value FROM system_settings WHERE key = 'whatsapp_provider'`)
    .get() as { value: string } | undefined;
  const provider = process.env.WHATSAPP_GATEWAY_PROVIDER || providerRow?.value || 'belum_dikonfigurasi';
  const gatewayUrl = process.env.WHATSAPP_GATEWAY_API_URL || '';
  const gatewayToken = process.env.WHATSAPP_GATEWAY_TOKEN || '';

  const insertWaLog = db.prepare(
    `INSERT INTO whatsapp_logs (id, recipient_profile_id, phone_number, message_preview, provider, status, error_detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const g of guardianRows) {
    const pref = db
      .prepare(`SELECT * FROM notification_preferences WHERE profile_id = ?`)
      .get(g.profile_id) as { whatsapp_enabled: number; whatsapp_consent_at: string | null; phone_number: string | null } | undefined;

    const targetPhone = pref?.phone_number || g.phone || '-';
    const messagePreview = `Assalamu'alaikum ${g.full_name}. Laporan ${jenisLabel.toLowerCase()} ${student.full_name} (Juz ${params.juzNumber}, ${params.pagesLabel}) telah diperbarui. Nilai: ${scoreFormatted}. Silakan masuk ke portal E-Tahfidz untuk detail.`;

    if (!pref?.whatsapp_enabled || !pref?.whatsapp_consent_at) {
      insertWaLog.run(
        crypto.randomUUID(),
        g.profile_id,
        targetPhone,
        messagePreview,
        provider,
        'ditunda_tanpa_izin',
        'Wali santri belum mengaktifkan persetujuan notifikasi WhatsApp.',
        now
      );
      continue;
    }

    if (provider === 'belum_dikonfigurasi' || !gatewayUrl || !gatewayToken) {
      insertWaLog.run(
        crypto.randomUUID(),
        g.profile_id,
        targetPhone,
        messagePreview,
        provider,
        'belum_dikonfigurasi',
        'Provider WhatsApp Gateway belum dikonfigurasi pada environment server.',
        now
      );
      continue;
    }

    try {
      const resp = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({ target: targetPhone, message: messagePreview }),
      });
      if (resp.ok) {
        insertWaLog.run(crypto.randomUUID(), g.profile_id, targetPhone, messagePreview, provider, 'terkirim', null, now);
      } else {
        insertWaLog.run(crypto.randomUUID(), g.profile_id, targetPhone, messagePreview, provider, 'gagal', `HTTP ${resp.status}`, now);
      }
    } catch (err) {
      insertWaLog.run(
        crypto.randomUUID(),
        g.profile_id,
        targetPhone,
        messagePreview,
        provider,
        'gagal',
        err instanceof Error ? err.message : 'Network error',
        now
      );
    }
  }

  return { recipientProfileIds };
}
