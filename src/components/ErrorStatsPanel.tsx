import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api';

interface ErrorStatsPayload {
  topErrors: { id: string; tag_name: string; category: string; count: number }[];
  byCategory: { category: string; count: number }[];
  byJuz: { juz_number: number; count: number }[];
  beforeAfter: { session_type: string; error_count: number; page_count: number }[];
}

export const ErrorStatsPanel: React.FC<{ studentId?: string }> = ({ studentId }) => {
  const [stats, setStats] = useState<ErrorStatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
    apiFetch<ErrorStatsPayload>(`/api/error-stats${qs}`)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) {
    return <div className="h-56 rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Kesalahan Tajwid, Makhraj &amp; Kelancaran Terbanyak
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">
            Dihitung dari tag evaluasi ustadz pada setoran resmi
          </p>
          {stats.topErrors.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">Belum ada tag kesalahan tercatat.</p>
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
                <BarChart data={stats.topErrors} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis
                    type="category"
                    dataKey="tag_name"
                    width={150}
                    tick={{ fontSize: 11, fill: '#334155' }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    name="Jumlah"
                    fill="#d97706"
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Distribusi Kategori &amp; Perbandingan Ziyadah vs Murojaah
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Membantu memantau penurunan kesalahan setelah kegiatan murojaah
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {stats.byCategory.map((cat) => (
              <div key={cat.category} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="block text-xs text-slate-500">{cat.category}</span>
                <span className="mt-1 block font-mono text-lg font-bold text-slate-900">
                  {cat.count} temuan
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <h4 className="text-xs font-semibold text-slate-800 mb-2">
              Frekuensi Kesalahan Sebelum (Ziyadah) vs Sesudah (Murojaah)
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {stats.beforeAfter.map((row) => {
                const rate = row.page_count > 0 ? (row.error_count / row.page_count).toFixed(2) : '0';
                return (
                  <div key={row.session_type} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <span className="font-semibold capitalize text-slate-900">{row.session_type}</span>
                    <p className="text-slate-600 mt-1 font-mono">
                      {row.error_count} kesalahan / {row.page_count} hal. ({rate.replace('.', ',')}/hal)
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {stats.byJuz.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-800 mb-2">Kesalahan Berdasarkan Juz</h4>
              <div className="flex flex-wrap gap-3 text-xs text-slate-700">
                {stats.byJuz.map((j) => (
                  <span key={j.juz_number} className="font-mono">
                    Juz {j.juz_number}: <strong>{j.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
