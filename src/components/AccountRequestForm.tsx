import React, { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, GraduationCap, Mail, Phone, Shield, User, Users } from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import {
  buildAccountRequestPayload,
  validateAccountRequestForm,
  type AccountRequestField,
} from '../lib/account-request-rules';
import type { PendingApplicationRecord, Profile, RequestableRole } from '../types/tahfidz';
import { PasswordFieldWithStrength } from './PasswordFieldWithStrength';

interface AccountRequestFormProps {
  onSubmitted: (user: Profile, token: string, application: PendingApplicationRecord) => void;
  onCancelToLogin: () => void;
}

const ROLE_OPTIONS: { id: RequestableRole; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'santri', label: 'Santri', icon: GraduationCap },
  { id: 'wali_santri', label: 'Wali Santri', icon: Users },
  { id: 'ustadz', label: 'Ustadz / Musyrif', icon: BookOpen },
];

export const AccountRequestForm: React.FC<AccountRequestFormProps> = ({
  onSubmitted,
  onCancelToLogin,
}) => {
  const [role, setRole] = useState<RequestableRole>('santri');
  const [fullName, setFullName] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [halaqahName, setHalaqahName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [classes, setClasses] = useState<{ id: string; class_name: string; level: string }[]>([]);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AccountRequestField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<{ classes: { id: string; class_name: string; level: string }[]; supabaseConfigured: boolean }>(
      '/api/public/classes'
    )
      .then((res) => {
        setClasses(res.classes || []);
        setSupabaseConfigured(Boolean(res.supabaseConfigured));
      })
      .catch(() => {
        // Ignore non-fatal class suggestion load failure
      });
  }, []);

  const clearFieldError = (field: AccountRequestField) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const formInput = {
      requested_role: role,
      full_name: fullName,
      identity_number: identityNumber,
      halaqah_name: halaqahName,
      phone,
      email,
      password,
      confirm_password: confirmPassword,
    };

    const validation = validateAccountRequestForm(formInput);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const payload = buildAccountRequestPayload(formInput);
      const res = await apiFetch<{
        token: string;
        user: Profile;
        application: PendingApplicationRecord;
        message: string;
      }>('/api/auth/request-account', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStoredToken(res.token);
      onSubmitted(res.user, res.token, res.application);
    } catch (err) {
      // Pertahankan seluruh input formulir apabila terjadi error jaringan atau server
      setServerError(
        err instanceof Error
          ? err.message
          : 'Gagal mengirim permohonan akun. Periksa koneksi jaringan Anda lalu coba lagi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-2">
          Pilih Jenis Akun yang Diajukan
        </span>
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
          {ROLE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = role === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={submitting}
                onClick={() => {
                  setRole(opt.id);
                  setFieldErrors({});
                  setServerError(null);
                }}
                className={`flex items-center justify-center gap-1 rounded-md px-1.5 sm:px-2.5 py-2 text-[11px] sm:text-xs font-semibold transition-colors text-center leading-tight min-w-0 ${
                  active
                    ? 'bg-white text-emerald-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0 hidden xs:inline sm:inline" aria-hidden="true" />
                <span className="truncate sm:whitespace-nowrap">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {serverError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      )}

      {/* Nama Lengkap */}
      <div>
        <label htmlFor="req-full-name" className="block text-sm font-medium text-slate-700 mb-1.5">
          {role === 'santri'
            ? 'Nama Lengkap Santri'
            : role === 'wali_santri'
              ? 'Nama Lengkap Wali Santri'
              : 'Nama Lengkap Ustadz / Musyrif'}{' '}
          <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="req-full-name"
            type="text"
            required
            disabled={submitting}
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              clearFieldError('full_name');
            }}
            placeholder={
              role === 'santri'
                ? 'Contoh: Muhammad Rayyan'
                : role === 'wali_santri'
                  ? 'Contoh: Bapak Ahmad Hidayat'
                  : 'Contoh: Ustadz Abdullah, Lc.'
            }
            className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
          />
        </div>
        {fieldErrors.full_name && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">
            {fieldErrors.full_name}
          </p>
        )}
      </div>

      {/* Kolom khusus Santri / Ustadz: NIS atau NIP & Halaqah */}
      {(role === 'santri' || role === 'ustadz') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="req-identity-number" className="block text-sm font-medium text-slate-700 mb-1.5">
              {role === 'santri' ? 'NIS' : 'NIP'} <span className="text-red-600">*</span>
            </label>
            <input
              id="req-identity-number"
              type="text"
              required
              disabled={submitting}
              value={identityNumber}
              onChange={(e) => {
                setIdentityNumber(e.target.value);
                clearFieldError('identity_number');
              }}
              placeholder={role === 'santri' ? 'Misal: 2026-0199' : 'Misal: UST-2026-010'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
            {fieldErrors.identity_number && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700">
                {fieldErrors.identity_number}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="req-halaqah" className="block text-sm font-medium text-slate-700 mb-1.5">
              Halaqah <span className="text-red-600">*</span>
            </label>
            <input
              id="req-halaqah"
              type="text"
              required
              disabled={submitting}
              list="req-halaqah-list"
              value={halaqahName}
              onChange={(e) => {
                setHalaqahName(e.target.value);
                clearFieldError('halaqah_name');
              }}
              placeholder="Pilih / tulis nama halaqah"
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
            <datalist id="req-halaqah-list">
              {classes.map((c) => (
                <option key={c.id} value={c.class_name} />
              ))}
            </datalist>
            {fieldErrors.halaqah_name && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700">
                {fieldErrors.halaqah_name}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Kolom khusus Wali Santri: Nomor HP / WhatsApp */}
      {role === 'wali_santri' && (
        <div>
          <label htmlFor="req-phone" className="block text-sm font-medium text-slate-700 mb-1.5">
            Nomor HP / WhatsApp <span className="text-red-600">*</span>
          </label>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              id="req-phone"
              type="tel"
              required
              disabled={submitting}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                clearFieldError('phone');
              }}
              placeholder="0812xxxxxxxx"
              className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>
          {fieldErrors.phone && (
            <p role="alert" className="mt-1 text-xs font-medium text-red-700">
              {fieldErrors.phone}
            </p>
          )}
        </div>
      )}

      {/* Email Login */}
      <div>
        <label htmlFor="req-email" className="block text-sm font-medium text-slate-700 mb-1.5">
          Email Login <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id="req-email"
            type="email"
            required
            disabled={submitting}
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError('email');
            }}
            placeholder="nama@email.com"
            className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
          />
        </div>
        {fieldErrors.email && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-700">
            {fieldErrors.email}
          </p>
        )}
      </div>

      {/* Password & Konfirmasi Password */}
      <PasswordFieldWithStrength
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={(val) => {
          setPassword(val);
          clearFieldError('password');
          clearFieldError('confirm_password');
        }}
        onConfirmPasswordChange={(val) => {
          setConfirmPassword(val);
          clearFieldError('confirm_password');
        }}
        passwordError={fieldErrors.password}
        confirmError={fieldErrors.confirm_password}
        disabled={submitting}
      />

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 flex items-start gap-2">
        <Shield className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          {supabaseConfigured
            ? 'Kredensial diproses langsung melalui Supabase Authentication dan tidak pernah disimpan sebagai teks biasa atau ditampilkan kepada administrator.'
            : 'Kredensial dienkripsi aman (siap terhubung ke Supabase Authentication) dan tidak pernah disimpan sebagai teks biasa atau ditampilkan kepada administrator.'}
        </span>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors"
      >
        {submitting ? 'Mengirim Permohonan...' : 'Ajukan Pembuatan Akun'}
      </button>

      <div className="text-center">
        <button
          type="button"
          onClick={onCancelToLogin}
          className="text-xs font-medium text-slate-600 hover:text-emerald-800 hover:underline"
        >
          Sudah punya akun aktif? Masuk di sini
        </button>
      </div>
    </form>
  );
};
