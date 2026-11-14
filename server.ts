import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

import { AUDIO_DIR, db, initializeDatabase } from './src/server/db.ts';
import { seedDemoDatabase } from './src/server/seed.ts';
import {
  canAccessStudent,
  extractTokenFromRequest,
  getAccessibleStudentIds,
  getProfileById,
  getProfileSessionInfo,
  hashCode,
  hashPassword,
  requireAccountHolder,
  requireAuth,
  requireRole,
  signToken,
  verifyPassword,
  verifyToken,
  writeAuditLog,
  type AuthedRequest,
} from './src/server/auth.ts';
import {
  adminUpdateSupabaseUserMetadata,
  getSupabaseConfigStatus,
  signInWithSupabaseAuth,
  signUpWithSupabaseAuth,
} from './src/server/supabase-auth.ts';
import {
  dispatchSessionNotifications,
  evaluateAndAwardBadges,
  getActiveMushafSetting,
  getStudentAssessments,
  getStudentOverview,
} from './src/server/tahfidz-service.ts';
import {
  buildAIContextFromAssessments,
  generateTahfidzAnalysis,
  isGeminiConfigured,
} from './src/server/ai-service.ts';
import {
  calculateJuzProgress,
  computeCompletionPrediction,
  computeMurojaahRecommendation,
  validatePageScore,
} from './src/lib/tahfidz-rules.ts';
import { todayJakartaISO } from './src/lib/formatters.ts';
import type {
  AccountStatus,
  ExamType,
  PageAssessmentInput,
  RequestableRole,
  SemesterType,
  SessionType,
  UserRole,
} from './src/types/tahfidz.ts';

initializeDatabase();
seedDemoDatabase();

const app = express();
app.use(express.json({ limit: '15mb' }));

// ==============================================================================
// WEBSOCKET REAL-TIME SERVER
// ==============================================================================
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

interface WSClientMeta {
  ws: WebSocket;
  profileId: string;
  role: UserRole;
}

const connectedClients = new Set<WSClientMeta>();

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname !== '/ws') return; // Leave Vite HMR or others alone if ever used

  const tokenParam = url.searchParams.get('token');
  const cookieHeader = request.headers.cookie;
  let token = tokenParam;
  if (!token && cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'etahfidz_session') token = decodeURIComponent(rest.join('='));
    }
  }
  const payload = token ? verifyToken<{ uid: string }>(token) : null;
  const user = payload?.uid ? getProfileById(payload.uid) : null;

  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const meta: WSClientMeta = { ws, profileId: user.id, role: user.role };
    connectedClients.add(meta);
    ws.send(JSON.stringify({ type: 'ws:connected', profileId: user.id, role: user.role }));
    ws.on('close', () => connectedClients.delete(meta));
    ws.on('error', () => connectedClients.delete(meta));
  });
});

function broadcastStudentUpdate(studentId: string, eventType: string, payload: Record<string, unknown>) {
  for (const client of connectedClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const user = getProfileById(client.profileId);
    if (!user) continue;
    if (canAccessStudent(user, studentId)) {
      client.ws.send(JSON.stringify({ type: eventType, studentId, ...payload }));
    }
  }
}

function resolveOrCreateClassId(halaqahName: string, ownerName: string, now: string): string {
  const trimmed = halaqahName.trim();
  const existingClass = db
    .prepare(`SELECT id FROM classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?)) LIMIT 1`)
    .get(trimmed) as { id: string } | undefined;
  if (existingClass) return existingClass.id;
  const newId = crypto.randomUUID();
  db.prepare(`INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    newId,
    trimmed,
    `Halaqah binaan ${ownerName}`,
    'Reguler',
    now
  );
  return newId;
}

async function recordEmailNotification(params: {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const webhookUrl = (process.env.EMAIL_WEBHOOK_URL || '').trim();
  let status: 'terkirim' | 'simulasi_lokal' | 'gagal' = 'simulasi_lokal';

  if (webhookUrl) {
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: params.recipientEmail,
          name: params.recipientName,
          subject: params.subject,
          text: params.body,
        }),
      });
      status = resp.ok ? 'terkirim' : 'gagal';
    } catch {
      status = 'gagal';
    }
  }

  db.prepare(
    `INSERT INTO email_notifications (id, recipient_email, recipient_name, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), params.recipientEmail, params.recipientName, params.subject, params.body, status, now);
}

function getPendingApplicationByProfileId(profileId: string) {
  const row = db
    .prepare(
      `SELECT pa.id, pa.supabase_user_id, pa.profile_id, pa.requested_role, pa.full_name, pa.email,
              pa.phone, pa.identity_number, pa.halaqah_name, pa.status, pa.email_verified,
              pa.admin_notes, pa.submitted_at, pa.reviewed_at, pa.reviewed_by, pa.updated_at,
              rev.full_name AS reviewer_name
       FROM pending_applications pa
       LEFT JOIN profiles rev ON rev.id = pa.reviewed_by
       WHERE pa.profile_id = ?
       LIMIT 1`
    )
    .get(profileId) as (Record<string, unknown> & { email_verified: number }) | undefined;
  if (!row) return null;
  return { ...row, email_verified: Boolean(row.email_verified) };
}

// ==============================================================================
// AUTHENTICATION, ACCOUNT REQUEST & PROFILE ENDPOINTS
// ==============================================================================
app.get('/api/public/classes', (_req, res) => {
  const classes = db.prepare(`SELECT id, class_name, level FROM classes ORDER BY class_name ASC`).all();
  res.json({
    classes,
    supabaseConfigured: getSupabaseConfigStatus().configured,
  });
});

app.post('/api/auth/request-account', async (req, res) => {
  const body = req.body as {
    requested_role?: RequestableRole;
    full_name?: string;
    email?: string;
    phone?: string;
    identity_number?: string;
    halaqah_name?: string;
    password?: string;
  };

  const role = body.requested_role;
  const fullName = body.full_name?.trim() || '';
  const email = body.email?.trim().toLowerCase() || '';
  const phone = body.phone?.trim() || null;
  const identityNumber = body.identity_number?.trim() || null;
  const halaqahName = body.halaqah_name?.trim() || null;
  const password = body.password || '';

  if (!role || !['santri', 'wali_santri', 'ustadz'].includes(role)) {
    res.status(400).json({ error: 'Jenis akun tidak valid. Pilih Santri, Wali Santri, atau Ustadz/Musyrif.' });
    return;
  }
  if (!fullName || !email) {
    res.status(400).json({ error: 'Nama lengkap dan email login wajib diisi.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Format alamat email tidak valid.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password minimal 8 karakter.' });
    return;
  }
  if (role === 'santri' && (!identityNumber || !halaqahName)) {
    res.status(400).json({ error: 'NIS dan Halaqah wajib diisi untuk permohonan akun Santri.' });
    return;
  }
  if (role === 'ustadz' && (!identityNumber || !halaqahName)) {
    res.status(400).json({ error: 'NIP dan Halaqah wajib diisi untuk permohonan akun Ustadz/Musyrif.' });
    return;
  }
  if (role === 'wali_santri' && !phone) {
    res.status(400).json({ error: 'Nomor HP/WhatsApp wajib diisi untuk permohonan akun Wali Santri.' });
    return;
  }

  // Prevent duplicate accounts or duplicate active applications
  const existingApp = db
    .prepare(`SELECT id, status FROM pending_applications WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(email) as { id: string; status: AccountStatus } | undefined;
  if (existingApp) {
    if (existingApp.status === 'rejected' || existingApp.status === 'needs_revision') {
      res.status(409).json({
        error:
          'Email ini sudah memiliki permohonan sebelumnya yang perlu diperbaiki/ditolak. Silakan masuk dengan email dan password Anda untuk melihat instruksi admin serta memperbaiki data.',
      });
      return;
    }
    res.status(409).json({
      error: 'Permohonan akun dengan email ini sudah pernah dikirim. Silakan masuk untuk memantau status verifikasi.',
    });
    return;
  }

  const existingProfile = db
    .prepare(`SELECT id, account_status FROM profiles WHERE LOWER(email) = LOWER(?) LIMIT 1`)
    .get(email) as { id: string; account_status: AccountStatus } | undefined;
  if (existingProfile) {
    res.status(409).json({ error: 'Email tersebut sudah terdaftar di sistem E-Tahfidz. Silakan gunakan email lain atau login.' });
    return;
  }

  if (role === 'santri' && identityNumber) {
    const existingStu = db
      .prepare(`SELECT id, profile_id FROM students WHERE student_number = ? LIMIT 1`)
      .get(identityNumber) as { id: string; profile_id: string | null } | undefined;
    if (existingStu?.profile_id) {
      res.status(409).json({ error: 'NIS tersebut sudah terhubung dengan akun santri aktif.' });
      return;
    }
  }

  if (role === 'ustadz' && identityNumber) {
    const existingTch = db
      .prepare(`SELECT id FROM teachers WHERE employee_number = ? LIMIT 1`)
      .get(identityNumber) as { id: string } | undefined;
    if (existingTch) {
      res.status(409).json({ error: 'NIP tersebut sudah terdaftar pada akun ustadz lain.' });
      return;
    }
  }

  // Process credentials through Supabase Auth if configured; NEVER store plaintext password in app DB
  const supaCfg = getSupabaseConfigStatus();
  let supabaseUserId: string | null = null;
  let emailVerified = true;
  let authProvider = 'local';

  if (supaCfg.configured) {
    const supaRes = await signUpWithSupabaseAuth({
      email,
      password,
      fullName,
      requestedRole: role,
    });
    if (!supaRes.ok) {
      if (supaRes.alreadyRegistered) {
        res.status(409).json({ error: 'Email tersebut sudah terdaftar pada Supabase Auth.' });
        return;
      }
      res.status(400).json({ error: supaRes.error || 'Pendaftaran Supabase Authentication gagal.' });
      return;
    }
    supabaseUserId = supaRes.userId || null;
    emailVerified = Boolean(supaRes.emailVerified);
    authProvider = 'supabase';
  }

  const now = new Date().toISOString();
  const profileId = supabaseUserId || crypto.randomUUID();
  const appId = crypto.randomUUID();
  const passwordHashForLocalOnly =
    authProvider === 'supabase' ? 'supabase_auth_managed' : hashPassword(password);

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO profiles (id, full_name, email, password_hash, phone, role, is_active, account_status, email_verified, auth_provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?)`
      ).run(
        profileId,
        fullName,
        email,
        passwordHashForLocalOnly,
        phone,
        role,
        emailVerified ? 1 : 0,
        authProvider,
        now,
        now
      );

      db.prepare(
        `INSERT INTO pending_applications (
           id, supabase_user_id, profile_id, requested_role, full_name, email, phone,
           identity_number, halaqah_name, status, email_verified, submitted_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(
        appId,
        profileId,
        profileId,
        role,
        fullName,
        email,
        phone,
        identityNumber,
        halaqahName,
        emailVerified ? 1 : 0,
        now,
        now
      );

      const admins = db
        .prepare(`SELECT id FROM profiles WHERE role = 'admin' AND is_active = 1 AND account_status = 'approved'`)
        .all() as { id: string }[];
      const insertNotif = db.prepare(
        `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, 'integrasi', ?, 0, ?)`
      );
      const roleText = role === 'santri' ? 'Santri' : role === 'wali_santri' ? 'Wali Santri' : 'Ustadz/Musyrif';
      for (const adm of admins) {
        insertNotif.run(
          crypto.randomUUID(),
          adm.id,
          `Permohonan Akun Baru (${roleText})`,
          `${fullName} (${email}) mengajukan pembuatan akun ${roleText}. Silakan tinjau pada menu Permohonan Akun.`,
          appId,
          now
        );
      }

      writeAuditLog({
        actorProfileId: profileId,
        action: 'PENGAJUAN_AKUN_BARU',
        entityType: 'pending_application',
        entityId: appId,
        newValues: { requested_role: role, email, full_name: fullName, status: 'pending' },
      });
    });
    tx();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menyimpan permohonan akun.' });
    return;
  }

  const token = signToken({ uid: profileId, role });
  res.setHeader(
    'Set-Cookie',
    `etahfidz_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  );
  const userInfo = getProfileSessionInfo(profileId);
  const application = getPendingApplicationByProfileId(profileId);

  res.status(201).json({
    token,
    user: userInfo,
    application,
    message: 'Permohonan akun berhasil dikirim!',
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
    return;
  }
  const row = db
    .prepare(`SELECT * FROM profiles WHERE LOWER(email) = LOWER(?)`)
    .get(email.trim()) as
    | {
        id: string;
        full_name: string;
        email: string;
        password_hash: string;
        phone: string | null;
        avatar_url: string | null;
        role: UserRole;
        is_active: number;
        account_status: AccountStatus;
        email_verified: number;
        auth_provider: string;
      }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'Email atau kata sandi tidak sesuai.' });
    return;
  }

  if (row.auth_provider === 'supabase' && getSupabaseConfigStatus().configured) {
    const supaLogin = await signInWithSupabaseAuth({ email: row.email, password });
    if (!supaLogin.ok) {
      if (supaLogin.emailNotConfirmed) {
        db.prepare(`UPDATE profiles SET email_verified = 0 WHERE id = ?`).run(row.id);
        db.prepare(`UPDATE pending_applications SET email_verified = 0 WHERE profile_id = ?`).run(row.id);
        res.status(403).json({
          error: 'Email Anda belum diverifikasi. Silakan buka tautan verifikasi pada kotak masuk email Anda terlebih dahulu.',
          code: 'EMAIL_NOT_VERIFIED',
          application: getPendingApplicationByProfileId(row.id),
        });
        return;
      }
      res.status(401).json({ error: 'Email atau kata sandi tidak sesuai.' });
      return;
    }
    if (supaLogin.emailVerified && !row.email_verified) {
      db.prepare(`UPDATE profiles SET email_verified = 1 WHERE id = ?`).run(row.id);
      db.prepare(`UPDATE pending_applications SET email_verified = 1 WHERE profile_id = ?`).run(row.id);
      row.email_verified = 1;
    }
  } else {
    if (!verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Email atau kata sandi tidak sesuai.' });
      return;
    }
  }

  if (row.account_status === 'suspended' || (row.account_status === 'approved' && !row.is_active)) {
    res.status(403).json({
      error: 'Akun Anda telah dinonaktifkan oleh administrator. Akses dashboard diblokir.',
      code: 'ACCOUNT_SUSPENDED',
    });
    return;
  }

  if (!row.email_verified) {
    res.status(403).json({
      error: 'Email Anda belum diverifikasi. Silakan lakukan verifikasi email terlebih dahulu sebelum melanjutkan.',
      code: 'EMAIL_NOT_VERIFIED',
      application: getPendingApplicationByProfileId(row.id),
    });
    return;
  }

  const token = signToken({ uid: row.id, role: row.role });
  res.setHeader(
    'Set-Cookie',
    `etahfidz_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`
  );

  const userInfo = getProfileSessionInfo(row.id);
  const application = row.account_status !== 'approved' ? getPendingApplicationByProfileId(row.id) : null;

  res.json({
    token,
    user: userInfo,
    application,
  });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `etahfidz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const token = extractTokenFromRequest(req);
  res.json({ user: req.user, token });
});

app.get('/api/auth/session', (req, res) => {
  const token = extractTokenFromRequest(req);
  if (!token) {
    res.json({ authenticated: false, user: null });
    return;
  }
  const payload = verifyToken<{ uid: string }>(token);
  const info = payload?.uid ? getProfileSessionInfo(payload.uid) : null;
  if (!info || info.account_status === 'suspended' || (info.account_status === 'approved' && !info.is_active)) {
    res.json({ authenticated: false, user: null, suspended: Boolean(info) });
    return;
  }
  const application = info.account_status !== 'approved' ? getPendingApplicationByProfileId(info.id) : null;
  res.json({ authenticated: true, user: info, application, token });
});

app.get('/api/account-requests/me', requireAccountHolder, (req: AuthedRequest, res) => {
  const info = req.sessionInfo!;
  const application = getPendingApplicationByProfileId(info.id);
  res.json({ user: info, application });
});

app.put('/api/account-requests/me', requireAccountHolder, (req: AuthedRequest, res) => {
  const info = req.sessionInfo!;
  const body = req.body as {
    full_name?: string;
    phone?: string;
    identity_number?: string;
    halaqah_name?: string;
    status?: string;
    role?: string;
    requested_role?: string;
  };

  if (body.status || body.role || body.requested_role) {
    res.status(403).json({
      error: 'Pengguna tidak diperbolehkan mengubah status verifikasi atau peran akunnya sendiri.',
    });
    return;
  }

  const appRow = db
    .prepare(`SELECT * FROM pending_applications WHERE profile_id = ? LIMIT 1`)
    .get(info.id) as
    | {
        id: string;
        requested_role: RequestableRole;
        status: AccountStatus;
        full_name: string;
        phone: string | null;
        identity_number: string | null;
        halaqah_name: string | null;
      }
    | undefined;

  if (!appRow) {
    res.status(404).json({ error: 'Data permohonan akun tidak ditemukan.' });
    return;
  }
  if (appRow.status !== 'rejected' && appRow.status !== 'needs_revision') {
    res.status(400).json({ error: 'Hanya permohonan berstatus ditolak atau perlu perbaikan yang dapat diperbarui.' });
    return;
  }

  const fullName = body.full_name?.trim() || '';
  const phone = body.phone?.trim() || null;
  const identityNumber = body.identity_number?.trim() || null;
  const halaqahName = body.halaqah_name?.trim() || null;

  if (!fullName) {
    res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
    return;
  }
  if ((appRow.requested_role === 'santri' || appRow.requested_role === 'ustadz') && (!identityNumber || !halaqahName)) {
    res.status(400).json({ error: 'NIS/NIP dan Halaqah wajib diisi.' });
    return;
  }
  if (appRow.requested_role === 'wali_santri' && !phone) {
    res.status(400).json({ error: 'Nomor HP/WhatsApp wajib diisi.' });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE pending_applications
       SET full_name = ?, phone = ?, identity_number = ?, halaqah_name = ?,
           status = 'pending', updated_at = ?
       WHERE id = ?`
    ).run(fullName, phone, identityNumber, halaqahName, now, appRow.id);

    db.prepare(
      `UPDATE profiles SET full_name = ?, phone = ?, account_status = 'pending', is_active = 0, updated_at = ? WHERE id = ?`
    ).run(fullName, phone, now, info.id);

    const admins = db
      .prepare(`SELECT id FROM profiles WHERE role = 'admin' AND is_active = 1 AND account_status = 'approved'`)
      .all() as { id: string }[];
    const insertNotif = db.prepare(
      `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
       VALUES (?, ?, ?, ?, 'integrasi', ?, 0, ?)`
    );
    for (const adm of admins) {
      insertNotif.run(
        crypto.randomUUID(),
        adm.id,
        `Perbaikan Permohonan Akun`,
        `${fullName} (${info.email}) telah memperbaiki data dan mengajukan ulang verifikasi akun.`,
        appRow.id,
        now
      );
    }

    writeAuditLog({
      actorProfileId: info.id,
      action: 'AJUKAN_ULANG_PERMOHONAN_AKUN',
      entityType: 'pending_application',
      entityId: appRow.id,
      newValues: { full_name: fullName, identity_number: identityNumber, halaqah_name: halaqahName, status: 'pending' },
    });
  })();

  res.json({
    ok: true,
    user: getProfileSessionInfo(info.id),
    application: getPendingApplicationByProfileId(info.id),
    message: 'Perbaikan data permohonan berhasil dikirim ulang dan kini menunggu verifikasi administrator.',
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, new_password } = req.body as { email?: string; new_password?: string };
  if (!email) {
    res.status(400).json({ error: 'Alamat email wajib diisi.' });
    return;
  }
  const user = db.prepare(`SELECT id, email FROM profiles WHERE LOWER(email) = LOWER(?)`).get(email.trim()) as
    | { id: string; email: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'Akun dengan email tersebut tidak ditemukan.' });
    return;
  }
  if (new_password) {
    if (new_password.length < 6) {
      res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
      return;
    }
    db.prepare(`UPDATE profiles SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
      hashPassword(new_password),
      new Date().toISOString(),
      user.id
    );
    writeAuditLog({
      actorProfileId: user.id,
      action: 'RESET_PASSWORD',
      entityType: 'profile',
      entityId: user.id,
    });
    res.json({ ok: true, message: 'Kata sandi berhasil diperbarui. Silakan login kembali.' });
    return;
  }
  res.json({
    ok: true,
    message: 'Email terverifikasi. Masukkan kata sandi baru untuk menyelesaikan pemulihan akun.',
  });
});

app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const body = req.body as { full_name?: string; phone?: string; avatar_url?: string; role?: string };

  // Keamanan: Tolak segala upaya pengguna mengubah role sendiri
  if (body.role && body.role !== user.role) {
    res.status(403).json({ error: 'Pengguna tidak diperbolehkan mengubah peran (role) akunnya sendiri.' });
    return;
  }

  const fullName = body.full_name?.trim() || user.full_name;
  const phone = body.phone !== undefined ? body.phone.trim() || null : user.phone;
  const avatarUrl = body.avatar_url !== undefined ? body.avatar_url || null : user.avatar_url;

  db.prepare(`UPDATE profiles SET full_name = ?, phone = ?, avatar_url = ?, updated_at = ? WHERE id = ?`).run(
    fullName,
    phone,
    avatarUrl,
    new Date().toISOString(),
    user.id
  );
  // Sync name to student record ONLY if admin; santri/wali cannot alter official academic student name
  writeAuditLog({
    actorProfileId: user.id,
    action: 'UPDATE_PROFILE',
    entityType: 'profile',
    entityId: user.id,
    oldValues: { full_name: user.full_name, phone: user.phone },
    newValues: { full_name: fullName, phone },
  });

  res.json({ user: getProfileById(user.id) });
});

app.get('/api/system/status', requireAuth, (_req, res) => {
  const settingsRows = db.prepare(`SELECT key, value FROM system_settings`).all() as {
    key: string;
    value: string;
  }[];
  const settingsMap: Record<string, string> = {};
  for (const r of settingsRows) settingsMap[r.key] = r.value;

  const waProvider = process.env.WHATSAPP_GATEWAY_PROVIDER || settingsMap.whatsapp_provider || 'belum_dikonfigurasi';
  const waConfigured =
    waProvider !== 'belum_dikonfigurasi' &&
    Boolean(process.env.WHATSAPP_GATEWAY_API_URL) &&
    Boolean(process.env.WHATSAPP_GATEWAY_TOKEN);
  const pendingApplicationsCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM pending_applications WHERE status IN ('pending', 'needs_revision')`)
      .get() as { c: number }
  ).c;

  res.json({
    geminiConfigured: isGeminiConfigured(),
    whatsappConfigured: waConfigured,
    whatsappProvider: waProvider,
    supabaseConfigured: getSupabaseConfigStatus().configured,
    pendingApplicationsCount,
    settings: settingsMap,
    mushaf: getActiveMushafSetting(),
  });
});

// ==============================================================================
// ROLE-SCOPED STUDENT & TAHFIDZ ENDPOINTS
// ==============================================================================
app.get('/api/students', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const accessibleIds = getAccessibleStudentIds(user);
  if (accessibleIds.length === 0) {
    res.json({ students: [] });
    return;
  }

  const placeholders = accessibleIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT s.*, c.class_name, p.email, p.avatar_url
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN profiles p ON p.id = s.profile_id
       WHERE s.id IN (${placeholders})
       ORDER BY s.full_name ASC`
    )
    .all(...accessibleIds) as Record<string, unknown>[];

  const mushaf = getActiveMushafSetting();
  const enriched = rows.map((stu) => {
    const assessments = getStudentAssessments(stu.id as string);
    const officialZ = assessments.filter(
      (a) =>
        a.session_type === 'ziyadah' &&
        (a.session_status === 'published' || a.session_status === 'corrected')
    );
    let completedJuz = 0;
    let totalPages = 0;
    for (let j = 1; j <= mushaf.total_juz; j++) {
      const sum = calculateJuzProgress(j, assessments, mushaf.default_pages_per_juz, mushaf.passing_threshold);
      if (sum.isComplete) completedJuz++;
      totalPages += sum.assessedPagesCount;
    }
    const avgScore =
      officialZ.length > 0
        ? Math.round((officialZ.reduce((s, a) => s + a.score, 0) / officialZ.length) * 100) / 100
        : null;
    const lastSession = db
      .prepare(
        `SELECT session_date, session_type, juz_number FROM hafalan_sessions
         WHERE student_id = ? AND status != 'draft'
         ORDER BY session_date DESC, created_at DESC LIMIT 1`
      )
      .get(stu.id as string) as { session_date: string; session_type: string; juz_number: number } | undefined;

    return {
      ...stu,
      completedJuz,
      totalPages,
      averageScore: avgScore,
      lastSession: lastSession ?? null,
    };
  });

  res.json({ students: enriched });
});

app.get('/api/students/:id/overview', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const studentId = req.params.id;
  if (!canAccessStudent(user, studentId)) {
    res.status(403).json({ error: 'Akses ditolak: Anda tidak berwenang melihat data santri ini.' });
    return;
  }

  let canListenAudio = true;
  if (user.role === 'wali_santri') {
    const link = db
      .prepare(
        `SELECT gsl.audio_access_allowed
         FROM guardian_student_links gsl
         JOIN guardians g ON g.id = gsl.guardian_id
         WHERE g.profile_id = ? AND gsl.student_id = ?`
      )
      .get(user.id, studentId) as { audio_access_allowed: number } | undefined;
    canListenAudio = Boolean(link?.audio_access_allowed);
  }

  const overview = getStudentOverview(studentId, user.id, canListenAudio);
  if (!overview) {
    res.status(404).json({ error: 'Data santri tidak ditemukan.' });
    return;
  }
  res.json(overview);
});

app.get('/api/classes', requireAuth, (_req, res) => {
  const classes = db
    .prepare(`SELECT id, class_name, description, level, created_at FROM classes ORDER BY class_name ASC`)
    .all();
  res.json({ classes });
});

// ==============================================================================
// HAFALAN SESSIONS (ZIYADAH, MUROJAAH & TES TAHFIDZ)
// ==============================================================================
app.get('/api/sessions', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const accessibleIds = getAccessibleStudentIds(user);
  if (accessibleIds.length === 0) {
    res.json({ sessions: [] });
    return;
  }
  const { student_id, session_type, juz_number, status } = req.query as Record<string, string | undefined>;
  const targetIds = student_id
    ? accessibleIds.includes(student_id)
      ? [student_id]
      : []
    : accessibleIds;

  if (student_id && targetIds.length === 0) {
    res.status(403).json({ error: 'Akses ditolak untuk santri yang diminta.' });
    return;
  }
  if (targetIds.length === 0) {
    res.json({ sessions: [] });
    return;
  }

  const placeholders = targetIds.map(() => '?').join(',');
  let sql = `
    SELECT hs.*, s.full_name AS student_name, s.student_number,
           COALESCE(hs.class_name, c.class_name) AS class_name,
           p.full_name AS teacher_name
    FROM hafalan_sessions hs
    JOIN students s ON s.id = hs.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    JOIN teachers t ON t.id = hs.teacher_id
    JOIN profiles p ON p.id = t.profile_id
    WHERE hs.student_id IN (${placeholders})
  `;
  const args: unknown[] = [...targetIds];
  if (session_type) {
    sql += ` AND hs.session_type = ?`;
    args.push(session_type);
  }
  if (juz_number) {
    sql += ` AND hs.juz_number = ?`;
    args.push(Number(juz_number));
  }
  if (status) {
    sql += ` AND hs.status = ?`;
    args.push(status);
  }
  // Wali & Santri hanya melihat laporan yang sudah dipublikasikan/dikoreksi (bukan draft ustadz)
  if (user.role === 'wali_santri' || user.role === 'santri') {
    sql += ` AND hs.status != 'draft'`;
  }
  sql += ` ORDER BY hs.session_date DESC, hs.created_at DESC LIMIT 120`;

  const sessions = db.prepare(sql).all(...args) as (Record<string, unknown> & { id: string })[];
  const paStmt = db.prepare(`SELECT * FROM page_assessments WHERE session_id = ? ORDER BY page_in_juz ASC`);
  const errStmt = db.prepare(
    `SELECT et.id, et.tag_name, et.category, pae.notes
     FROM page_assessment_errors pae
     JOIN error_tags et ON et.id = pae.error_tag_id
     WHERE pae.page_assessment_id = ?`
  );

  for (const ses of sessions) {
    const assessments = paStmt.all(ses.id) as (Record<string, unknown> & { id: string })[];
    for (const a of assessments) {
      a.errors = errStmt.all(a.id);
    }
    ses.assessments = assessments;
  }

  res.json({ sessions });
});

app.post('/api/sessions', requireAuth, requireRole('admin', 'ustadz'), async (req: AuthedRequest, res) => {
  const user = req.user!;
  const body = req.body as {
    student_id: string;
    session_type: SessionType;
    exam_type?: ExamType;
    semester?: SemesterType;
    class_id?: string;
    class_name?: string;
    session_date: string;
    juz_number: number;
    notes?: string;
    status: 'draft' | 'published';
    next_target_pages?: number;
    next_target_date?: string;
    assessments: PageAssessmentInput[];
  };

  if (!body.student_id || !body.session_type || !body.juz_number || !Array.isArray(body.assessments) || body.assessments.length === 0) {
    res.status(400).json({ error: 'Data setoran belum lengkap. Pilih santri, juz, dan minimal 1 halaman penilaian.' });
    return;
  }
  if (!['ziyadah', 'murojaah', 'tes_tahfidz'].includes(body.session_type)) {
    res.status(400).json({ error: 'Jenis setoran tidak valid.' });
    return;
  }
  if (body.session_type === 'tes_tahfidz') {
    if (!body.exam_type || !['PTS', 'PAS'].includes(body.exam_type)) {
      res.status(400).json({ error: 'Jenis Tes Tahfidz wajib dipilih (PTS atau PAS).' });
      return;
    }
    if (!body.semester || !['Ganjil', 'Genap'].includes(body.semester)) {
      res.status(400).json({ error: 'Semester Tes Tahfidz wajib dipilih (Ganjil atau Genap).' });
      return;
    }
  }
  if (!canAccessStudent(user, body.student_id)) {
    res.status(403).json({ error: 'Anda tidak memiliki akses untuk menilai santri di luar kelas binaan Anda.' });
    return;
  }

  const mushaf = getActiveMushafSetting();
  if (body.juz_number < 1 || body.juz_number > mushaf.total_juz) {
    res.status(400).json({ error: `Nomor juz harus antara 1 dan ${mushaf.total_juz}.` });
    return;
  }

  // Validasi setiap nilai halaman (0..5)
  for (const item of body.assessments) {
    if (item.page_in_juz < 1 || item.page_in_juz > mushaf.default_pages_per_juz) {
      res.status(400).json({ error: `Nomor halaman dalam juz harus antara 1 dan ${mushaf.default_pages_per_juz}.` });
      return;
    }
    const v = validatePageScore(Number(item.score));
    if (!v.valid) {
      res.status(400).json({ error: `Halaman ${item.page_in_juz}: ${v.error}` });
      return;
    }
  }

  // Resolve teacher_id
  let teacher = db.prepare(`SELECT id FROM teachers WHERE profile_id = ?`).get(user.id) as { id: string } | undefined;
  if (!teacher && user.role === 'admin') {
    teacher = db.prepare(`SELECT id FROM teachers LIMIT 1`).get() as { id: string } | undefined;
  }
  if (!teacher) {
    res.status(400).json({ error: 'Profil ustadz/musyrif belum terdaftar.' });
    return;
  }

  // Resolve class_id & class_name (khususnya untuk Tes Tahfidz)
  let resolvedClassId: string | null = body.class_id || null;
  let resolvedClassName: string | null = body.class_name?.trim() || null;
  if (resolvedClassId && !resolvedClassName) {
    const clsRow = db.prepare(`SELECT class_name FROM classes WHERE id = ?`).get(resolvedClassId) as
      | { class_name: string }
      | undefined;
    if (clsRow) resolvedClassName = clsRow.class_name;
  }
  if (!resolvedClassName) {
    const stuCls = db
      .prepare(
        `SELECT s.class_id, c.class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`
      )
      .get(body.student_id) as { class_id: string | null; class_name: string | null } | undefined;
    resolvedClassId = resolvedClassId ?? stuCls?.class_id ?? null;
    resolvedClassName = stuCls?.class_name ?? null;
  }

  const examType = body.session_type === 'tes_tahfidz' ? body.exam_type! : null;
  const semester = body.session_type === 'tes_tahfidz' ? body.semester! : null;
  const sessionClassId = body.session_type === 'tes_tahfidz' ? resolvedClassId : null;
  const sessionClassName = body.session_type === 'tes_tahfidz' ? resolvedClassName : null;

  const now = new Date().toISOString();
  const sessionDate = body.session_date || todayJakartaISO();
  const sessionId = crypto.randomUUID();
  const status = body.status === 'published' ? 'published' : 'draft';
  const publishedAt = status === 'published' ? now : null;

  const createdAssessmentIds: string[] = [];

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO hafalan_sessions (id, student_id, teacher_id, session_type, exam_type, semester, class_id, class_name, session_date, juz_number, notes, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      body.student_id,
      teacher!.id,
      body.session_type,
      examType,
      semester,
      sessionClassId,
      sessionClassName,
      sessionDate,
      body.juz_number,
      body.notes ?? null,
      status,
      publishedAt,
      now,
      now
    );

    const existingAttemptStmt = db.prepare(
      `SELECT COALESCE(MAX(pa.attempt_number), 0) AS max_att
       FROM page_assessments pa
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       WHERE hs.student_id = ? AND pa.juz_number = ? AND pa.page_in_juz = ? AND hs.session_type = ?`
    );

    const prevScoreStmt = db.prepare(
      `SELECT pa.score
       FROM page_assessments pa
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       WHERE hs.student_id = ? AND pa.juz_number = ? AND pa.page_in_juz = ? AND hs.status != 'draft'
       ORDER BY pa.created_at DESC LIMIT 1`
    );

    const insertPa = db.prepare(
      `INSERT INTO page_assessments (id, session_id, juz_number, page_in_juz, mushaf_page_number, score, fluency_score, tajwid_score, makhraj_score, waqaf_score, attempt_number, assessment_status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertErr = db.prepare(
      `INSERT INTO page_assessment_errors (id, page_assessment_id, error_tag_id, notes) VALUES (?, ?, ?, ?)`
    );

    const insertSchedule = db.prepare(
      `INSERT INTO murojaah_schedules (id, student_id, juz_number, page_start, page_end, scheduled_date, priority, source_assessment_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'terjadwal', ?)`
    );

    for (const item of body.assessments) {
      const paId = crypto.randomUUID();
      createdAssessmentIds.push(paId);
      const maxAttRow = existingAttemptStmt.get(
        body.student_id,
        body.juz_number,
        item.page_in_juz,
        body.session_type
      ) as { max_att: number };
      const attempt = (maxAttRow?.max_att ?? 0) + 1;
      const prevRow = prevScoreStmt.get(body.student_id, body.juz_number, item.page_in_juz) as
        | { score: number }
        | undefined;

      const score = Number(item.score);
      const fluency = Number(item.fluency_score ?? score);
      const tajwid = Number(item.tajwid_score ?? score);
      const makhraj = Number(item.makhraj_score ?? score);
      const waqaf = Number(item.waqaf_score ?? score);
      const mushafPage =
        item.mushaf_page_number ?? (body.juz_number - 1) * mushaf.default_pages_per_juz + item.page_in_juz;

      insertPa.run(
        paId,
        sessionId,
        body.juz_number,
        item.page_in_juz,
        mushafPage,
        score,
        fluency,
        tajwid,
        makhraj,
        waqaf,
        attempt,
        status === 'published' ? 'resmi' : 'draft',
        item.notes ?? null,
        now,
        now
      );

      const errIds = item.error_tag_ids ?? [];
      for (const eid of errIds) {
        insertErr.run(crypto.randomUUID(), paId, eid, item.notes ?? null);
      }

      if (status === 'published') {
        const rec = computeMurojaahRecommendation({
          score,
          errorCount: errIds.length,
          previousScore: prevRow?.score ?? null,
          baseDateISO: sessionDate,
        });
        insertSchedule.run(
          crypto.randomUUID(),
          body.student_id,
          body.juz_number,
          item.page_in_juz,
          item.page_in_juz,
          rec.scheduledDate,
          rec.priority,
          paId,
          rec.reason,
          now
        );
      }
    }

    if (body.next_target_pages && body.next_target_pages > 0) {
      db.prepare(
        `INSERT INTO hafalan_targets (id, student_id, target_type, target_pages, target_date, status, created_by, created_at)
         VALUES (?, ?, 'mingguan', ?, ?, 'aktif', ?, ?)`
      ).run(
        crypto.randomUUID(),
        body.student_id,
        body.next_target_pages,
        body.next_target_date || sessionDate,
        user.id,
        now
      );
    }

    writeAuditLog({
      actorProfileId: user.id,
      action: status === 'published' ? 'PUBLIKASI_SETORAN' : 'SIMPAN_DRAFT_SETORAN',
      entityType: 'hafalan_session',
      entityId: sessionId,
      newValues: {
        student_id: body.student_id,
        session_type: body.session_type,
        exam_type: examType,
        semester,
        class_name: sessionClassName,
        juz_number: body.juz_number,
        pages: body.assessments.map((a) => ({ page: a.page_in_juz, score: a.score })),
      },
    });
  });

  tx();

  let newlyAwardedBadges: string[] = [];
  if (status === 'published') {
    newlyAwardedBadges = evaluateAndAwardBadges(body.student_id);
    const avg =
      body.assessments.reduce((s, a) => s + Number(a.score), 0) / body.assessments.length;
    const pagesLabel =
      body.assessments.length === 1
        ? `Hal. ${body.assessments[0].page_in_juz}`
        : `Hal. ${Math.min(...body.assessments.map((a) => a.page_in_juz))}–${Math.max(
            ...body.assessments.map((a) => a.page_in_juz)
          )}`;
    await dispatchSessionNotifications({
      studentId: body.student_id,
      sessionId,
      sessionType: body.session_type,
      examType,
      semester,
      className: sessionClassName,
      juzNumber: body.juz_number,
      pagesLabel,
      avgScore: avg,
      teacherName: user.full_name,
      newlyAwardedBadges,
    });
    broadcastStudentUpdate(body.student_id, 'session:published', {
      sessionId,
      juzNumber: body.juz_number,
      sessionType: body.session_type,
    });
  }

  res.status(201).json({
    sessionId,
    status,
    assessmentIds: createdAssessmentIds,
    newlyAwardedBadges,
  });
});

app.patch('/api/sessions/:id', requireAuth, requireRole('admin', 'ustadz'), async (req: AuthedRequest, res) => {
  const user = req.user!;
  const sessionId = req.params.id;
  const session = db.prepare(`SELECT * FROM hafalan_sessions WHERE id = ?`).get(sessionId) as
    | {
        id: string;
        student_id: string;
        session_type: SessionType;
        exam_type: ExamType | null;
        semester: SemesterType | null;
        class_name: string | null;
        juz_number: number;
        status: string;
        session_date: string;
      }
    | undefined;

  if (!session) {
    res.status(404).json({ error: 'Sesi setoran tidak ditemukan.' });
    return;
  }
  if (!canAccessStudent(user, session.student_id)) {
    res.status(403).json({ error: 'Akses ditolak untuk mengubah penilaian santri ini.' });
    return;
  }

  const body = req.body as {
    status?: 'draft' | 'published' | 'corrected';
    notes?: string;
    updates?: { id: string; score: number; fluency_score?: number; tajwid_score?: number; makhraj_score?: number; notes?: string }[];
  };

  if (body.updates) {
    for (const u of body.updates) {
      const v = validatePageScore(Number(u.score));
      if (!v.valid) {
        res.status(400).json({ error: v.error });
        return;
      }
    }
  }

  const now = new Date().toISOString();
  const nextStatus = body.status ?? (session.status === 'published' ? 'corrected' : session.status);

  const tx = db.transaction(() => {
    if (body.updates) {
      for (const u of body.updates) {
        const oldPa = db.prepare(`SELECT score, page_in_juz FROM page_assessments WHERE id = ? AND session_id = ?`).get(u.id, sessionId) as
          | { score: number; page_in_juz: number }
          | undefined;
        if (!oldPa) continue;

        db.prepare(
          `UPDATE page_assessments
           SET score = ?, fluency_score = ?, tajwid_score = ?, makhraj_score = ?, notes = ?, assessment_status = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          Number(u.score),
          Number(u.fluency_score ?? u.score),
          Number(u.tajwid_score ?? u.score),
          Number(u.makhraj_score ?? u.score),
          u.notes ?? null,
          nextStatus === 'draft' ? 'draft' : 'revisi',
          now,
          u.id
        );

        writeAuditLog({
          actorProfileId: user.id,
          action: 'UBAH_NILAI_HALAMAN',
          entityType: 'page_assessment',
          entityId: u.id,
          oldValues: { juz: session.juz_number, halaman: oldPa.page_in_juz, score: oldPa.score },
          newValues: { juz: session.juz_number, halaman: oldPa.page_in_juz, score: Number(u.score) },
        });
      }
    }

    db.prepare(
      `UPDATE hafalan_sessions
       SET status = ?, notes = COALESCE(?, notes),
           published_at = CASE WHEN ? != 'draft' AND published_at IS NULL THEN ? ELSE published_at END,
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, body.notes ?? null, nextStatus, now, now, sessionId);

    if (nextStatus !== 'draft') {
      db.prepare(`UPDATE page_assessments SET assessment_status = 'resmi' WHERE session_id = ? AND assessment_status = 'draft'`).run(
        sessionId
      );
    }
  });

  tx();

  if (nextStatus !== 'draft') {
    const badges = evaluateAndAwardBadges(session.student_id);
    const paList = db.prepare(`SELECT score, page_in_juz FROM page_assessments WHERE session_id = ?`).all(sessionId) as {
      score: number;
      page_in_juz: number;
    }[];
    const avg = paList.length > 0 ? paList.reduce((s, p) => s + p.score, 0) / paList.length : 0;
    const pagesLabel =
      paList.length > 0
        ? `Hal. ${Math.min(...paList.map((p) => p.page_in_juz))}–${Math.max(...paList.map((p) => p.page_in_juz))}`
        : 'Setoran';
    await dispatchSessionNotifications({
      studentId: session.student_id,
      sessionId,
      sessionType: session.session_type,
      examType: session.exam_type,
      semester: session.semester,
      className: session.class_name,
      juzNumber: session.juz_number,
      pagesLabel,
      avgScore: avg,
      teacherName: user.full_name,
      newlyAwardedBadges: badges,
    });
    broadcastStudentUpdate(session.student_id, 'session:updated', { sessionId, status: nextStatus });
  }

  res.json({ ok: true, status: nextStatus });
});

app.delete('/api/sessions/:id', requireAuth, requireRole('admin', 'ustadz'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const session = db.prepare(`SELECT * FROM hafalan_sessions WHERE id = ?`).get(req.params.id) as
    | { id: string; student_id: string; status: string }
    | undefined;
  if (!session) {
    res.status(404).json({ error: 'Sesi tidak ditemukan.' });
    return;
  }
  if (!canAccessStudent(user, session.student_id)) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  if (user.role === 'ustadz' && session.status !== 'draft') {
    res.status(403).json({ error: 'Ustadz hanya dapat menghapus setoran berstatus draft. Hubungi Admin untuk penghapusan resmi.' });
    return;
  }
  db.prepare(`DELETE FROM hafalan_sessions WHERE id = ?`).run(session.id);
  writeAuditLog({
    actorProfileId: user.id,
    action: 'HAPUS_SESI_SETORAN',
    entityType: 'hafalan_session',
    entityId: session.id,
    oldValues: session,
  });
  res.json({ ok: true });
});

// ==============================================================================
// AUDIO UPLOAD & PRIVATE SIGNED STREAMING
// ==============================================================================
app.post('/api/audio/upload', requireAuth, requireRole('admin', 'ustadz'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const { session_id, page_assessment_id, audio_base64, mime_type, duration_seconds, consent_confirmed } = req.body as {
    session_id: string;
    page_assessment_id?: string;
    audio_base64: string;
    mime_type?: string;
    duration_seconds: number;
    consent_confirmed: boolean;
  };

  if (!consent_confirmed) {
    res.status(400).json({ error: 'Persetujuan perekaman dan kebijakan penyimpanan audio harus dikonfirmasi.' });
    return;
  }
  if (!session_id || !audio_base64) {
    res.status(400).json({ error: 'Session ID dan berkas audio wajib disertakan.' });
    return;
  }
  const ses = db.prepare(`SELECT student_id FROM hafalan_sessions WHERE id = ?`).get(session_id) as
    | { student_id: string }
    | undefined;
  if (!ses || !canAccessStudent(user, ses.student_id)) {
    res.status(403).json({ error: 'Akses ditolak untuk mengunggah audio pada sesi ini.' });
    return;
  }

  const base64Clean = audio_base64.includes(',') ? audio_base64.split(',')[1] : audio_base64;
  const buf = Buffer.from(base64Clean, 'base64');
  const ext = mime_type?.includes('webm') ? 'webm' : mime_type?.includes('mp4') ? 'm4a' : 'wav';
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, filename), buf);

  db.prepare(
    `INSERT INTO audio_attachments (id, session_id, page_assessment_id, storage_path, mime_type, duration_seconds, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    session_id,
    page_assessment_id ?? null,
    filename,
    mime_type || 'audio/webm',
    Math.min(120, Math.max(1, Math.round(duration_seconds || 10))),
    user.id,
    new Date().toISOString()
  );

  res.status(201).json({ id });
});

app.get('/api/audio/:id/stream', (req, res) => {
  const tokenParam = req.query.token as string | undefined;
  const token = tokenParam || extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Signed token diperlukan untuk mengakses audio privat.' });
    return;
  }

  const payload = verifyToken<{ aid?: string; uid?: string }>(token);
  const userId = payload?.uid;
  if (!userId) {
    res.status(401).json({ error: 'Tautan audio telah kedaluwarsa atau tidak valid.' });
    return;
  }
  if (payload?.aid && payload.aid !== req.params.id) {
    res.status(403).json({ error: 'Signed token tidak cocok dengan berkas audio.' });
    return;
  }

  const user = getProfileById(userId);
  if (!user) {
    res.status(401).json({ error: 'Pengguna tidak valid.' });
    return;
  }

  const audio = db
    .prepare(
      `SELECT aa.*, hs.student_id
       FROM audio_attachments aa
       JOIN hafalan_sessions hs ON hs.id = aa.session_id
       WHERE aa.id = ?`
    )
    .get(req.params.id) as { id: string; storage_path: string; mime_type: string; student_id: string } | undefined;

  if (!audio) {
    res.status(404).json({ error: 'Rekaman audio tidak ditemukan.' });
    return;
  }
  if (!canAccessStudent(user, audio.student_id)) {
    res.status(403).json({ error: 'Akses ditolak: Anda tidak berwenang memutar audio santri ini.' });
    return;
  }
  if (user.role === 'wali_santri') {
    const link = db
      .prepare(
        `SELECT gsl.audio_access_allowed FROM guardian_student_links gsl
         JOIN guardians g ON g.id = gsl.guardian_id
         WHERE g.profile_id = ? AND gsl.student_id = ?`
      )
      .get(user.id, audio.student_id) as { audio_access_allowed: number } | undefined;
    if (!link?.audio_access_allowed) {
      res.status(403).json({ error: 'Izin akses audio untuk wali santri belum diaktifkan oleh admin.' });
      return;
    }
  }

  const fullPath = path.join(AUDIO_DIR, audio.storage_path);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Berkas audio fisik tidak ditemukan di penyimpanan privat.' });
    return;
  }

  res.setHeader('Content-Type', audio.mime_type || 'audio/wav');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(fullPath).pipe(res);
});

app.delete('/api/audio/:id', requireAuth, requireRole('admin', 'ustadz'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const audio = db
    .prepare(
      `SELECT aa.*, hs.student_id FROM audio_attachments aa
       JOIN hafalan_sessions hs ON hs.id = aa.session_id WHERE aa.id = ?`
    )
    .get(req.params.id) as { id: string; storage_path: string; student_id: string } | undefined;
  if (!audio) {
    res.status(404).json({ error: 'Rekaman audio tidak ditemukan.' });
    return;
  }
  if (!canAccessStudent(user, audio.student_id)) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  const fullPath = path.join(AUDIO_DIR, audio.storage_path);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  db.prepare(`DELETE FROM audio_attachments WHERE id = ?`).run(audio.id);
  writeAuditLog({
    actorProfileId: user.id,
    action: 'HAPUS_AUDIO_SETORAN',
    entityType: 'audio_attachment',
    entityId: audio.id,
  });
  res.json({ ok: true });
});

// ==============================================================================
// AI ANALYSIS ENDPOINT (SERVER-SIDE ONLY)
// ==============================================================================
app.post('/api/ai/analyze', requireAuth, async (req: AuthedRequest, res) => {
  const user = req.user!;
  const { student_id, analysis_type } = req.body as {
    student_id: string;
    analysis_type?: string;
  };
  if (!student_id) {
    res.status(400).json({ error: 'ID santri wajib disertakan.' });
    return;
  }
  if (!canAccessStudent(user, student_id)) {
    res.status(403).json({ error: 'Akses ditolak untuk menganalisis santri ini.' });
    return;
  }
  const student = db.prepare(`SELECT id, full_name FROM students WHERE id = ?`).get(student_id) as
    | { id: string; full_name: string }
    | undefined;
  if (!student) {
    res.status(404).json({ error: 'Santri tidak ditemukan.' });
    return;
  }

  const mushaf = getActiveMushafSetting();
  const assessments = getStudentAssessments(student_id);
  const juzSummaries = Array.from({ length: mushaf.total_juz }, (_, i) =>
    calculateJuzProgress(i + 1, assessments, mushaf.default_pages_per_juz, mushaf.passing_threshold)
  ).filter((j) => j.assessedPagesCount > 0);
  const activeJuz =
    juzSummaries.find((j) => !j.isComplete)?.juzNumber ??
    (juzSummaries.length > 0 ? Math.min(30, juzSummaries[juzSummaries.length - 1].juzNumber + 1) : 1);

  const prediction = computeCompletionPrediction({
    assessments,
    activeJuzNumber: activeJuz,
    pagesPerJuz: mushaf.default_pages_per_juz,
  });
  const activeTarget = db
    .prepare(`SELECT target_type, target_pages, target_date, status FROM hafalan_targets WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(student_id) as { target_type: string; target_pages: number; target_date: string; status: string } | undefined;

  const targetSummary = activeTarget
    ? `Target ${activeTarget.target_type}: ${activeTarget.target_pages} halaman hingga ${activeTarget.target_date} (status: ${activeTarget.status}).`
    : 'Belum ada target hafalan aktif yang ditetapkan.';

  const typeLabel = analysis_type || 'Analisis Perkembangan Menyeluruh';
  const ctx = buildAIContextFromAssessments({
    studentName: student.full_name,
    analysisType: typeLabel,
    assessments,
    prediction,
    activeTargetSummary: targetSummary,
  });

  const result = await generateTahfidzAnalysis(ctx);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO ai_analyses (id, student_id, analysis_type, period_start, period_end, input_summary, insights, recommendations, prediction, confidence_level, model_name, is_live_ai, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    student_id,
    typeLabel,
    ctx.periodStart,
    ctx.periodEnd,
    `${ctx.totalZiyadahPages} halaman ziyadah resmi · ${ctx.totalMurojaahSessions} sesi murojaah`,
    JSON.stringify(result.insights),
    JSON.stringify(result.recommendations),
    JSON.stringify(prediction),
    result.confidence_level,
    result.model_name,
    result.is_live_ai ? 1 : 0,
    now
  );

  res.json({
    analysis: {
      id,
      student_id,
      analysis_type: typeLabel,
      period_start: ctx.periodStart,
      period_end: ctx.periodEnd,
      input_summary: `${ctx.totalZiyadahPages} halaman ziyadah resmi · ${ctx.totalMurojaahSessions} sesi murojaah`,
      insights: result.insights,
      recommendations: result.recommendations,
      prediction,
      confidence_level: result.confidence_level,
      model_name: result.model_name,
      is_live_ai: result.is_live_ai,
      notice: result.notice,
      created_at: now,
    },
  });
});

// ==============================================================================
// SMART MUROJAAH SCHEDULER, TARGETS & ERROR ANALYTICS
// ==============================================================================
app.get('/api/murojaah-schedules', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const accessibleIds = getAccessibleStudentIds(user);
  if (accessibleIds.length === 0) {
    res.json({ schedules: [] });
    return;
  }
  const studentFilter = req.query.student_id as string | undefined;
  const ids = studentFilter && accessibleIds.includes(studentFilter) ? [studentFilter] : accessibleIds;
  const placeholders = ids.map(() => '?').join(',');
  const schedules = db
    .prepare(
      `SELECT ms.*, s.full_name AS student_name
       FROM murojaah_schedules ms
       JOIN students s ON s.id = ms.student_id
       WHERE ms.student_id IN (${placeholders})
       ORDER BY ms.scheduled_date ASC`
    )
    .all(...ids);
  res.json({ schedules });
});

app.patch('/api/murojaah-schedules/:id', requireAuth, requireRole('admin', 'ustadz'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const row = db.prepare(`SELECT * FROM murojaah_schedules WHERE id = ?`).get(req.params.id) as
    | { id: string; student_id: string }
    | undefined;
  if (!row || !canAccessStudent(user, row.student_id)) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  const { scheduled_date, priority, status } = req.body as {
    scheduled_date?: string;
    priority?: string;
    status?: string;
  };
  db.prepare(
    `UPDATE murojaah_schedules
     SET scheduled_date = COALESCE(?, scheduled_date),
         priority = COALESCE(?, priority),
         status = COALESCE(?, status)
     WHERE id = ?`
  ).run(scheduled_date ?? null, priority ?? null, status ?? null, row.id);
  res.json({ ok: true });
});

app.post('/api/targets', requireAuth, requireRole('admin', 'ustadz'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const { student_id, target_type, target_pages, target_date } = req.body as {
    student_id: string;
    target_type: 'harian' | 'mingguan' | 'bulanan';
    target_pages: number;
    target_date: string;
  };
  if (!student_id || !canAccessStudent(user, student_id)) {
    res.status(403).json({ error: 'Akses ditolak.' });
    return;
  }
  if (!target_pages || target_pages < 1) {
    res.status(400).json({ error: 'Jumlah halaman target minimal 1.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO hafalan_targets (id, student_id, target_type, target_pages, target_date, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'aktif', ?, ?)`
  ).run(id, student_id, target_type || 'mingguan', Number(target_pages), target_date || todayJakartaISO(), user.id, new Date().toISOString());
  res.status(201).json({ id });
});

app.get('/api/error-tags', requireAuth, (_req, res) => {
  const tags = db.prepare(`SELECT * FROM error_tags ORDER BY category ASC, tag_name ASC`).all();
  res.json({ errorTags: tags });
});

app.get('/api/error-stats', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const accessibleIds = getAccessibleStudentIds(user);
  if (accessibleIds.length === 0) {
    res.json({ topErrors: [], byJuz: [], byCategory: [] });
    return;
  }
  const studentFilter = req.query.student_id as string | undefined;
  const ids = studentFilter && accessibleIds.includes(studentFilter) ? [studentFilter] : accessibleIds;
  const placeholders = ids.map(() => '?').join(',');

  const topErrors = db
    .prepare(
      `SELECT et.id, et.tag_name, et.category, COUNT(*) AS count
       FROM page_assessment_errors pae
       JOIN error_tags et ON et.id = pae.error_tag_id
       JOIN page_assessments pa ON pa.id = pae.page_assessment_id
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       WHERE hs.student_id IN (${placeholders}) AND hs.status != 'draft'
       GROUP BY et.id
       ORDER BY count DESC
       LIMIT 12`
    )
    .all(...ids);

  const byCategory = db
    .prepare(
      `SELECT et.category, COUNT(*) AS count
       FROM page_assessment_errors pae
       JOIN error_tags et ON et.id = pae.error_tag_id
       JOIN page_assessments pa ON pa.id = pae.page_assessment_id
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       WHERE hs.student_id IN (${placeholders}) AND hs.status != 'draft'
       GROUP BY et.category
       ORDER BY count DESC`
    )
    .all(...ids);

  const byJuz = db
    .prepare(
      `SELECT pa.juz_number, COUNT(*) AS count
       FROM page_assessment_errors pae
       JOIN page_assessments pa ON pa.id = pae.page_assessment_id
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       WHERE hs.student_id IN (${placeholders}) AND hs.status != 'draft'
       GROUP BY pa.juz_number
       ORDER BY pa.juz_number ASC`
    )
    .all(...ids);

  const beforeAfter = db
    .prepare(
      `SELECT hs.session_type, COUNT(pae.id) AS error_count, COUNT(DISTINCT pa.id) AS page_count
       FROM page_assessments pa
       JOIN hafalan_sessions hs ON hs.id = pa.session_id
       LEFT JOIN page_assessment_errors pae ON pae.page_assessment_id = pa.id
       WHERE hs.student_id IN (${placeholders}) AND hs.status != 'draft'
       GROUP BY hs.session_type`
    )
    .all(...ids);

  res.json({ topErrors, byCategory, byJuz, beforeAfter });
});

// ==============================================================================
// GUARDIAN LINK INVITE ACCEPTANCE (WALI SANTRI)
// ==============================================================================
app.post('/api/guardian/accept-invite', requireAuth, requireRole('wali_santri'), (req: AuthedRequest, res) => {
  const user = req.user!;
  const { invitation_code, relationship } = req.body as { invitation_code?: string; relationship?: string };
  if (!invitation_code?.trim()) {
    res.status(400).json({ error: 'Kode penghubung wajib diisi.' });
    return;
  }

  const codeHash = hashCode(invitation_code);
  const invite = db
    .prepare(`SELECT * FROM guardian_link_invites WHERE invitation_code_hash = ? AND status = 'pending'`)
    .get(codeHash) as
    | { id: string; guardian_id: string | null; student_id: string; expires_at: string }
    | undefined;

  if (!invite) {
    res.status(404).json({ error: 'Kode penghubung tidak ditemukan atau sudah digunakan.' });
    return;
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE guardian_link_invites SET status = 'expired' WHERE id = ?`).run(invite.id);
    res.status(400).json({ error: 'Kode penghubung telah kedaluwarsa. Minta kode baru dari Admin.' });
    return;
  }

  const guardian = db.prepare(`SELECT id, relationship FROM guardians WHERE profile_id = ?`).get(user.id) as
    | { id: string; relationship: string }
    | undefined;
  if (!guardian) {
    res.status(400).json({ error: 'Profil wali santri belum terdaftar.' });
    return;
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const existingLink = db
      .prepare(`SELECT id FROM guardian_student_links WHERE guardian_id = ? AND student_id = ?`)
      .get(guardian.id, invite.student_id);
    if (!existingLink) {
      db.prepare(
        `INSERT INTO guardian_student_links (id, guardian_id, student_id, relationship, is_primary, audio_access_allowed, created_at)
         VALUES (?, ?, ?, ?, 1, 1, ?)`
      ).run(crypto.randomUUID(), guardian.id, invite.student_id, relationship || guardian.relationship, now);
    }
    db.prepare(`UPDATE guardian_link_invites SET status = 'used', used_at = ?, guardian_id = ? WHERE id = ?`).run(
      now,
      guardian.id,
      invite.id
    );
    writeAuditLog({
      actorProfileId: user.id,
      action: 'HUBUNGKAN_WALI_SANTRI_VIA_KODE',
      entityType: 'guardian_student_link',
      entityId: invite.student_id,
      newValues: { guardian_id: guardian.id, student_id: invite.student_id },
    });
  });
  tx();

  const stu = db.prepare(`SELECT full_name FROM students WHERE id = ?`).get(invite.student_id) as { full_name: string };
  res.json({ ok: true, message: `Akun berhasil terhubung dengan profil santri ${stu.full_name}.`, studentId: invite.student_id });
});

// ==============================================================================
// NOTIFICATIONS & PREFERENCES
// ==============================================================================
app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE recipient_profile_id = ? ORDER BY created_at DESC LIMIT 40`)
    .all(req.user!.id);
  res.json({ notifications: rows });
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_profile_id = ?`).run(
    req.params.id,
    req.user!.id
  );
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE recipient_profile_id = ?`).run(req.user!.id);
  res.json({ ok: true });
});

app.get('/api/notification-preferences', requireAuth, (req: AuthedRequest, res) => {
  const pref = db.prepare(`SELECT * FROM notification_preferences WHERE profile_id = ?`).get(req.user!.id);
  res.json({
    preferences: pref ?? {
      profile_id: req.user!.id,
      in_app_enabled: 1,
      whatsapp_enabled: 0,
      whatsapp_consent_at: null,
      phone_number: req.user!.phone,
    },
  });
});

app.patch('/api/notification-preferences', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  const { in_app_enabled, whatsapp_enabled, phone_number } = req.body as {
    in_app_enabled?: boolean;
    whatsapp_enabled?: boolean;
    phone_number?: string;
  };
  const now = new Date().toISOString();
  const consentAt = whatsapp_enabled ? now : null;
  const existing = db.prepare(`SELECT id FROM notification_preferences WHERE profile_id = ?`).get(user.id);

  if (existing) {
    db.prepare(
      `UPDATE notification_preferences
       SET in_app_enabled = ?, whatsapp_enabled = ?, whatsapp_consent_at = COALESCE(?, whatsapp_consent_at),
           phone_number = ?, updated_at = ?
       WHERE profile_id = ?`
    ).run(in_app_enabled ? 1 : 0, whatsapp_enabled ? 1 : 0, consentAt, phone_number ?? user.phone, now, user.id);
  } else {
    db.prepare(
      `INSERT INTO notification_preferences (id, profile_id, in_app_enabled, whatsapp_enabled, whatsapp_consent_at, phone_number, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), user.id, in_app_enabled ? 1 : 0, whatsapp_enabled ? 1 : 0, consentAt, phone_number ?? user.phone, now);
  }
  res.json({ ok: true });
});

// ==============================================================================
// LEADERBOARD (KONSISTENSI PRIBADI — DIKONTROL ADMIN)
// ==============================================================================
app.get('/api/leaderboard', requireAuth, (_req, res) => {
  const vis = db.prepare(`SELECT value FROM system_settings WHERE key = 'leaderboard_visible'`).get() as
    | { value: string }
    | undefined;
  if (vis?.value !== 'true') {
    res.json({ visible: false, entries: [] });
    return;
  }

  const students = db
    .prepare(
      `SELECT s.id, s.full_name, c.class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.enrollment_status = 'aktif'`
    )
    .all() as { id: string; full_name: string; class_name: string | null }[];

  const mushaf = getActiveMushafSetting();
  const entries = students
    .map((stu) => {
      const assessments = getStudentAssessments(stu.id);
      const official = assessments.filter((a) => a.session_status !== 'draft');
      const activeDays = new Set(official.map((a) => a.session_date)).size;
      let totalPages = 0;
      for (let j = 1; j <= mushaf.total_juz; j++) {
        totalPages += calculateJuzProgress(j, assessments, mushaf.default_pages_per_juz, mushaf.passing_threshold).assessedPagesCount;
      }
      const badgeCount = (
        db.prepare(`SELECT COUNT(*) AS c FROM student_badges WHERE student_id = ?`).get(stu.id) as { c: number }
      ).c;
      return {
        student_id: stu.id,
        full_name: stu.full_name,
        class_name: stu.class_name,
        active_days: activeDays,
        total_pages: totalPages,
        badge_count: badgeCount,
      };
    })
    .sort((a, b) => b.active_days - a.active_days || b.total_pages - a.total_pages);

  res.json({ visible: true, entries });
});

// ==============================================================================
// ADMIN MANAGEMENT ENDPOINTS
// ==============================================================================
app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req, res) => {
  const counts = {
    students: (db.prepare(`SELECT COUNT(*) AS c FROM students`).get() as { c: number }).c,
    teachers: (db.prepare(`SELECT COUNT(*) AS c FROM teachers`).get() as { c: number }).c,
    guardians: (db.prepare(`SELECT COUNT(*) AS c FROM guardians`).get() as { c: number }).c,
    classes: (db.prepare(`SELECT COUNT(*) AS c FROM classes`).get() as { c: number }).c,
    sessionsToday: (
      db
        .prepare(`SELECT COUNT(*) AS c FROM hafalan_sessions WHERE session_date = ? AND status != 'draft'`)
        .get(todayJakartaISO()) as { c: number }
    ).c,
    totalOfficialSessions: (
      db.prepare(`SELECT COUNT(*) AS c FROM hafalan_sessions WHERE status != 'draft'`).get() as { c: number }
    ).c,
    pendingApplications: (
      db
        .prepare(`SELECT COUNT(*) AS c FROM pending_applications WHERE status IN ('pending', 'needs_revision')`)
        .get() as { c: number }
    ).c,
  };

  const recentAuditLogs = db
    .prepare(
      `SELECT al.*, p.full_name AS actor_name, p.role AS actor_role
       FROM audit_logs al
       JOIN profiles p ON p.id = al.actor_profile_id
       ORDER BY al.created_at DESC LIMIT 25`
    )
    .all();

  const classes = db
    .prepare(`SELECT * FROM classes ORDER BY class_name ASC`)
    .all() as { id: string; class_name: string; description: string | null; level: string }[];

  const enrichedClasses = classes.map((cls) => {
    const teachers = db
      .prepare(
        `SELECT t.id, p.full_name FROM teacher_assignments ta
         JOIN teachers t ON t.id = ta.teacher_id
         JOIN profiles p ON p.id = t.profile_id
         WHERE ta.class_id = ?`
      )
      .all(cls.id) as { id: string; full_name: string }[];
    const sc = (db.prepare(`SELECT COUNT(*) AS c FROM students WHERE class_id = ?`).get(cls.id) as { c: number }).c;
    return { ...cls, teachers, student_count: sc };
  });

  const teachers = db
    .prepare(
      `SELECT t.*, p.full_name, p.email, p.phone, p.is_active
       FROM teachers t JOIN profiles p ON p.id = t.profile_id
       ORDER BY p.full_name ASC`
    )
    .all() as (Record<string, unknown> & { id: string })[];

  for (const t of teachers) {
    t.assigned_classes = db
      .prepare(
        `SELECT c.id, c.class_name FROM teacher_assignments ta
         JOIN classes c ON c.id = ta.class_id WHERE ta.teacher_id = ?`
      )
      .all(t.id);
  }

  const guardians = db
    .prepare(
      `SELECT g.*, p.full_name, p.email, p.phone, p.is_active
       FROM guardians g JOIN profiles p ON p.id = g.profile_id
       ORDER BY p.full_name ASC`
    )
    .all() as (Record<string, unknown> & { id: string })[];

  for (const g of guardians) {
    g.linked_students = db
      .prepare(
        `SELECT gsl.id AS link_id, gsl.student_id, s.full_name AS student_name, s.student_number,
                gsl.relationship, gsl.is_primary, gsl.audio_access_allowed
         FROM guardian_student_links gsl
         JOIN students s ON s.id = gsl.student_id
         WHERE gsl.guardian_id = ?`
      )
      .all(g.id);
  }

  const invites = db
    .prepare(
      `SELECT gli.id, gli.student_id, s.full_name AS student_name, gli.plain_hint, gli.expires_at, gli.used_at, gli.status, gli.created_at
       FROM guardian_link_invites gli
       JOIN students s ON s.id = gli.student_id
       ORDER BY gli.created_at DESC LIMIT 20`
    )
    .all();

  const badges = db.prepare(`SELECT * FROM badges ORDER BY badge_name ASC`).all();
  const mushafList = db.prepare(`SELECT * FROM mushaf_settings ORDER BY is_default DESC, mushaf_name ASC`).all();
  const whatsappLogs = db
    .prepare(
      `SELECT wl.*, p.full_name AS recipient_name
       FROM whatsapp_logs wl JOIN profiles p ON p.id = wl.recipient_profile_id
       ORDER BY wl.created_at DESC LIMIT 25`
    )
    .all();

  res.json({
    counts,
    classes: enrichedClasses,
    teachers,
    guardians,
    invites,
    badges,
    mushafList,
    recentAuditLogs,
    whatsappLogs,
  });
});

app.post('/api/admin/students', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { full_name, student_number, class_id, create_account, email, password } = req.body as {
    full_name: string;
    student_number: string;
    class_id?: string;
    create_account?: boolean;
    email?: string;
    password?: string;
  };
  if (!full_name?.trim() || !student_number?.trim()) {
    res.status(400).json({ error: 'Nama lengkap dan NIS santri wajib diisi.' });
    return;
  }
  const now = new Date().toISOString();
  const stuId = crypto.randomUUID();
  let profileId: string | null = null;

  try {
    const tx = db.transaction(() => {
      if (create_account && email?.trim()) {
        profileId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO profiles (id, full_name, email, password_hash, role, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'santri', 1, ?, ?)`
        ).run(profileId, full_name.trim(), email.trim(), hashPassword(password || 'Tahfidz2026!'), now, now);
      }
      db.prepare(
        `INSERT INTO students (id, profile_id, student_number, full_name, class_id, enrollment_status, created_at)
         VALUES (?, ?, ?, ?, ?, 'aktif', ?)`
      ).run(stuId, profileId, student_number.trim(), full_name.trim(), class_id || null, now);
      if (class_id) {
        db.prepare(
          `INSERT INTO class_enrollments (id, class_id, student_id, start_date, status) VALUES (?, ?, ?, ?, 'aktif')`
        ).run(crypto.randomUUID(), class_id, stuId, todayJakartaISO());
      }
      writeAuditLog({
        actorProfileId: req.user!.id,
        action: 'TAMBAH_SANTRI',
        entityType: 'student',
        entityId: stuId,
        newValues: { full_name, student_number, class_id },
      });
    });
    tx();
    res.status(201).json({ id: stuId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menambahkan santri (NIS atau email mungkin sudah digunakan).' });
  }
});

app.patch('/api/admin/students/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { full_name, class_id, enrollment_status } = req.body as {
    full_name?: string;
    class_id?: string | null;
    enrollment_status?: string;
  };
  db.prepare(
    `UPDATE students SET full_name = COALESCE(?, full_name), class_id = ?, enrollment_status = COALESCE(?, enrollment_status) WHERE id = ?`
  ).run(full_name ?? null, class_id ?? null, enrollment_status ?? null, req.params.id);
  writeAuditLog({
    actorProfileId: req.user!.id,
    action: 'UBAH_SANTRI',
    entityType: 'student',
    entityId: req.params.id,
    newValues: { full_name, class_id, enrollment_status },
  });
  res.json({ ok: true });
});

app.delete('/api/admin/students/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  db.prepare(`DELETE FROM students WHERE id = ?`).run(req.params.id);
  writeAuditLog({
    actorProfileId: req.user!.id,
    action: 'HAPUS_SANTRI',
    entityType: 'student',
    entityId: req.params.id,
  });
  res.json({ ok: true });
});

app.post('/api/admin/teachers', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { full_name, email, phone, employee_number, specialization, class_id, halaqah_name } = req.body as {
    full_name: string;
    email: string;
    phone?: string;
    employee_number: string;
    specialization?: string;
    class_id?: string;
    halaqah_name?: string;
  };
  if (!full_name?.trim() || !email?.trim() || !employee_number?.trim()) {
    res.status(400).json({ error: 'Nama, email, dan NIP ustadz wajib diisi.' });
    return;
  }
  const now = new Date().toISOString();
  const profId = crypto.randomUUID();
  const tchId = crypto.randomUUID();
  const trimmedHalaqah = halaqah_name?.trim() || '';
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO profiles (id, full_name, email, password_hash, phone, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ustadz', 1, ?, ?)`
      ).run(profId, full_name.trim(), email.trim(), hashPassword('Tahfidz2026!'), phone ?? null, now, now);
      db.prepare(
        `INSERT INTO teachers (id, profile_id, employee_number, specialization, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(
        tchId,
        profId,
        employee_number.trim(),
        specialization?.trim() || (trimmedHalaqah ? `Pengampu ${trimmedHalaqah}` : 'Tahfidz & Tajwid'),
        now
      );
      let resolvedClassId = class_id || '';
      if (!resolvedClassId && trimmedHalaqah) {
        const existingClass = db
          .prepare(`SELECT id FROM classes WHERE LOWER(TRIM(class_name)) = LOWER(TRIM(?)) LIMIT 1`)
          .get(trimmedHalaqah) as { id: string } | undefined;
        if (existingClass) {
          resolvedClassId = existingClass.id;
        } else {
          resolvedClassId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`
          ).run(resolvedClassId, trimmedHalaqah, `Halaqah binaan ${full_name.trim()}`, 'Reguler', now);
        }
      }
      if (resolvedClassId) {
        db.prepare(`INSERT INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`).run(
          crypto.randomUUID(),
          tchId,
          resolvedClassId,
          now
        );
      }
    });
    tx();
    res.status(201).json({ id: tchId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menambahkan ustadz.' });
  }
});

app.post('/api/admin/guardians', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { full_name, email, phone, relationship } = req.body as {
    full_name: string;
    email: string;
    phone?: string;
    relationship?: string;
  };
  if (!full_name?.trim() || !email?.trim()) {
    res.status(400).json({ error: 'Nama dan email wali santri wajib diisi.' });
    return;
  }
  const now = new Date().toISOString();
  const profId = crypto.randomUUID();
  const grdId = crypto.randomUUID();
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO profiles (id, full_name, email, password_hash, phone, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'wali_santri', 1, ?, ?)`
      ).run(profId, full_name.trim(), email.trim(), hashPassword('Tahfidz2026!'), phone ?? null, now, now);
      db.prepare(`INSERT INTO guardians (id, profile_id, relationship, created_at) VALUES (?, ?, ?, ?)`).run(
        grdId,
        profId,
        relationship || 'Orang Tua',
        now
      );
    });
    tx();
    res.status(201).json({ id: grdId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menambahkan wali santri.' });
  }
});

app.post('/api/admin/classes', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { class_name, description, level } = req.body as {
    class_name: string;
    description?: string;
    level?: string;
  };
  if (!class_name?.trim()) {
    res.status(400).json({ error: 'Nama kelas wajib diisi.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO classes (id, class_name, description, level, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    class_name.trim(),
    description ?? null,
    level || 'Reguler',
    new Date().toISOString()
  );
  res.status(201).json({ id });
});

app.post('/api/admin/teacher-assignments', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { teacher_id, class_id } = req.body as { teacher_id: string; class_id: string };
  if (!teacher_id || !class_id) {
    res.status(400).json({ error: 'Ustadz dan kelas wajib dipilih.' });
    return;
  }
  db.prepare(
    `INSERT OR IGNORE INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`
  ).run(crypto.randomUUID(), teacher_id, class_id, new Date().toISOString());
  res.json({ ok: true });
});

app.post('/api/admin/link-invites', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { student_id, expires_days } = req.body as { student_id: string; expires_days?: number };
  if (!student_id) {
    res.status(400).json({ error: 'Pilih santri untuk membuat kode penghubung.' });
    return;
  }
  const rawCode = `HUB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const days = Math.max(1, Math.min(90, Number(expires_days || 7)));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO guardian_link_invites (id, guardian_id, student_id, invitation_code_hash, plain_hint, expires_at, status, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, 'pending', ?)`
  ).run(id, student_id, hashCode(rawCode), rawCode, expiresAt, new Date().toISOString());

  writeAuditLog({
    actorProfileId: req.user!.id,
    action: 'BUAT_KODE_PENGHUBUNG_WALI',
    entityType: 'guardian_link_invite',
    entityId: id,
    newValues: { student_id, expiresAt },
  });

  res.status(201).json({ id, invitation_code: rawCode, expires_at: expiresAt });
});

app.delete('/api/admin/guardian-links/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  db.prepare(`DELETE FROM guardian_student_links WHERE id = ?`).run(req.params.id);
  writeAuditLog({
    actorProfileId: req.user!.id,
    action: 'PUTUS_RELASI_WALI_SANTRI',
    entityType: 'guardian_student_link',
    entityId: req.params.id,
  });
  res.json({ ok: true });
});

app.patch('/api/admin/guardian-links/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { audio_access_allowed } = req.body as { audio_access_allowed: boolean };
  db.prepare(`UPDATE guardian_student_links SET audio_access_allowed = ? WHERE id = ?`).run(
    audio_access_allowed ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

app.post('/api/admin/error-tags', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { tag_name, category, description } = req.body as {
    tag_name: string;
    category: string;
    description?: string;
  };
  if (!tag_name?.trim() || !category) {
    res.status(400).json({ error: 'Nama tag dan kategori wajib diisi.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO error_tags (id, tag_name, category, description, is_active) VALUES (?, ?, ?, ?, 1)`).run(
    id,
    tag_name.trim(),
    category,
    description ?? null
  );
  res.status(201).json({ id });
});

app.patch('/api/admin/error-tags/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { is_active } = req.body as { is_active: boolean };
  db.prepare(`UPDATE error_tags SET is_active = ? WHERE id = ?`).run(is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.patch('/api/admin/mushaf-settings/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { default_pages_per_juz, passing_threshold, set_default } = req.body as {
    default_pages_per_juz?: number;
    passing_threshold?: number;
    set_default?: boolean;
  };
  if (set_default) {
    db.prepare(`UPDATE mushaf_settings SET is_default = 0`).run();
    db.prepare(`UPDATE mushaf_settings SET is_default = 1 WHERE id = ?`).run(req.params.id);
  }
  if (default_pages_per_juz) {
    db.prepare(`UPDATE mushaf_settings SET default_pages_per_juz = ? WHERE id = ?`).run(
      Number(default_pages_per_juz),
      req.params.id
    );
  }
  if (passing_threshold !== undefined) {
    db.prepare(`UPDATE mushaf_settings SET passing_threshold = ? WHERE id = ?`).run(
      Number(passing_threshold),
      req.params.id
    );
    db.prepare(`INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('passing_threshold', ?, ?)`).run(
      String(passing_threshold),
      new Date().toISOString()
    );
  }
  writeAuditLog({
    actorProfileId: req.user!.id,
    action: 'UBAH_PENGATURAN_MUSHAF',
    entityType: 'mushaf_settings',
    entityId: req.params.id,
    newValues: req.body,
  });
  res.json({ ok: true });
});

app.patch('/api/admin/system-settings', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const updates = req.body as Record<string, string>;
  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`);
  for (const [k, v] of Object.entries(updates)) {
    stmt.run(k, String(v), now);
  }
  res.json({ ok: true });
});

app.patch('/api/admin/badges/:id', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const { is_active } = req.body as { is_active: boolean };
  db.prepare(`UPDATE badges SET is_active = ? WHERE id = ?`).run(is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ==============================================================================
// ADMIN MANAJEMEN PERMOHONAN AKUN (REQUEST AKUN)
// ==============================================================================
app.get('/api/admin/applications', requireAuth, requireRole('admin'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT pa.id, pa.supabase_user_id, pa.profile_id, pa.requested_role, pa.full_name, pa.email,
              pa.phone, pa.identity_number, pa.halaqah_name, pa.status, pa.email_verified,
              pa.admin_notes, pa.submitted_at, pa.reviewed_at, pa.reviewed_by, pa.updated_at,
              rev.full_name AS reviewer_name
       FROM pending_applications pa
       LEFT JOIN profiles rev ON rev.id = pa.reviewed_by
       ORDER BY
         CASE pa.status
           WHEN 'pending' THEN 1
           WHEN 'needs_revision' THEN 2
           WHEN 'rejected' THEN 3
           WHEN 'approved' THEN 4
           ELSE 5
         END,
         pa.submitted_at DESC`
    )
    .all() as (Record<string, unknown> & { email_verified: number })[];

  const applications = rows.map((r) => ({
    ...r,
    email_verified: Boolean(r.email_verified),
  }));

  const counts = {
    pending: applications.filter((a) => (a as { status?: string }).status === 'pending').length,
    needs_revision: applications.filter((a) => (a as { status?: string }).status === 'needs_revision').length,
    approved: applications.filter((a) => (a as { status?: string }).status === 'approved').length,
    rejected: applications.filter((a) => (a as { status?: string }).status === 'rejected').length,
    suspended: applications.filter((a) => (a as { status?: string }).status === 'suspended').length,
    total: applications.length,
  };

  const emailLogs = db
    .prepare(`SELECT * FROM email_notifications ORDER BY created_at DESC LIMIT 25`)
    .all();

  const classes = db.prepare(`SELECT id, class_name, level FROM classes ORDER BY class_name ASC`).all();

  res.json({
    applications,
    counts,
    emailLogs,
    classes,
    supabaseStatus: getSupabaseConfigStatus(),
  });
});

app.post('/api/admin/applications/:id/approve', requireAuth, requireRole('admin'), async (req: AuthedRequest, res) => {
  const admin = req.user!;
  const appId = req.params.id;
  const { student_ids, class_id, admin_notes } = req.body as {
    student_ids?: string[];
    class_id?: string;
    admin_notes?: string;
  };

  const appRow = db
    .prepare(`SELECT * FROM pending_applications WHERE id = ? LIMIT 1`)
    .get(appId) as
    | {
        id: string;
        supabase_user_id: string | null;
        profile_id: string | null;
        requested_role: RequestableRole;
        full_name: string;
        email: string;
        phone: string | null;
        identity_number: string | null;
        halaqah_name: string | null;
        status: AccountStatus;
      }
    | undefined;

  if (!appRow) {
    res.status(404).json({ error: 'Data permohonan akun tidak ditemukan.' });
    return;
  }
  if (appRow.status === 'approved') {
    res.status(400).json({ error: 'Permohonan akun ini sudah disetujui sebelumnya.' });
    return;
  }
  if (!appRow.profile_id) {
    res.status(400).json({ error: 'Relasi profil pengguna tidak ditemukan.' });
    return;
  }

  const now = new Date().toISOString();
  const profileId = appRow.profile_id;

  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE pending_applications
         SET status = 'approved', admin_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
         WHERE id = ?`
      ).run(admin_notes?.trim() || null, now, admin.id, now, appRow.id);

      db.prepare(
        `UPDATE profiles
         SET role = ?, is_active = 1, account_status = 'approved', email_verified = 1,
             full_name = ?, phone = ?, updated_at = ?
         WHERE id = ?`
      ).run(appRow.requested_role, appRow.full_name, appRow.phone, now, profileId);

      if (appRow.requested_role === 'santri') {
        const resolvedClassId = class_id
          ? class_id
          : appRow.halaqah_name
            ? resolveOrCreateClassId(appRow.halaqah_name, appRow.full_name, now)
            : null;
        const existingStudent = appRow.identity_number
          ? (db
              .prepare(`SELECT id, profile_id FROM students WHERE student_number = ? LIMIT 1`)
              .get(appRow.identity_number) as { id: string; profile_id: string | null } | undefined)
          : undefined;

        if (existingStudent && !existingStudent.profile_id) {
          db.prepare(
            `UPDATE students SET profile_id = ?, full_name = ?, class_id = COALESCE(?, class_id), enrollment_status = 'aktif' WHERE id = ?`
          ).run(profileId, appRow.full_name, resolvedClassId, existingStudent.id);
          if (resolvedClassId) {
            db.prepare(
              `INSERT OR IGNORE INTO class_enrollments (id, class_id, student_id, start_date, status) VALUES (?, ?, ?, ?, 'aktif')`
            ).run(crypto.randomUUID(), resolvedClassId, existingStudent.id, todayJakartaISO());
          }
        } else if (!existingStudent) {
          const newStuId = crypto.randomUUID();
          const stuNum = appRow.identity_number || `NIS-${Date.now().toString().slice(-6)}`;
          db.prepare(
            `INSERT INTO students (id, profile_id, student_number, full_name, class_id, enrollment_status, created_at)
             VALUES (?, ?, ?, ?, ?, 'aktif', ?)`
          ).run(newStuId, profileId, stuNum, appRow.full_name, resolvedClassId, now);
          if (resolvedClassId) {
            db.prepare(
              `INSERT INTO class_enrollments (id, class_id, student_id, start_date, status) VALUES (?, ?, ?, ?, 'aktif')`
            ).run(crypto.randomUUID(), resolvedClassId, newStuId, todayJakartaISO());
          }
        }
      } else if (appRow.requested_role === 'ustadz') {
        const resolvedClassId = class_id
          ? class_id
          : appRow.halaqah_name
            ? resolveOrCreateClassId(appRow.halaqah_name, appRow.full_name, now)
            : null;
        let teacherRow = db
          .prepare(`SELECT id FROM teachers WHERE profile_id = ? LIMIT 1`)
          .get(profileId) as { id: string } | undefined;
        if (!teacherRow) {
          const tchId = crypto.randomUUID();
          const empNum = appRow.identity_number || `UST-${Date.now().toString().slice(-6)}`;
          db.prepare(
            `INSERT INTO teachers (id, profile_id, employee_number, specialization, created_at) VALUES (?, ?, ?, ?, ?)`
          ).run(
            tchId,
            profileId,
            empNum,
            appRow.halaqah_name ? `Pengampu ${appRow.halaqah_name}` : 'Tahfidz & Tajwid',
            now
          );
          teacherRow = { id: tchId };
        }
        if (resolvedClassId) {
          db.prepare(
            `INSERT OR IGNORE INTO teacher_assignments (id, teacher_id, class_id, assigned_at) VALUES (?, ?, ?, ?)`
          ).run(crypto.randomUUID(), teacherRow.id, resolvedClassId, now);
        }
      } else if (appRow.requested_role === 'wali_santri') {
        let guardianRow = db
          .prepare(`SELECT id FROM guardians WHERE profile_id = ? LIMIT 1`)
          .get(profileId) as { id: string } | undefined;
        if (!guardianRow) {
          const grdId = crypto.randomUUID();
          db.prepare(`INSERT INTO guardians (id, profile_id, relationship, created_at) VALUES (?, ?, 'Orang Tua', ?)`).run(
            grdId,
            profileId,
            now
          );
          guardianRow = { id: grdId };
        }
        if (Array.isArray(student_ids) && student_ids.length > 0) {
          const linkStmt = db.prepare(
            `INSERT OR IGNORE INTO guardian_student_links (id, guardian_id, student_id, relationship, is_primary, audio_access_allowed, created_at)
             VALUES (?, ?, ?, 'Orang Tua', 1, 1, ?)`
          );
          for (const sid of student_ids) {
            if (sid) linkStmt.run(crypto.randomUUID(), guardianRow.id, sid, now);
          }
        }
      }

      db.prepare(
        `INSERT INTO notifications (id, recipient_profile_id, title, message, notification_type, related_entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, 'integrasi', ?, 0, ?)`
      ).run(
        crypto.randomUUID(),
        profileId,
        'Akun E-Tahfidz Anda Telah Disetujui',
        'Selamat! Permohonan akun E-Tahfidz Anda telah disetujui oleh administrator. Akun Anda sekarang sudah aktif dan dapat digunakan untuk mengakses dashboard.',
        appRow.id,
        now
      );

      writeAuditLog({
        actorProfileId: admin.id,
        action: 'SETUJUI_PERMOHONAN_AKUN',
        entityType: 'pending_application',
        entityId: appRow.id,
        newValues: {
          approved_role: appRow.requested_role,
          email: appRow.email,
          linked_students_count: Array.isArray(student_ids) ? student_ids.length : 0,
        },
      });
    })();

    const emailBody = [
      "Assalamu'alaikum.",
      '',
      'Selamat! Permohonan akun E-Tahfidz Anda telah disetujui oleh administrator.',
      '',
      'Akun Anda sekarang sudah aktif dan dapat digunakan untuk login ke aplikasi E-Tahfidz.',
      '',
      'Silakan masuk menggunakan email dan password yang telah Anda daftarkan.',
      '',
      'Terima kasih.',
    ].join('\n');

    await recordEmailNotification({
      recipientEmail: appRow.email,
      recipientName: appRow.full_name,
      subject: 'Persetujuan Akun E-Tahfidz — Akun Anda Telah Aktif',
      body: emailBody,
    });

    if (appRow.supabase_user_id && getSupabaseConfigStatus().adminConfigured) {
      await adminUpdateSupabaseUserMetadata({
        supabaseUserId: appRow.supabase_user_id,
        role: appRow.requested_role,
        accountStatus: 'approved',
      });
    }

    res.json({ ok: true, message: `Akun ${appRow.full_name} berhasil disetujui dan diaktifkan.` });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menyetujui permohonan akun.' });
  }
});

app.post('/api/admin/applications/:id/reject', requireAuth, requireRole('admin'), async (req: AuthedRequest, res) => {
  const admin = req.user!;
  const appId = req.params.id;
  const { admin_notes } = req.body as { admin_notes?: string };
  if (!admin_notes?.trim()) {
    res.status(400).json({ error: 'Alasan penolakan wajib diisi agar pemohon mengetahui tindak lanjutnya.' });
    return;
  }

  const appRow = db.prepare(`SELECT * FROM pending_applications WHERE id = ? LIMIT 1`).get(appId) as
    | { id: string; profile_id: string | null; full_name: string; email: string }
    | undefined;
  if (!appRow) {
    res.status(404).json({ error: 'Data permohonan akun tidak ditemukan.' });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE pending_applications
       SET status = 'rejected', admin_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(admin_notes.trim(), now, admin.id, now, appRow.id);

    if (appRow.profile_id) {
      db.prepare(`UPDATE profiles SET account_status = 'rejected', is_active = 0, updated_at = ? WHERE id = ?`).run(
        now,
        appRow.profile_id
      );
    }

    writeAuditLog({
      actorProfileId: admin.id,
      action: 'TOLAK_PERMOHONAN_AKUN',
      entityType: 'pending_application',
      entityId: appRow.id,
      newValues: { status: 'rejected', admin_notes: admin_notes.trim() },
    });
  })();

  await recordEmailNotification({
    recipientEmail: appRow.email,
    recipientName: appRow.full_name,
    subject: 'Status Permohonan Akun E-Tahfidz — Ditolak',
    body: `Assalamu'alaikum ${appRow.full_name}.\n\nMohon maaf, permohonan akun E-Tahfidz Anda belum dapat disetujui.\n\nAlasan: ${admin_notes.trim()}\n\nAnda dapat masuk menggunakan email dan password yang didaftarkan untuk memperbaiki data permohonan dan mengajukan ulang.`,
  });

  res.json({ ok: true, message: 'Permohonan akun telah ditolak.' });
});

app.post(
  '/api/admin/applications/:id/request-revision',
  requireAuth,
  requireRole('admin'),
  async (req: AuthedRequest, res) => {
    const admin = req.user!;
    const appId = req.params.id;
    const { admin_notes } = req.body as { admin_notes?: string };
    if (!admin_notes?.trim()) {
      res.status(400).json({ error: 'Catatan perbaikan wajib diisi untuk pemohon.' });
      return;
    }

    const appRow = db.prepare(`SELECT * FROM pending_applications WHERE id = ? LIMIT 1`).get(appId) as
      | { id: string; profile_id: string | null; full_name: string; email: string }
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Data permohonan akun tidak ditemukan.' });
      return;
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `UPDATE pending_applications
         SET status = 'needs_revision', admin_notes = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
         WHERE id = ?`
      ).run(admin_notes.trim(), now, admin.id, now, appRow.id);

      if (appRow.profile_id) {
        db.prepare(
          `UPDATE profiles SET account_status = 'needs_revision', is_active = 0, updated_at = ? WHERE id = ?`
        ).run(now, appRow.profile_id);
      }

      writeAuditLog({
        actorProfileId: admin.id,
        action: 'MINTA_PERBAIKAN_PERMOHONAN_AKUN',
        entityType: 'pending_application',
        entityId: appRow.id,
        newValues: { status: 'needs_revision', admin_notes: admin_notes.trim() },
      });
    })();

    await recordEmailNotification({
      recipientEmail: appRow.email,
      recipientName: appRow.full_name,
      subject: 'Permohonan Akun E-Tahfidz — Perlu Perbaikan Data',
      body: `Assalamu'alaikum ${appRow.full_name}.\n\nPermohonan akun E-Tahfidz Anda memerlukan perbaikan data sebelum disetujui.\n\nInstruksi Administrator: ${admin_notes.trim()}\n\nSilakan masuk ke aplikasi menggunakan email dan password Anda untuk memperbarui data permohonan.`,
    });

    res.json({ ok: true, message: 'Permintaan perbaikan telah dikirim ke pemohon.' });
  }
);

app.post('/api/admin/profiles/:id/status', requireAuth, requireRole('admin'), (req: AuthedRequest, res) => {
  const admin = req.user!;
  const targetId = req.params.id;
  const { status } = req.body as { status?: 'approved' | 'suspended' };
  if (targetId === admin.id) {
    res.status(400).json({ error: 'Administrator tidak dapat menonaktifkan akunnya sendiri.' });
    return;
  }
  if (!status || !['approved', 'suspended'].includes(status)) {
    res.status(400).json({ error: 'Status akun tidak valid.' });
    return;
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE profiles SET account_status = ?, is_active = ?, updated_at = ? WHERE id = ?`).run(
      status,
      status === 'approved' ? 1 : 0,
      now,
      targetId
    );
    db.prepare(`UPDATE pending_applications SET status = ?, updated_at = ? WHERE profile_id = ?`).run(
      status,
      now,
      targetId
    );
    writeAuditLog({
      actorProfileId: admin.id,
      action: status === 'suspended' ? 'NONAKTIFKAN_AKUN' : 'AKTIFKAN_AKUN',
      entityType: 'profile',
      entityId: targetId,
      newValues: { account_status: status },
    });
  })();
  res.json({ ok: true });
});

// ==============================================================================
// VITE MIDDLEWARE / PRODUCTION STATIC SERVING
// ==============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: { server: httpServer, path: '/__vite_hmr' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`E-Tahfidz full-stack server running on http://localhost:${port}`);
  });
}

startServer();
