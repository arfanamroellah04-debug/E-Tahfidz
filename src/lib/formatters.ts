import type {
  EligibilityStatus,
  ExamType,
  JuzProgressStatus,
  SemesterType,
  SessionType,
} from '../types/tahfidz';

const BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatTanggalID(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const date = typeof input === 'string'
    ? new Date(input.length === 10 ? `${input}T08:00:00+07:00` : input)
    : input;
  if (Number.isNaN(date.getTime())) return String(input);

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const monthIdx = Number(parts.find((p) => p.type === 'month')?.value ?? '1') - 1;
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return `${day} ${BULAN_ID[monthIdx] ?? ''} ${year}`.trim();
}

export function formatWaktuWIB(input: string | Date | null | undefined): string {
  if (!input) return '-';
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return '-';

  const formatted = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  return `${formatted.replace(':', '.')} WIB`;
}

export function formatTanggalWaktuWIB(input: string | Date | null | undefined): string {
  if (!input) return '-';
  return `${formatTanggalID(input)} · ${formatWaktuWIB(input)}`;
}

export function formatNilaiID(val: number | null | undefined, maxDecimals = 2): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  const rounded = Math.round(val * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
  return rounded.toString().replace('.', ',');
}

export function labelJuzStatus(status: JuzProgressStatus): string {
  switch (status) {
    case 'belum_dimulai':
      return 'Belum dimulai';
    case 'sedang_berjalan':
      return 'Sedang berjalan';
    case 'menunggu_evaluasi':
      return 'Menunggu evaluasi';
    case 'selesai_dinilai':
      return 'Selesai dinilai';
    case 'perlu_penguatan':
      return 'Perlu penguatan hafalan';
  }
}

export function labelEligibility(status: EligibilityStatus): string {
  switch (status) {
    case 'belum_lengkap':
      return 'Belum lengkap';
    case 'layak':
      return 'Layak / Lulus';
    case 'perlu_perbaikan':
      return 'Membutuhkan perbaikan';
  }
}

export function todayJakartaISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function formatSessionTypeLabel(params: {
  session_type?: SessionType | string | null;
  exam_type?: ExamType | string | null;
  semester?: SemesterType | string | null;
  class_name?: string | null;
}): string {
  if (params.session_type === 'tes_tahfidz') {
    const parts = ['Tes Tahfidz'];
    if (params.exam_type) parts.push(params.exam_type);
    if (params.semester) parts.push(`Semester ${params.semester}`);
    if (params.class_name) parts.push(params.class_name);
    return parts.join(' · ');
  }
  if (params.session_type === 'murojaah') return 'Laporan Murojaah';
  return 'Setoran Ziyadah';
}
