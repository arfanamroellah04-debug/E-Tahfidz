import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountRequestPayload,
  evaluatePasswordStrength,
  validateAccountRequestForm,
} from './account-request-rules';

test('validasi password < 8 karakter menampilkan pesan tepat', () => {
  const res = validateAccountRequestForm({
    requested_role: 'santri',
    full_name: 'Ahmad Fulan',
    identity_number: '2026-9001',
    halaqah_name: 'Halaqah Al-Fatih',
    phone: '',
    email: 'ahmad.fulan@etahfidz.id',
    password: 'abc12',
    confirm_password: 'abc12',
  });
  assert.equal(res.valid, false);
  assert.equal(res.errors.password, 'Password minimal 8 karakter.');
});

test('validasi konfirmasi password tidak sama menampilkan pesan tepat', () => {
  const res = validateAccountRequestForm({
    requested_role: 'wali_santri',
    full_name: 'Bpk. Hasan',
    identity_number: '',
    halaqah_name: '',
    phone: '081234567890',
    email: 'hasan@etahfidz.id',
    password: 'Tahfidz2026',
    confirm_password: 'Tahfidz2027',
  });
  assert.equal(res.valid, false);
  assert.equal(res.errors.confirm_password, 'Konfirmasi password tidak sesuai.');
});

test('validasi seluruh role mewajibkan kolom sesuai spesifikasi', () => {
  const santriMissing = validateAccountRequestForm({
    requested_role: 'santri',
    full_name: '',
    identity_number: '',
    halaqah_name: '',
    phone: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  assert.equal(santriMissing.valid, false);
  assert.ok(santriMissing.errors.full_name);
  assert.ok(santriMissing.errors.identity_number);
  assert.ok(santriMissing.errors.halaqah_name);
  assert.ok(santriMissing.errors.email);
  assert.equal(santriMissing.errors.password, 'Password minimal 8 karakter.');

  const waliOk = validateAccountRequestForm({
    requested_role: 'wali_santri',
    full_name: 'Ibu Aminah',
    identity_number: '',
    halaqah_name: '',
    phone: '081234567890',
    email: 'ibu.aminah@example.com',
    password: 'Password123',
    confirm_password: 'Password123',
  });
  assert.equal(waliOk.valid, true);

  const ustadzOk = validateAccountRequestForm({
    requested_role: 'ustadz',
    full_name: 'Ustadz Farhan',
    identity_number: 'UST-2026-09',
    halaqah_name: 'Halaqah An-Naba',
    phone: '',
    email: 'ustadz.farhan@example.com',
    password: 'Password123',
    confirm_password: 'Password123',
  });
  assert.equal(ustadzOk.valid, true);
});

test('indikator kekuatan password membedakan pendek, lemah, sedang, kuat', () => {
  assert.equal(evaluatePasswordStrength('abc123').label, 'Terlalu Pendek');
  assert.equal(evaluatePasswordStrength('abcdefgh').label, 'Lemah');
  assert.equal(evaluatePasswordStrength('abcdefgh1').label, 'Sedang');
  assert.equal(evaluatePasswordStrength('Tahfidz2026!').label, 'Kuat');
});

test('payload pendaftaran tidak pernah menyertakan confirm_password', () => {
  const payload = buildAccountRequestPayload({
    requested_role: 'santri',
    full_name: 'Zayd',
    identity_number: '2026-099',
    halaqah_name: 'Halaqah Al-Fatih',
    phone: '',
    email: 'Zayd@Example.com ',
    password: 'Password123',
    confirm_password: 'Password123',
  });
  assert.equal('confirm_password' in payload, false);
  assert.equal(payload.email, 'zayd@example.com');
});
