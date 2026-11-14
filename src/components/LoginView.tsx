import React, { useState } from 'react';
import { BookOpen, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import type { PendingApplicationRecord, Profile } from '../types/tahfidz';
import { AccountRequestForm } from './AccountRequestForm';

interface LoginViewProps {
  onSuccess: (user: Profile, token: string, application?: PendingApplicationRecord | null, justSubmitted?: boolean) => void;
}

const DEMO_ACCOUNTS = [
  {
    roleLabel: 'Admin Lembaga',
    name: 'H. Ridwan Kamil, S.Pd.I',
    email: 'admin@etahfidz.id',
    note: 'Kelola santri, kelas, relasi wali, mushaf & audit log',
  },
  {
    roleLabel: 'Ustadz / Musyrif',
    name: 'Ustadz Ahmad Fauzi, Lc.',
    email: 'ustadz.ahmad@etahfidz.id',
    note: 'Input setoran ziyadah/murojaah, nilai halaman & audio',
  },
  {
    roleLabel: 'Wali Santri',
    name: 'Bpk. Budi Santoso',
    email: 'wali.budi@etahfidz.id',
    note: 'Pantau 2 anak (Zaid & Fatimah), grafik & notifikasi live',
  },
  {
    roleLabel: 'Santri',
    name: 'Zaid Al-Farisi',
    email: 'santri.zaid@etahfidz.id',
    note: 'Progres hafalan pribadi, jadwal murojaah & lencana',
  },
];

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'request'>('login');
  const [email, setEmail] = useState('ustadz.ahmad@etahfidz.id');
  const [password, setPassword] = useState('Tahfidz2026!');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // Reset Password Modal
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetStep, setResetStep] = useState<'email' | 'confirm'>('email');
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const performLogin = async (targetEmail: string, targetPassword: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        user: Profile;
        token: string;
        application?: PendingApplicationRecord | null;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: targetPassword }),
      });
      setStoredToken(res.token);
      onSuccess(res.user, res.token, res.application ?? null, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void performLogin(email, password);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: resetEmail,
          new_password: resetStep === 'confirm' ? resetNewPass : undefined,
        }),
      });
      setResetMsg(res.message);
      if (resetStep === 'email') {
        setResetStep('confirm');
      } else {
        setTimeout(() => {
          setShowReset(false);
          setResetStep('email');
          setResetNewPass('');
        }, 1200);
      }
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : 'Gagal memproses reset kata sandi.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Kolom Kiri: Visual Editorial Lembaga */}
      <div className="relative lg:w-1/2 bg-slate-900 text-white flex flex-col justify-between overflow-hidden min-h-[280px] lg:min-h-screen">
        {!imgError ? (
          <img
            src="/src/assets/images/login_study_hall_1794618126835.jpg"
            alt="Suasana halaqah tahfidz Al-Qur'an di ruang belajar pondok pesantren"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 flex items-center justify-center">
            <BookOpen className="w-24 h-24 text-emerald-500/20" aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-slate-950/35" />

        <div className="relative z-10 p-6 sm:p-10 flex items-center gap-3">
          <img
            src="/assets/aistudio/download_109b25ba.png"
            alt="Logo Islamic Boarding School Darul Ulum"
            referrerPolicy="no-referrer"
            className="w-11 h-11 rounded-xl object-contain p-0.5 border border-white/20 bg-white"
          />
          <div>
            <span className="font-display text-xl font-bold tracking-tight text-white">E-Tahfidz</span>
            <p className="text-xs text-slate-300">Islamic Boarding School Darul Ulum</p>
          </div>
        </div>

        <div className="relative z-10 p-6 sm:p-10 max-w-xl">
          <p className="text-xs font-medium tracking-wide text-amber-300 mb-2">
            Sistem Terintegrasi Ustadz · Wali Santri · Santri · Admin
          </p>
          <h1 className="font-display text-2xl sm:text-4xl font-bold leading-tight text-white">
            Penilaian Hafalan Al-Qur&apos;an yang Terukur, Transparan, dan Real-Time
          </h1>
          <p className="mt-4 text-sm sm:text-base text-slate-200 leading-relaxed">
            Pantau setoran ziyadah per halaman, penguatan murojaah berbasis spaced repetition, catatan tajwid dan makhraj, hingga analisis perkembangan berbasis AI dalam satu platform.
          </p>
          <div className="mt-6 pt-5 border-t border-white/15 grid grid-cols-3 gap-4 text-xs text-slate-200">
            <div>
              <span className="block font-mono text-base font-semibold text-white">100</span>
              <span>Maks. Nilai Per Juz</span>
            </div>
            <div>
              <span className="block font-mono text-base font-semibold text-white">4 Peran</span>
              <span>Kontrol Akses RLS</span>
            </div>
            <div>
              <span className="block font-mono text-base font-semibold text-white">Real-Time</span>
              <span>Sinkronisasi Wali</span>
            </div>
          </div>
        </div>
      </div>

      {/* Kolom Kanan: Formulir Masuk, Request Akun & Akun Demo */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Masuk Akun
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('request');
                setError(null);
              }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'request'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Request Akun</span>
            </button>
          </div>

          {mode === 'request' ? (
            <>
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Request Akun E-Tahfidz
                </h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  Ajukan akun Santri, Wali Santri, atau Ustadz/Musyrif. Akun akan aktif setelah diverifikasi administrator.
                </p>
              </div>
              <AccountRequestForm
                onSubmitted={(reqUser, token, application) =>
                  onSuccess(reqUser, token, application, true)
                }
                onCancelToLogin={() => setMode('login')}
              />
            </>
          ) : (
            <>
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">Masuk ke Akun E-Tahfidz</h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  Gunakan email dan kata sandi resmi atau pilih salah satu akun data demo untuk pengujian.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Alamat Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@etahfidz.id"
                      className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
                      Kata Sandi
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowReset(true)}
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                    >
                      Lupa kata sandi?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      aria-label={showPass ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors"
                >
                  {loading ? 'Memverifikasi akun...' : 'Masuk ke Dashboard'}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setMode('request')}
                    className="text-xs font-semibold text-emerald-800 hover:underline"
                  >
                    Belum punya akun? Ajukan Request Akun Baru
                  </button>
                </div>
              </form>

              {/* Data Demo Pengujian */}
              <div className="pt-5 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                    Data Demo Pengujian (Kata sandi: Tahfidz2026!)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {DEMO_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setEmail(acc.email);
                        setPassword('Tahfidz2026!');
                        void performLogin(acc.email, 'Tahfidz2026!');
                      }}
                      className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-500 hover:bg-emerald-50/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-800">{acc.roleLabel}</span>
                        <ShieldCheck className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-900 truncate">{acc.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{acc.note}</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Reset Kata Sandi */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-slate-900">
              <KeyRound className="w-5 h-5 text-emerald-700" aria-hidden="true" />
              <h3 className="font-display text-lg font-bold">Pemulihan Kata Sandi</h3>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Masukkan alamat email terdaftar Anda untuk verifikasi pemulihan akses akun.
            </p>
            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              {resetMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {resetMsg}
                </div>
              )}
              <div>
                <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Email Akun
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="contoh@etahfidz.id"
                />
              </div>
              {resetStep === 'confirm' && (
                <div>
                  <label htmlFor="reset-new-pass" className="block text-xs font-medium text-slate-700 mb-1">
                    Kata Sandi Baru (Minimal 6 Karakter)
                  </label>
                  <input
                    id="reset-new-pass"
                    type="password"
                    required
                    minLength={6}
                    value={resetNewPass}
                    onChange={(e) => setResetNewPass(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowReset(false);
                    setResetStep('email');
                    setResetMsg(null);
                  }}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  {resetStep === 'email' ? 'Verifikasi Email' : 'Simpan Kata Sandi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
