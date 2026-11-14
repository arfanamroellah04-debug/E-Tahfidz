import type { RequestableRole } from '../types/tahfidz.ts';

function getSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { url, anonKey, serviceRoleKey };
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  adminConfigured: boolean;
  urlConfigured: boolean;
} {
  const { url, anonKey, serviceRoleKey } = getSupabaseEnv();
  return {
    configured: Boolean(url && anonKey),
    adminConfigured: Boolean(url && serviceRoleKey),
    urlConfigured: Boolean(url),
  };
}

export async function signUpWithSupabaseAuth(params: {
  email: string;
  password: string;
  fullName: string;
  requestedRole: RequestableRole;
}): Promise<{
  ok: boolean;
  userId?: string;
  emailVerified?: boolean;
  alreadyRegistered?: boolean;
  error?: string;
}> {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return { ok: false, error: 'Supabase Auth belum dikonfigurasi pada environment server.' };
  }

  try {
    const resp = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        data: {
          full_name: params.fullName,
          requested_role: params.requestedRole,
        },
      }),
    });

    const data = (await resp.json().catch(() => ({}))) as {
      id?: string;
      user?: { id?: string; email_confirmed_at?: string | null; confirmed_at?: string | null };
      msg?: string;
      message?: string;
      error_description?: string;
      code?: string;
    };

    if (!resp.ok) {
      const msg = data.msg || data.message || data.error_description || 'Pendaftaran Supabase Auth gagal.';
      const alreadyRegistered =
        resp.status === 422 ||
        msg.toLowerCase().includes('already registered') ||
        msg.toLowerCase().includes('already exists');
      return { ok: false, alreadyRegistered, error: msg };
    }

    const userId = data.user?.id || data.id;
    const emailVerified = Boolean(data.user?.email_confirmed_at || data.user?.confirmed_at);
    return { ok: true, userId, emailVerified };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menghubungi server Supabase Auth.',
    };
  }
}

export async function signInWithSupabaseAuth(params: {
  email: string;
  password: string;
}): Promise<{
  ok: boolean;
  userId?: string;
  emailVerified?: boolean;
  emailNotConfirmed?: boolean;
  error?: string;
}> {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return { ok: false, error: 'Supabase Auth belum dikonfigurasi.' };
  }

  try {
    const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
    });

    const data = (await resp.json().catch(() => ({}))) as {
      user?: { id?: string; email_confirmed_at?: string | null; confirmed_at?: string | null };
      error_code?: string;
      msg?: string;
      error_description?: string;
    };

    if (!resp.ok) {
      const msg = data.error_description || data.msg || 'Email atau kata sandi tidak sesuai.';
      const emailNotConfirmed =
        data.error_code === 'email_not_confirmed' || msg.toLowerCase().includes('email not confirmed');
      return { ok: false, emailNotConfirmed, error: msg };
    }

    return {
      ok: true,
      userId: data.user?.id,
      emailVerified: Boolean(data.user?.email_confirmed_at || data.user?.confirmed_at),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menghubungi server Supabase Auth.',
    };
  }
}

export async function adminUpdateSupabaseUserMetadata(params: {
  supabaseUserId: string;
  role: string;
  accountStatus: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.' };
  }

  try {
    const resp = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(params.supabaseUserId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        app_metadata: {
          role: params.role,
          account_status: params.accountStatus,
        },
      }),
    });
    if (!resp.ok) {
      return { ok: false, error: `Supabase Admin API HTTP ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Supabase Admin API error' };
  }
}
