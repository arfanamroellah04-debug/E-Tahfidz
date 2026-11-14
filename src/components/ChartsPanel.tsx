import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNilaiID, formatTanggalID } from '../lib/formatters';
import type {
  HafalanSessionRecord,
  JuzProgressSummary,
  RadarSkillMetrics,
} from '../types/tahfidz';

interface ChartsPanelProps {
  sessions: HafalanSessionRecord[];
  juzSummaries: JuzProgressSummary[];
  radar: RadarSkillMetrics;
  passingThreshold: number;
  pagesPerJuz: number;
}

export const ChartsPanel: React.FC<ChartsPanelProps> = ({
  sessions,
  juzSummaries,
  radar,
  passingThreshold,
  pagesPerJuz,
}) => {
  const [typeFilter, setTypeFilter] = useState<'semua' | 'ziyadah' | 'murojaah' | 'tes_tahfidz'>('semua');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedJuz, setSelectedJuz] = useState<number>(
    juzSummaries[juzSummaries.length - 1]?.juzNumber ?? 1
  );

  const officialSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.status === 'draft') return false;
      if (typeFilter !== 'semua' && s.session_type !== typeFilter) return false;
      if (dateFrom && s.session_date < dateFrom) return false;
      if (dateTo && s.session_date > dateTo) return false;
      return true;
    });
  }, [sessions, typeFilter, dateFrom, dateTo]);

  // A. Grafik Perkembangan Nilai per Sesi / Tanggal
  const trendData = useMemo(() => {
    return [...officialSessions]
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
      .map((s) => {
        const avg =
          s.assessments.length > 0
            ? s.assessments.reduce((acc, p) => acc + p.score, 0) / s.assessments.length
            : 0;
        return {
          tanggal: formatTanggalID(s.session_date),
          rawDate: s.session_date,
          nilai: Math.round(avg * 100) / 100,
          jenis:
            s.session_type === 'ziyadah'
              ? 'Ziyadah'
              : s.session_type === 'tes_tahfidz'
                ? `Tes Tahfidz (${s.exam_type || 'Ujian'})`
                : 'Murojaah',
          juz: `Juz ${s.juz_number}`,
        };
      });
  }, [officialSessions]);

  // B. Grafik Nilai Per Juz
  const juzChartData = useMemo(() => {
    return juzSummaries.map((j) => ({
      name: `Juz ${j.juzNumber}`,
      nilai: j.totalScore,
      maksSaatIni: j.maxPossibleCurrent,
      halaman: `${j.assessedPagesCount}/${j.pagesPerJuz}`,
    }));
  }, [juzSummaries]);

  // C. Grafik Nilai Per Halaman (1..pagesPerJuz)
  const pageChartData = useMemo(() => {
    const activeJuzSummary = juzSummaries.find((j) => j.juzNumber === selectedJuz);
    return Array.from({ length: pagesPerJuz }, (_, idx) => {
      const p = idx + 1;
      const rec = activeJuzSummary?.activePages[p];
      return {
        halaman: `H.${p}`,
        nilai: rec ? rec.score : null,
        kelancaran: rec ? rec.fluency_score : null,
        tajwid: rec ? rec.tajwid_score : null,
      };
    });
  }, [juzSummaries, selectedJuz, pagesPerJuz]);

  // D. Radar Chart Kemampuan Hafalan (0-100)
  const radarData = useMemo(
    () => [
      { aspek: 'Kelancaran', skor: radar.kelancaran },
      { aspek: 'Tajwid', skor: radar.tajwid },
      { aspek: 'Makhraj', skor: radar.makhraj },
      { aspek: 'Konsistensi', skor: radar.konsistensi },
      { aspek: 'Kecepatan', skor: radar.kecepatan },
    ],
    [radar]
  );

  // E. Grafik Konsistensi Ziyadah, Murojaah & Tes Tahfidz per Tanggal
  const consistencyData = useMemo(() => {
    const byDate = new Map<string, { date: string; ziyadah: number; murojaah: number; tes: number }>();
    for (const s of officialSessions) {
      const entry = byDate.get(s.session_date) ?? {
        date: s.session_date,
        ziyadah: 0,
        murojaah: 0,
        tes: 0,
      };
      if (s.session_type === 'ziyadah') entry.ziyadah += s.assessments.length;
      else if (s.session_type === 'tes_tahfidz') entry.tes += s.assessments.length;
      else entry.murojaah += s.assessments.length;
      byDate.set(s.session_date, entry);
    }
    return Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        tanggal: formatTanggalID(d.date),
        Ziyadah: d.ziyadah,
        Murojaah: d.murojaah,
        'Tes Tahfidz': d.tes,
      }));
  }, [officialSessions]);

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['semua', 'ziyadah', 'murojaah', 'tes_tahfidz'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t === 'semua'
                ? 'Semua Setoran'
                : t === 'ziyadah'
                  ? 'Ziyadah'
                  : t === 'murojaah'
                    ? 'Murojaah'
                    : 'Tes Tahfidz'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-slate-600">Dari</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Filter tanggal mulai"
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
          />
          <label className="text-slate-600">Sampai</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Filter tanggal akhir"
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="text-emerald-700 font-medium hover:underline px-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Grid Grafik Utama */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* A. Tren Nilai Setoran */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Perkembangan Rata-Rata Nilai Setoran
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Skala 0 – 5 per sesi resmi · Diperbarui otomatis dari penilaian ustadz
            </p>
          </div>
          {trendData.length === 0 ? (
            <EmptyChartState text="Belum ada data setoran resmi pada rentang filter ini." />
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                <AreaChart data={trendData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="tanggal" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip
                    formatter={(value: unknown) => [formatNilaiID(Number(value)), 'Rata-rata Nilai']}
                  />
                  <Area
                    type="monotone"
                    dataKey="nilai"
                    stroke="#059669"
                    strokeWidth={2.5}
                    fill="url(#emeraldGrad)"
                    dot={{ r: 3.5, fill: '#059669', strokeWidth: 1.5, stroke: '#ffffff' }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* D. Radar Kemampuan Hafalan */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Radar Profil Kemampuan Hafalan (Skala 0–100)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Dihitung dari skor komponen kelancaran, tajwid, makhraj &amp; frekuensi setoran riil
            </p>
          </div>
          {radar.sampleCount === 0 ? (
            <EmptyChartState text="Belum ada data penilaian komponen untuk membentuk radar kemampuan." />
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="aspek" tick={{ fontSize: 11, fill: '#334155' }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Radar
                    name="Skor Santri"
                    dataKey="skor"
                    stroke="#0f172a"
                    strokeWidth={2}
                    fill="#059669"
                    fillOpacity={0.35}
                    isAnimationActive={false}
                  />
                  <Tooltip formatter={(v: unknown) => [`${v}/100`, 'Indikator']} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* B. Grafik Nilai Per Juz */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Total Nilai Ziyadah Per Juz
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Ambang kelulusan lembaga: {passingThreshold} · Nilai maksimal 100 per juz lengkap
            </p>
          </div>
          {juzChartData.length === 0 ? (
            <EmptyChartState text="Belum ada juz dengan setoran ziyadah resmi." />
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                <BarChart data={juzChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis domain={[0, pagesPerJuz * 5]} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip
                    formatter={(val: unknown, name: unknown) => [
                      formatNilaiID(Number(val)),
                      String(name) === 'nilai' ? 'Nilai Terkumpul' : String(name ?? ''),
                    ]}
                  />
                  <ReferenceLine
                    y={passingThreshold}
                    stroke="#d97706"
                    strokeDasharray="4 4"
                    label={{ value: `Ambang ${passingThreshold}`, position: 'insideTopRight', fontSize: 10, fill: '#b45309' }}
                  />
                  <Bar dataKey="nilai" fill="#0f172a" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* C. Grafik Nilai Per Halaman (1-20) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                Grafik Nilai Per Halaman (1–{pagesPerJuz})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Halaman belum disetorkan tidak bernilai 0
              </p>
            </div>
            {juzSummaries.length > 0 && (
              <select
                value={selectedJuz}
                onChange={(e) => setSelectedJuz(Number(e.target.value))}
                aria-label="Pilih Juz untuk grafik halaman"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
              >
                {juzSummaries.map((j) => (
                  <option key={j.juzNumber} value={j.juzNumber}>
                    Juz {j.juzNumber} ({j.assessedPagesCount}/{j.pagesPerJuz})
                  </option>
                ))}
              </select>
            )}
          </div>
          {juzSummaries.length === 0 ? (
            <EmptyChartState text="Pilih juz yang sudah memiliki setoran ziyadah untuk melihat nilai per halaman." />
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                <BarChart data={pageChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="halaman" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(val: unknown) => [formatNilaiID(Number(val)), 'Nilai Resmi']} />
                  <Bar dataKey="nilai" fill="#059669" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      {/* E. Grafik Konsistensi Ziyadah & Murojaah */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Konsistensi Aktivitas Ziyadah &amp; Murojaah
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Jumlah halaman disetorkan per tanggal aktif (ziyadah dipisah dari murojaah)
          </p>
        </div>
        {consistencyData.length === 0 ? (
          <EmptyChartState text="Belum ada catatan aktivitas setoran pada filter terpilih." />
        ) : (
          <div className="h-56 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <BarChart data={consistencyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="tanggal" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Ziyadah" fill="#059669" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Murojaah" fill="#d97706" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Tes Tahfidz" fill="#0f172a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
};

const EmptyChartState: React.FC<{ text: string }> = ({ text }) => (
  <div className="h-56 flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500">
    {text}
  </div>
);
