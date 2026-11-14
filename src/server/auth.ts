import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { AccountStatus, UserRole } from '../types/tahfidz.ts';

const SECRET = process.env.SESSION_SECRET || 'etahfidz-dev-secret-change-in-production-2026';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  avatar_url: string | null;
  account_status?: AccountStatus;
  email_verified?: boolean;
  auth_provider?: string;
}

export interface ProfileSessionInfo extends AuthUser {
  is_active: boolean;
  account_status: AccountStatus;
  email_verified: boolean;
  auth_provider: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionInfo?: ProfileSessionInfo;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export function signToken(payload: Record<string, unknown>, ttlSeconds = 60 * 60 * 24 * 7): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T & { exp: number };
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'etahfidz_session') {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  return null;
}

export function getProfileSessionInfo(profileId: string): ProfileSessionInfo | null {
  const row = db
    .prepare(
      `SELECT id, email, full_name, role, phone, avatar_url, is_active, account_status, email_verified, auth_provider
       FROM profiles WHERE id = ?`
    )
    .get(profileId) as
    | (Omit<ProfileSessionInfo, 'is_active' | 'email_verified'> & {
        is_active: number;
        email_verified: number;
      })
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    phone: row.phone,
    avatar_url: row.avatar_url,
    is_active: Boolean(row.is_active),
    account_status: row.account_status || 'approved',
    email_verified: Boolean(row.email_verified),
    auth_provider: row.auth_provider || 'local',
  };
}

export function getProfileById(profileId: string): AuthUser | null {
  const info = getProfileSessionInfo(profileId);
  if (!info || !info.is_active || info.account_status !== 'approved') return null;
  return {
    id: info.id,
    email: info.email,
    full_name: info.full_name,
    role: info.role,
    phone: info.phone,
    avatar_url: info.avatar_url,
    account_status: info.account_status,
    email_verified: info.email_verified,
    auth_provider: info.auth_provider,
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi autentikasi diperlukan. Silakan login terlebih dahulu.' });
    return;
  }
  const payload = verifyToken<{ uid: string }>(token);
  if (!payload?.uid) {
    res.status(401).json({ error: 'Token sesi tidak valid atau telah kedaluwarsa.' });
    return;
  }
  const info = getProfileSessionInfo(payload.uid);
  if (!info) {
    res.status(401).json({ error: 'Akun tidak ditemukan.' });
    return;
  }
  if (info.account_status === 'suspended' || (info.account_status === 'approved' && !info.is_active)) {
    res.status(403).json({ error: 'Akun Anda telah dinonaktifkan oleh administrator. Akses dashboard diblokir.' });
    return;
  }
  if (info.account_status !== 'approved' || !info.is_active) {
    res.status(403).json({ error: 'Akun Anda masih menunggu verifikasi administrator dan belum dapat mengakses dashboard.' });
    return;
  }
  req.user = {
    id: info.id,
    email: info.email,
    full_name: info.full_name,
    role: info.role,
    phone: info.phone,
    avatar_url: info.avatar_url,
    account_status: info.account_status,
    email_verified: info.email_verified,
    auth_provider: info.auth_provider,
  };
  next();
}

export function requireAccountHolder(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Sesi autentikasi diperlukan.' });
    return;
  }
  const payload = verifyToken<{ uid: string }>(token);
  if (!payload?.uid) {
    res.status(401).json({ error: 'Token sesi tidak valid atau telah kedaluwarsa.' });
    return;
  }
  const info = getProfileSessionInfo(payload.uid);
  if (!info) {
    res.status(401).json({ error: 'Akun tidak ditemukan.' });
    return;
  }
  req.sessionInfo = info;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Autentikasi diperlukan.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Akses ditolak. Peran akun Anda tidak memiliki kewenangan untuk tindakan ini.',
      });
      return;
    }
    next();
  };
}

export function getAccessibleStudentIds(user: AuthUser): string[] {
  if (user.role === 'admin') {
    const rows = db.prepare(`SELECT id FROM students`).all() as { id: string }[];
    return rows.map((r) => r.id);
  }
  if (user.role === 'ustadz') {
    const rows = db
      .prepare(
        `SELECT DISTINCT s.id
         FROM students s
         JOIN teacher_assignments ta ON ta.class_id = s.class_id
         JOIN teachers t ON t.id = ta.teacher_id
         WHERE t.profile_id = ?`
      )
      .all(user.id) as { id: string }[];
    return rows.map((r) => r.id);
  }
  if (user.role === 'wali_santri') {
    const rows = db
      .prepare(
        `SELECT DISTINCT gsl.student_id AS id
         FROM guardian_student_links gsl
         JOIN guardians g ON g.id = gsl.guardian_id
         WHERE g.profile_id = ?`
      )
      .all(user.id) as { id: string }[];
    return rows.map((r) => r.id);
  }
  if (user.role === 'santri') {
    const rows = db
      .prepare(`SELECT id FROM students WHERE profile_id = ?`)
      .all(user.id) as { id: string }[];
    return rows.map((r) => r.id);
  }
  return [];
}

export function canAccessStudent(user: AuthUser, studentId: string): boolean {
  if (user.role === 'admin') return true;
  const ids = getAccessibleStudentIds(user);
  return ids.includes(studentId);
}

export function writeAuditLog(params: {
  actorProfileId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_profile_id, action, entity_type, entity_id, old_values, new_values, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.actorProfileId,
    params.action,
    params.entityType,
    params.entityId,
    params.oldValues !== undefined ? JSON.stringify(params.oldValues) : null,
    params.newValues !== undefined ? JSON.stringify(params.newValues) : null,
    new Date().toISOString()
  );
}
