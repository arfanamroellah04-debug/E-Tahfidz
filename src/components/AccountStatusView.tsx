import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatTanggalWaktuWIB } from '../lib/formatters';
import type { PendingApplicationRecord, Profile } from '../types/tahfidz';

interface AccountStatusViewProps {
  user: Profile;
  application: PendingApplicationRecord | null;
  justSubmitted?: boolean;
  onRefreshStatus: () => Promise<void>;
  onApplicationUpdated: (user: Profile, application: PendingApplicationRecord | null) => void;
  onLogout: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  santri: 'Santri',
  wali_santri: 'Wali Santri',
  ustadz: 'Ustadz / Musyrif',
  admin: 'Administrator',
};

export const AccountStatusView: React.FC<AccountStatusViewProps> = ({
  user,
  application,
  justSubmitted = false,
  onRefreshStatus,
  onApplicationUpdated,
  onLogout,
}) => {
  const status = application?.status || user.account_status || 'pending';
  const role = application?.requested_role || user.role;

  const [refreshing, setRefreshing] = useState(false);
  const [fullName, setFullName] = useState(application?.full_name || user.full_name);
  const [identityNumber, setIdentityNumber] = useState(application?.identity_number || '');
  const [halaqahName, setHalaqahName] = useState(application?.halaqah_name || '');
  const [phone, setPhone] = useState(application?.phone || user.phone || '');
  const [savingRevision, setSavingRevision] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    setErrorMsg(null);
    try {
      await onRefreshStatus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memeriksa status permohonan.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleResubmitRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    setSavingRevision(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        user: Profile;
        application: PendingApplicationRecord;
        message: string;
      }>('/api/account-requests/me', {
        method: 'PUT',
        body: JSON.stringify({
          full_name: fullName,
          identity_number: role === 'santri' || role === 'ustadz' ? identityNumber : undefined,
          halaqah_name: role === 'santri' || role === 'ustadz' ? halaqahName : undefined,
          phone: role === 'wali_santri' ? phone : undefined,
        }),
      });
      setFeedback(res.message);
      onApplicationUpdated(res.user, res.application);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengirim perbaikan data.');
    } finally {
      setSavingRevision(false);
    }
  };

  const statusMeta =
    status === 'approved'
      ? {
          label: 'Disetujui (Approved)',
          tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
          icon: CheckCircle2,
          nextStep: 'Akun Anda telah aktif. Klik "Periksa Status Terbaru" untuk langsung masuk ke dashboard.',
        }
      : status === 'rejected'
        ? {
            label: 'Ditolak (Rejected)',
            tone: 'border-red-200 bg-red-50 text-red-900',
            icon: XCircle,
            nextStep:
              'Periksa alasan penolakan dari administrator di bawah, lalu perbaiki data Anda dan kirim ulang permohonan.',
          }
        : status === 'needs_revision'
          ? {
              label: 'Perlu Perbaikan Data',
              tone: 'border-amber-200 bg-amber-50 text-amber-950',
              icon: AlertTriangle,
              nextStep:
                'Administrator meminta perbaikan data permohonan. Lengkapi pembaruan pada formulir di bawah lalu ajukan ulang.',
            }
          : status === 'suspended'
            ? {
                label: 'Dinonaktifkan (Suspended)',
                tone: 'border-red-200 bg-red-50 text-red-900',
                icon: ShieldAlert,
                nextStep: 'Akses dashboard diblokir. Hubungi administrator pondok pesantren untuk informasi lebih lanjut.',
              }
            : {
                label: 'Menunggu Verifikasi (Pending)',
                tone: 'border-amber-200 bg-amber-50 text-amber-950',
                icon: Clock,
                nextStep:
                  'Administrator akan meninjau identitas Anda (NIS/NIP/Halaqah atau nomor wali). Setelah disetujui, Anda akan menerima pemberitahuan email dan dapat langsung mengakses dashboard.',
              };

  const StatusIcon = statusMeta.icon;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/download_109b25ba.png"
            alt="Logo Islamic Boarding School Darul Ulum"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
          />
          <span className="font-display text-base font-bold text-slate-900 whitespace-nowrap">
            E-Tahfidz
          </span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Keluar / Halaman Masuk</span>
        </button>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-6 sm:p-10 space-y-6">
        {justSubmitted && (
          <div
            role="status"
            className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-1.5"
          >
            <h2 className="font-display text-lg font-bold text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
              <span>Permohonan akun berhasil dikirim!</span>
            </h2>
            <p className="text-sm text-emerald-900 leading-relaxed">
              Terima kasih telah mengajukan pembuatan akun E-Tahfidz. Akun Anda sedang menunggu verifikasi administrator. Silakan lakukan verifikasi email apabila diminta.
            </p>
          </div>
        )}

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

        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Status Permohonan Akun
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Akses dashboard utama terkunci sampai administrator menyetujui permohonan akun Anda.
              </p>
            </div>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Periksa Status Terbaru</span>
            </button>
          </div>

          <div className={`rounded-lg border p-4 flex items-start gap-3 ${statusMeta.tone}`}>
            <StatusIcon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-bold">{statusMeta.label}</p>
              <p className="text-xs leading-relaxed">{statusMeta.nextStep}</p>
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
              <dt className="text-xs text-slate-500">Nama Pengguna</dt>
              <dd className="mt-1 font-semibold text-slate-900 break-words">{application?.full_name || user.full_name}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
              <dt className="text-xs text-slate-500">Jenis Akun</dt>
              <dd className="mt-1 font-semibold text-slate-900">{ROLE_LABELS[role] || role}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
              <dt className="text-xs text-slate-500">Email Terdaftar</dt>
              <dd className="mt-1 font-mono text-slate-900 break-all text-xs sm:text-sm">{application?.email || user.email}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
              <dt className="text-xs text-slate-500">Tanggal Permohonan</dt>
              <dd className="mt-1 font-mono text-slate-900 text-xs sm:text-sm">
                {formatTanggalWaktuWIB(application?.submitted_at || user.created_at)}
              </dd>
            </div>
            {application?.identity_number && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
                <dt className="text-xs text-slate-500">{role === 'ustadz' ? 'NIP' : 'NIS'}</dt>
                <dd className="mt-1 font-mono text-slate-900 break-all">{application.identity_number}</dd>
              </div>
            )}
            {application?.halaqah_name && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
                <dt className="text-xs text-slate-500">Halaqah</dt>
                <dd className="mt-1 font-semibold text-slate-900 break-words">{application.halaqah_name}</dd>
              </div>
            )}
            {application?.phone && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 min-w-0">
                <dt className="text-xs text-slate-500">Nomor HP / WhatsApp</dt>
                <dd className="mt-1 font-mono text-slate-900 break-all">{application.phone}</dd>
              </div>
            )}
          </dl>

          {application?.admin_notes && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1">
              <p className="text-xs font-semibold text-slate-700">Catatan Administrator</p>
              <p className="text-sm text-slate-900">{application.admin_notes}</p>
            </div>
          )}

          {/* Formulir Perbaikan jika Ditolak atau Perlu Perbaikan */}
          {(status === 'rejected' || status === 'needs_revision') && (
            <form onSubmit={handleResubmitRevision} className="pt-5 border-t border-slate-200 space-y-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Perbaiki Data Permohonan
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Perbarui identitas sesuai catatan administrator lalu kirim ulang untuk verifikasi.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rev-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Lengkap *
                  </label>
                  <input
                    id="rev-name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                {(role === 'santri' || role === 'ustadz') && (
                  <>
                    <div>
                      <label htmlFor="rev-id" className="block text-xs font-medium text-slate-700 mb-1">
                        {role === 'ustadz' ? 'NIP *' : 'NIS *'}
                      </label>
                      <input
                        id="rev-id"
                        required
                        value={identityNumber}
                        onChange={(e) => setIdentityNumber(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="rev-halaqah" className="block text-xs font-medium text-slate-700 mb-1">
                        Halaqah *
                      </label>
                      <input
                        id="rev-halaqah"
                        required
                        value={halaqahName}
                        onChange={(e) => setHalaqahName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}
                {role === 'wali_santri' && (
                  <div>
                    <label htmlFor="rev-phone" className="block text-xs font-medium text-slate-700 mb-1">
                      Nomor HP / WhatsApp *
                    </label>
                    <input
                      id="rev-phone"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={savingRevision}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {savingRevision ? 'Mengirim Perbaikan...' : 'Kirim Perbaikan & Ajukan Ulang'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
};
