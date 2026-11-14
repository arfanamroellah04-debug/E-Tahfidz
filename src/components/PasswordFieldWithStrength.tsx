import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { evaluatePasswordStrength } from '../lib/account-request-rules';

interface PasswordFieldWithStrengthProps {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  passwordError?: string | null;
  confirmError?: string | null;
  disabled?: boolean;
  idPrefix?: string;
}

export const PasswordFieldWithStrength: React.FC<PasswordFieldWithStrengthProps> = ({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  passwordError,
  confirmError,
  disabled = false,
  idPrefix = 'req',
}) => {
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = evaluatePasswordStrength(password);
  const livePasswordError =
    passwordError || (password.length > 0 && password.length < 8 ? 'Password minimal 8 karakter.' : null);
  const liveConfirmError =
    confirmError ||
    (confirmPassword.length > 0 && password !== confirmPassword ? 'Konfirmasi password tidak sesuai.' : null);
  const passwordsMatch =
    password.length >= 8 && confirmPassword.length > 0 && password === confirmPassword;

  const barColor =
    strength.score === 0
      ? 'bg-red-500'
      : strength.score === 1
        ? 'bg-amber-500'
        : strength.score === 2
          ? 'bg-sky-600'
          : 'bg-emerald-600';

  const labelTone =
    strength.score === 0
      ? 'text-red-700'
      : strength.score === 1
        ? 'text-amber-700'
        : strength.score === 2
          ? 'text-sky-700'
          : 'text-emerald-700';

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-password`} className="block text-sm font-medium text-slate-700 mb-1.5">
          Password <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id={`${idPrefix}-password`}
            type={showPass ? 'text' : 'password'}
            required
            disabled={disabled}
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="Minimal 8 karakter (huruf & angka)"
            aria-invalid={Boolean(livePasswordError)}
            className={`w-full rounded-lg border bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
              livePasswordError
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-300 focus:border-emerald-600 focus:ring-emerald-600/20'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
          >
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {livePasswordError && (
          <p role="alert" className="mt-1.5 text-xs font-medium text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{livePasswordError}</span>
          </p>
        )}

        {/* Indikator kekuatan password & petunjuk */}
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">Kekuatan Password</span>
            <span className={`font-semibold ${password ? labelTone : 'text-slate-400'}`}>
              {password ? strength.label : 'Belum diisi'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5" aria-hidden="true">
            <div className={`h-1.5 rounded-sm transition-colors ${password && strength.score >= 1 ? barColor : password ? 'bg-red-400' : 'bg-slate-200'}`} />
            <div className={`h-1.5 rounded-sm transition-colors ${password && strength.score >= 2 ? barColor : 'bg-slate-200'}`} />
            <div className={`h-1.5 rounded-sm transition-colors ${password && strength.score >= 3 ? barColor : 'bg-slate-200'}`} />
          </div>
          <p className="text-xs text-slate-500">
            Petunjuk: Gunakan minimal 8 karakter dengan kombinasi huruf dan angka.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-confirm-password`} className="block text-sm font-medium text-slate-700 mb-1.5">
          Konfirmasi Password <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            id={`${idPrefix}-confirm-password`}
            type={showConfirm ? 'text' : 'password'}
            required
            disabled={disabled}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            placeholder="Ulangi password yang sama"
            aria-invalid={Boolean(liveConfirmError)}
            className={`w-full rounded-lg border bg-white pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 ${
              liveConfirmError
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                : 'border-slate-300 focus:border-emerald-600 focus:ring-emerald-600/20'
            }`}
          />
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            aria-label={showConfirm ? 'Sembunyikan konfirmasi password' : 'Tampilkan konfirmasi password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {liveConfirmError ? (
          <p role="alert" className="mt-1.5 text-xs font-medium text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{liveConfirmError}</span>
          </p>
        ) : (
          passwordsMatch && (
            <p className="mt-1.5 text-xs font-medium text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Konfirmasi password sesuai.</span>
            </p>
          )
        )}
      </div>
    </div>
  );
};
