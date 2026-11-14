import { GoogleGenAI, Type } from '@google/genai';
import type { CompletionPrediction, PageAssessmentRecord } from '../types/tahfidz.ts';

export interface AIStudentContext {
  studentName: string;
  analysisType: string;
  periodStart: string;
  periodEnd: string;
  totalZiyadahPages: number;
  totalMurojaahSessions: number;
  averageZiyadahScore: number | null;
  averageMurojaahScore: number | null;
  topErrors: { tag_name: string; category: string; count: number }[];
  weakPages: { juz: number; page: number; score: number; notes: string | null }[];
  recentNotes: string[];
  prediction: CompletionPrediction;
  activeTargetSummary: string;
}

export interface AIAnalysisResult {
  insights: {
    kelancaran: string;
    kelemahan: string;
    konsistensi: string;
  };
  recommendations: string[];
  confidence_level: 'rendah' | 'sedang' | 'tinggi';
  model_name: string;
  is_live_ai: boolean;
  notice?: string;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length >= 10);
}

/**
 * Menghasilkan analisis berbasis AI Gemini (model: gemini-4-hydrogen) dari data riil database.
 * Jika GEMINI_API_KEY belum dikonfigurasi, tidak mengarang klaim AI aktif—mengembalikan
 * analisis statistik deterministik berlabel `is_live_ai: false` beserta status konfigurasi.
 */
export async function generateTahfidzAnalysis(ctx: AIStudentContext): Promise<AIAnalysisResult> {
  const ai = getGeminiClient();

  if (!ai) {
    return buildDeterministicFallback(
      ctx,
      'Integrasi Gemini AI belum dikonfigurasi pada environment server (GEMINI_API_KEY belum tersedia). Ringkasan di bawah dihitung secara deterministik dari data database.'
    );
  }

  try {
    const prompt = `
Anda adalah Asisten Analisis Akademik Tahfidz Al-Qur'an untuk aplikasi E-Tahfidz.
Tugas Anda: Analisis data perkembangan hafalan santri berikut secara objektif, akurat, dan memotivasi dalam Bahasa Indonesia yang santun.

ATURAN KETAT:
1. HANYA gunakan angka, juz, halaman, dan catatan yang tertera pada DATA NYATA di bawah ini. DILARANG mengarang nilai, halaman, atau kesalahan yang tidak ada.
2. Jika data prediksi menyatakan "insufficientData: true", jangan membuat perkiraan tanggal selesai; sampaikan bahwa data observasi masih belum mencukupi.
3. Jangan menyatakan atau menyarankan perubahan nilai resmi ustadz; AI hanya memberi rekomendasi pembelajaran.
4. Sesuaikan fokus dengan jenis analisis: "${ctx.analysisType}".

DATA NYATA SANTRI (${ctx.periodStart} s.d. ${ctx.periodEnd}):
${JSON.stringify(ctx, null, 2)}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Berikan keluaran JSON yang ringkas, jelas, akurat berdasarkan fakta database, dan berfokus pada perbaikan tajwid, makhraj, kelancaran, serta jadwal murojaah.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            kelancaran: { type: Type.STRING, description: 'Ringkasan analisis kelancaran & tren nilai santri.' },
            kelemahan: { type: Type.STRING, description: 'Analisis pola kesalahan tajwid/makhraj dan halaman bernilai rendah.' },
            konsistensi: { type: Type.STRING, description: 'Analisis konsistensi setoran ziyadah dan murojaah.' },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 sampai 5 rekomendasi konkret pembelajaran berdasarkan data.',
            },
            confidence_level: {
              type: Type.STRING,
              description: 'Salah satu dari: rendah, sedang, tinggi.',
            },
          },
          required: ['kelancaran', 'kelemahan', 'konsistensi', 'recommendations', 'confidence_level'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      kelancaran?: string;
      kelemahan?: string;
      konsistensi?: string;
      recommendations?: string[];
      confidence_level?: string;
    };

    const conf =
      parsed.confidence_level === 'tinggi' ||
      parsed.confidence_level === 'sedang' ||
      parsed.confidence_level === 'rendah'
        ? parsed.confidence_level
        : ctx.prediction.confidenceLevel;

    return {
      insights: {
        kelancaran: parsed.kelancaran || 'Belum ada ringkasan kelancaran.',
        kelemahan: parsed.kelemahan || 'Belum ditemukan pola kelemahan menonjol.',
        konsistensi: parsed.konsistensi || 'Konsistensi setoran tercatat baik.',
      },
      recommendations:
        Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0
          ? parsed.recommendations.slice(0, 6)
          : ['Pertahankan jadwal murojaah rutin pada halaman dengan nilai di bawah 4,5.'],
      confidence_level: conf,
      model_name: 'gemini-4-hydrogen',
      is_live_ai: true,
    };
  } catch (error) {
    console.error('Gemini AI analysis error:', error);
    return buildDeterministicFallback(
      ctx,
      'Panggilan ke layanan Gemini AI gagal sementara. Menampilkan ringkasan statistik deterministik dari data database.'
    );
  }
}

function buildDeterministicFallback(ctx: AIStudentContext, notice: string): AIAnalysisResult {
  const weakList = ctx.weakPages
    .slice(0, 3)
    .map((w) => `Juz ${w.juz} Hal. ${w.page} (${w.score.toString().replace('.', ',')})`)
    .join(', ');
  const topErr = ctx.topErrors[0];

  const kelancaran =
    ctx.totalZiyadahPages === 0
      ? `Belum ada setoran ziyadah resmi untuk ${ctx.studentName} pada periode ${ctx.periodStart} s.d. ${ctx.periodEnd}.`
      : `Berdasarkan ${ctx.totalZiyadahPages} halaman ziyadah resmi pada periode ${ctx.periodStart} s.d. ${ctx.periodEnd}, rata-rata nilai ziyadah ${ctx.studentName} adalah ${ctx.averageZiyadahScore?.toString().replace('.', ',') ?? '-'} dari skala 5.${weakList ? ` Bagian yang perlu perhatian lebih: ${weakList}.` : ''}`;

  const kelemahan = topErr
    ? `Tag kesalahan yang paling sering tercatat oleh ustadz adalah "${topErr.tag_name}" (${topErr.category}, ${topErr.count} kali). Disarankan melatih pengulangan khusus pada bagian tersebut.`
    : 'Belum ada tag kesalahan berulang yang tercatat pada periode pengamatan ini.';

  const konsistensi = `Tercatat ${ctx.totalMurojaahSessions} sesi murojaah pada periode pengamatan${ctx.averageMurojaahScore !== null ? ` dengan rata-rata nilai ${ctx.averageMurojaahScore.toString().replace('.', ',')}` : ''}. ${ctx.activeTargetSummary}`;

  const recommendations: string[] = [];
  if (ctx.weakPages.length > 0) {
    recommendations.push(
      `Prioritaskan murojaah pada ${ctx.weakPages.slice(0, 3).map((w) => `Juz ${w.juz} Hal. ${w.page}`).join(', ')}.`
    );
  }
  if (topErr) {
    recommendations.push(
      `Fokus perbaikan ${topErr.category}: perbaiki "${topErr.tag_name}" sebelum menambah halaman baru.`
    );
  }
  if (ctx.totalMurojaahSessions < 3) {
    recommendations.push('Tingkatkan frekuensi murojaah minimal 3 kali per pekan untuk menjaga kekuatan hafalan lama.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Pertahankan ritme setoran dan murojaah rutin sesuai target yang ditetapkan ustadz.');
  }

  return {
    insights: { kelancaran, kelemahan, konsistensi },
    recommendations,
    confidence_level: ctx.prediction.confidenceLevel,
    model_name: 'stat-engine-fallback (non-AI)',
    is_live_ai: false,
    notice,
  };
}

export function buildAIContextFromAssessments(params: {
  studentName: string;
  analysisType: string;
  assessments: PageAssessmentRecord[];
  prediction: CompletionPrediction;
  activeTargetSummary: string;
}): AIStudentContext {
  const official = params.assessments.filter(
    (a) => a.session_status === 'published' || a.session_status === 'corrected'
  );
  const ziyadah = official.filter((a) => a.session_type === 'ziyadah');
  const murojaah = official.filter((a) => a.session_type === 'murojaah');

  const dates = official.map((a) => a.session_date).sort();
  const periodStart = dates[0] ?? new Date().toISOString().slice(0, 10);
  const periodEnd = dates[dates.length - 1] ?? periodStart;

  const avgZ =
    ziyadah.length > 0
      ? Math.round((ziyadah.reduce((s, a) => s + a.score, 0) / ziyadah.length) * 100) / 100
      : null;
  const avgM =
    murojaah.length > 0
      ? Math.round((murojaah.reduce((s, a) => s + a.score, 0) / murojaah.length) * 100) / 100
      : null;

  const errCounts = new Map<string, { tag_name: string; category: string; count: number }>();
  for (const a of official) {
    for (const e of a.errors ?? []) {
      const prev = errCounts.get(e.tag_name);
      if (prev) prev.count += 1;
      else errCounts.set(e.tag_name, { tag_name: e.tag_name, category: e.category, count: 1 });
    }
  }
  const topErrors = Array.from(errCounts.values()).sort((a, b) => b.count - a.count).slice(0, 5);

  const weakPages = [...official]
    .filter((a) => a.score < 4.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((a) => ({
      juz: a.juz_number,
      page: a.page_in_juz,
      score: a.score,
      notes: a.notes,
    }));

  const recentNotes = official
    .filter((a) => a.notes)
    .slice(0, 5)
    .map((a) => `Juz ${a.juz_number} Hal ${a.page_in_juz}: ${a.notes}`);

  return {
    studentName: params.studentName,
    analysisType: params.analysisType,
    periodStart,
    periodEnd,
    totalZiyadahPages: new Set(ziyadah.map((a) => `${a.juz_number}:${a.page_in_juz}`)).size,
    totalMurojaahSessions: new Set(murojaah.map((a) => a.session_id)).size,
    averageZiyadahScore: avgZ,
    averageMurojaahScore: avgM,
    topErrors,
    weakPages,
    recentNotes,
    prediction: params.prediction,
    activeTargetSummary: params.activeTargetSummary,
  };
}
