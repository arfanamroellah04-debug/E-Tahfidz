import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  formatNilaiID,
  formatSessionTypeLabel,
  formatTanggalID,
  labelEligibility,
  labelJuzStatus,
} from './formatters';
import type {
  HafalanSessionRecord,
  JuzProgressSummary,
  StudentRecord,
} from '../types/tahfidz';

export interface ExportReportPayload {
  institutionName: string;
  student: StudentRecord;
  periodLabel: string;
  teacherName: string;
  summary: {
    completedJuzCount: number;
    totalZiyadahPages: number;
    averageScore: number | null;
  };
  juzSummaries: JuzProgressSummary[];
  sessions: HafalanSessionRecord[];
}

export function exportStudentReportPDF(payload: ExportReportPayload): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Kop Lembaga
  doc.setFillColor(6, 78, 59); // Emerald 900
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('E-TAHFIDZ — LAPORAN PERKEMBANGAN HAFALAN', 14, 12);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(payload.institutionName, 14, 19);
  doc.text(`Dicetak: ${formatTanggalID(new Date())}`, 152, 19);

  // Identitas Santri
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Nama Santri   : ${payload.student.full_name} (${payload.student.student_number})`, 14, 37);
  doc.text(`Kelas / Halaqah : ${payload.student.class_name || '-'}`, 14, 43);
  doc.text(`Periode Laporan : ${payload.periodLabel}`, 14, 49);
  doc.text(`Pembimbing      : ${payload.teacherName}`, 14, 55);

  // Ringkasan Nilai
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 61, 182, 18, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text(`Juz Selesai: ${payload.summary.completedJuzCount}`, 20, 69);
  doc.text(`Total Halaman Ziyadah: ${payload.summary.totalZiyadahPages}`, 70, 69);
  doc.text(`Rata-rata Nilai: ${formatNilaiID(payload.summary.averageScore)} / 5`, 135, 69);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Pedoman Penilaian: 1 Juz = 20 halaman (default), maks. 5 poin/halaman, nilai maksimal 100 per juz.', 20, 75);

  // Tabel Progres Per Juz
  autoTable(doc, {
    startY: 85,
    head: [['Juz', 'Halaman Dinilai', 'Nilai Saat Ini', 'Status Juz', 'Kelayakan']],
    body: payload.juzSummaries.map((j) => [
      `Juz ${j.juzNumber}`,
      `${j.assessedPagesCount} / ${j.pagesPerJuz}`,
      `${formatNilaiID(j.totalScore)} / ${j.maxPossibleCurrent}`,
      labelJuzStatus(j.juzStatus),
      labelEligibility(j.eligibilityStatus),
    ]),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  // Tabel Riwayat Setoran Terbaru
  const afterJuzY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 130;
  autoTable(doc, {
    startY: afterJuzY + 8,
    head: [['Tanggal', 'Jenis', 'Juz', 'Halaman & Nilai', 'Catatan Ustadz']],
    body: payload.sessions.slice(0, 15).map((s) => [
      formatTanggalID(s.session_date),
      formatSessionTypeLabel(s),
      `Juz ${s.juz_number}`,
      s.assessments.map((a) => `H.${a.page_in_juz}(${formatNilaiID(a.score)})`).join(', '),
      s.notes || '-',
    ]),
    styles: { fontSize: 8, cellPadding: 2.2 },
    headStyles: { fillColor: [5, 150, 105], textColor: 255 },
  });

  const safeName = payload.student.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`laporan-tahfidz-${safeName}.pdf`);
}

export function exportStudentReportExcel(payload: ExportReportPayload): void {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['Lembaga', payload.institutionName],
    ['Nama Santri', payload.student.full_name],
    ['NIS', payload.student.student_number],
    ['Kelas', payload.student.class_name || '-'],
    ['Periode', payload.periodLabel],
    ['Juz Selesai', payload.summary.completedJuzCount],
    ['Total Halaman Ziyadah', payload.summary.totalZiyadahPages],
    ['Rata-rata Nilai', payload.summary.averageScore ?? '-'],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Ringkasan');

  const juzRows = payload.juzSummaries.map((j) => ({
    Juz: j.juzNumber,
    'Halaman Dinilai': j.assessedPagesCount,
    'Total Halaman Juz': j.pagesPerJuz,
    'Nilai Terkumpul': j.totalScore,
    'Maksimal Saat Ini': j.maxPossibleCurrent,
    'Status Juz': labelJuzStatus(j.juzStatus),
    Kelayakan: labelEligibility(j.eligibilityStatus),
  }));
  const wsJuz = XLSX.utils.json_to_sheet(juzRows);
  XLSX.utils.book_append_sheet(wb, wsJuz, 'Nilai Per Juz');

  const sessionRows: Record<string, unknown>[] = [];
  for (const s of payload.sessions) {
    for (const a of s.assessments) {
      sessionRows.push({
        Tanggal: s.session_date,
        Jenis: formatSessionTypeLabel(s),
        'Jenis Tes': s.exam_type ?? '',
        Semester: s.semester ?? '',
        Kelas: s.class_name ?? payload.student.class_name ?? '',
        Status: s.status,
        Juz: a.juz_number,
        'Halaman Juz': a.page_in_juz,
        'Halaman Mushaf': a.mushaf_page_number ?? '',
        Nilai: a.score,
        Kelancaran: a.fluency_score,
        Tajwid: a.tajwid_score,
        Makhraj: a.makhraj_score,
        Percobaan: a.attempt_number,
        Kesalahan: (a.errors ?? []).map((e) => e.tag_name).join('; '),
        Catatan: a.notes || s.notes || '',
        Ustadz: s.teacher_name || '',
      });
    }
  }
  const wsSessions = XLSX.utils.json_to_sheet(sessionRows);
  XLSX.utils.book_append_sheet(wb, wsSessions, 'Detail Setoran');

  const safeName = payload.student.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  XLSX.writeFile(wb, `laporan-tahfidz-${safeName}.xlsx`);
}
