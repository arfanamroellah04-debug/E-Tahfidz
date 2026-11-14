import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, Link2, Save, User } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatTanggalWaktuWIB } from '../lib/formatters';
import type { NotificationRecord, Profile } from '../types/tahfidz';

interface ProfileAndNotificationsProps {
  user: Profile;
  notifications: NotificationRecord[];
  onRefreshNotifications: () => void;
  onProfileUpdated: (user: Profile) => void;
  onChildLinked: (studentId: string) => void;
}

export const ProfileAndNotifications: React.FC<ProfileAndNotificationsProps> = ({
  user,
  notifications,
  onRefreshNotifications,
  onProfileUpdated,
  onChildLinked,
}) => {
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone || '');
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waPhone, setWaPhone] = useState(user.phone || '');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Guardian Invite Code
  const [inviteCode, setInviteCode] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{
      preferences: {
        in_app_enabled: number;
        whatsapp_enabled: number;
        phone_number: string | null;
      };
    }>('/api/notification-preferences')
      .then((res) => {
        setInAppEnabled(Boolean(res.preferences.in_app_enabled));
        setWaEnabled(Boolean(res.preferences.whatsapp_enabled));
        setWaPhone(res.preferences.phone_number || user.phone || '');
      })
      .catch(() => {});
  }, [user.phone]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    const res = await apiFetch<{ user: Profile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ full_name: fullName, phone }),
    });
    await apiFetch('/api/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        in_app_enabled: inAppEnabled,
        whatsapp_enabled: waEnabled,
        phone_number: waPhone,
      }),
    });
    onProfileUpdated(res.user);
    setSaveMsg('Profil dan preferensi pemberitahuan berhasil diperbarui.');
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMsg(null);
    setInviteErr(null);
    try {
      const res = await apiFetch<{ message: string; studentId: string }>('/api/guardian/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ invitation_code: inviteCode }),
      });
      setInviteMsg(res.message);
      setInviteCode('');
      onChildLinked(res.studentId);
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : 'Kode penghubung tidak valid.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pengaturan Profil Pribadi */}
        <form onSubmit={handleSaveProfile} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
            <User className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            Profil Akun &amp; Preferensi Notifikasi
          </h3>

          {saveMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {saveMsg}
            </div>
          )}

          <div className="space-y-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Tampilan</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email Akun</label>
                <input
                  type="email"
                  disabled
                  value={user.email}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Peran Akun (Dikunci Sistem)</label>
                <input
                  type="text"
                  disabled
                  value={user.role.replace('_', ' ')}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 capitalize"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nomor HP Kontak</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
              <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inAppEnabled}
                  onChange={(e) => setInAppEnabled(e.target.checked)}
                />
                <span>Aktifkan notifikasi real-time di dalam aplikasi</span>
              </label>

              <label className="flex items-start gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={waEnabled}
                  onChange={(e) => setWaEnabled(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Saya menyetujui pengiriman ringkasan laporan setoran melalui WhatsApp Gateway (apabila telah diaktifkan Admin).
                </span>
              </label>

              {waEnabled && (
                <div className="pt-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nomor WhatsApp Tujuan</label>
                  <input
                    type="text"
                    value={waPhone}
                    onChange={(e) => setWaPhone(e.target.value)}
                    placeholder="0812xxxxxxxx"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            <Save className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Simpan Profil &amp; Preferensi</span>
          </button>
        </form>

        {/* Penghubung Anak via Kode Undangan (Khusus Wali Santri) */}
        <div className="space-y-6">
          {user.role === 'wali_santri' && (
            <form onSubmit={handleAcceptInvite} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Hubungkan Profil Anak dengan Kode Undangan
              </h3>
              <p className="text-xs text-slate-500">
                Masukkan kode penghubung resmi dari Admin untuk memantau anak tambahan pada akun wali Anda (contoh kode demo: <span className="font-mono font-semibold text-slate-800">HUB-HANA-2026</span>).
              </p>

              {inviteMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  {inviteMsg}
                </div>
              )}
              {inviteErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {inviteErr}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Masukkan kode (misal HUB-HANA-2026)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Verifikasi
                </button>
              </div>
            </form>
          )}

          {/* Daftar Notifikasi */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Pusat Notifikasi Real-Time
              </h3>
              {notifications.some((n) => !n.is_read) && (
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/notifications/read-all', { method: 'POST' });
                    onRefreshNotifications();
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                >
                  <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Tandai semua dibaca</span>
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">Belum ada notifikasi.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {notifications.map((n) => (
                  <div key={n.id} className={`py-3 space-y-1 ${n.is_read ? 'opacity-70' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">{n.title}</span>
                      {!n.is_read && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' });
                            onRefreshNotifications();
                          }}
                          className="text-[11px] font-medium text-emerald-700 hover:underline shrink-0"
                        >
                          Tandai dibaca
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{n.message}</p>
                    <p className="text-[11px] text-slate-400">{formatTanggalWaktuWIB(n.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
