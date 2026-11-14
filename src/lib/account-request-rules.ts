import type { RequestableRole } from '../types/tahfidz';

export type PasswordStrengthLevel = 0 | 1 | 2 | 3;

export interface PasswordStrengthResult {
  score: PasswordStrengthLevel;
  label: 'Terlalu Pendek' | 'Lemah' | 'Sedang' | 'Kuat';
  hasMinLength: boolean;
  hasLetters: boolean;
  hasNumbers: boolean;
  hasLettersAndNumbers: boolean;
  hasSymbolOrMixedCase: boolean;
}

export interface AccountRequestFormInput {
  requested_role: RequestableRole;
  full_name: string;
  identity_number: string; // NIS for santri, NIP for ustadz
  halaqah_name: string;
  phone: string;
  email: string;
  password: string;
  confirm_password: string;
}

export type AccountRequestField =
  | 'full_name'
  | 'identity_number'
  | 'halaqah_name'
  | 'phone'
  | 'email'
  | 'password'
  | 'confirm_password';

export interface AccountRequestValidationResult {
  valid: boolean;
  errors: Partial<Record<AccountRequestField, string>>;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const hasMinLength = password.length >= 8;
  const hasLetters = /[a-zA-Z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasLettersAndNumbers = hasLetters && hasNumbers;
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const hasSymbolOrMixedCase = hasMixedCase || hasSymbol;

  if (!hasMinLength) {
    return {
      score: 0,
      label: 'Terlalu Pendek',
      hasMinLength,
      hasLetters,
      hasNumbers,
      hasLettersAndNumbers,
      hasSymbolOrMixedCase,
    };
  }

  if (hasLettersAndNumbers && (password.length >= 10 || hasSymbolOrMixedCase)) {
    return {
      score: 3,
      label: 'Kuat',
      hasMinLength,
      hasLetters,
      hasNumbers,
      hasLettersAndNumbers,
      hasSymbolOrMixedCase,
    };
  }

  if (hasLettersAndNumbers) {
    return {
      score: 2,
      label: 'Sedang',
      hasMinLength,
      hasLetters,
      hasNumbers,
      hasLettersAndNumbers,
      hasSymbolOrMixedCase,
    };
  }

  return {
    score: 1,
    label: 'Lemah',
    hasMinLength,
    hasLetters,
    hasNumbers,
    hasLettersAndNumbers,
    hasSymbolOrMixedCase,
  };
}

export function validateEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validateAccountRequestForm(
  input: AccountRequestFormInput
): AccountRequestValidationResult {
  const errors: Partial<Record<AccountRequestField, string>> = {};

  if (!input.full_name.trim()) {
    errors.full_name =
      input.requested_role === 'santri'
        ? 'Nama lengkap santri wajib diisi.'
        : input.requested_role === 'wali_santri'
          ? 'Nama lengkap wali santri wajib diisi.'
          : 'Nama lengkap ustadz/musyrif wajib diisi.';
  }

  if (input.requested_role === 'santri') {
    if (!input.identity_number.trim()) errors.identity_number = 'NIS wajib diisi.';
    if (!input.halaqah_name.trim()) errors.halaqah_name = 'Halaqah wajib diisi.';
  } else if (input.requested_role === 'ustadz') {
    if (!input.identity_number.trim()) errors.identity_number = 'NIP wajib diisi.';
    if (!input.halaqah_name.trim()) errors.halaqah_name = 'Halaqah wajib diisi.';
  } else if (input.requested_role === 'wali_santri') {
    if (!input.phone.trim()) {
      errors.phone = 'Nomor HP/WhatsApp wajib diisi.';
    } else if (input.phone.replace(/\D/g, '').length < 9) {
      errors.phone = 'Nomor HP/WhatsApp minimal 9 digit.';
    }
  }

  if (!input.email.trim()) {
    errors.email = 'Email login wajib diisi.';
  } else if (!validateEmailFormat(input.email)) {
    errors.email = 'Format alamat email tidak valid.';
  }

  if (!input.password || input.password.length < 8) {
    errors.password = 'Password minimal 8 karakter.';
  }

  if (!input.confirm_password) {
    errors.confirm_password = 'Konfirmasi password wajib diisi.';
  } else if (input.password !== input.confirm_password) {
    errors.confirm_password = 'Konfirmasi password tidak sesuai.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function buildAccountRequestPayload(input: AccountRequestFormInput): {
  requested_role: RequestableRole;
  full_name: string;
  email: string;
  phone: string | null;
  identity_number: string | null;
  halaqah_name: string | null;
  password: string;
} {
  // Confirm password ONLY validated on frontend and intentionally omitted from payload.
  return {
    requested_role: input.requested_role,
    full_name: input.full_name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.requested_role === 'wali_santri' ? input.phone.trim() : null,
    identity_number:
      input.requested_role === 'santri' || input.requested_role === 'ustadz'
        ? input.identity_number.trim()
        : null,
    halaqah_name:
      input.requested_role === 'santri' || input.requested_role === 'ustadz'
        ? input.halaqah_name.trim()
        : null,
    password: input.password,
  };
}
