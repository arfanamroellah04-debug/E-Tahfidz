import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  ClipboardPlus,
  Database,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken, useTahfidzWebSocket } from './lib/api';
import { formatNilaiID, formatTanggalID, todayJakartaISO } from './lib/formatters';
import { AccountStatusView } from './components/AccountStatusView';
import { AdminApplicationsPanel } from './components/AdminApplicationsPanel';
import { AdminConsole } from './components/AdminConsole';
import { ErrorStatsPanel } from './components/ErrorStatsPanel';
import { LoginView } from './components/LoginView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallBanner';
import { ProfileAndNotifications } from './components/ProfileAndNotifications';
import { SessionInputForm } from './components/SessionInputForm';
import { StudentDetailWorkspace } from './components/StudentDetailWorkspace';
import type {
  MushafSetting,
  NotificationRecord,
  PendingApplicationRecord,
  Profile,
  SessionType,
  StudentRecord,
} from './types/tahfidz';

interface EnrichedStudent extends StudentRecord {
  completedJuz: number;
  totalPages: number;
  averageScore: number | null;
  lastSession: { session_date: string; session_type: string; juz_number: number } | null;
}

interface SystemStatusPayload {
  geminiConfigured: boolean;
  whatsappConfigured: boolean;
  whatsappProvider: string;
  supabaseConfigured?: boolean;
  pendingApplicationsCount?: number;
  settings: Record<string, string>;
  mushaf: MushafSetting;
}

type NavKey =
  | 'beranda'
  | 'input_setoran'
  | 'santri_detail'
  | 'statistik_kesalahan'
  | 'admin_applications'
  | 'admin_users'
  | 'admin_linking'
  | 'admin_settings'
  | 'admin_erd'
  | 'profil_notifikasi';

export default function App() {
  const [user, setUser] = useState<Profile | null>(null);
  const [pendingApp, setPendingApp] = useState<PendingApplicationRecord | null>(null);
  const [justSubmittedApp, setJustSubmittedApp] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const [students, setStudents] = useState<EnrichedStudent[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatusPayload | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>('beranda');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [liveToast, setLiveToast] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [sessionInputDefaultType, setSessionInputDefaultType] = useState<SessionType>('ziyadah');

  const isApprovedUser = Boolean(user && (!user.account_status || user.account_status === 'approved') && user.is_active);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [stuRes, notifRes, sysRes] = await Promise.all([
        apiFetch<{ students: EnrichedStudent[] }>('/api/students'),
        apiFetch<{ notifications: NotificationRecord[] }>('/api/notifications'),
        apiFetch<SystemStatusPayload>('/api/system/status'),
      ]);
      setStudents(stuRes.students);
      setNotifications(notifRes.notifications);
      setSystemStatus(sysRes);
      setSelectedStudentId((prev) => {
        if (prev && stuRes.students.some((s) => s.id === prev)) return prev;
        return stuRes.students[0]?.id || '';
      });
    } catch {
      // ignore if unauthorized
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<{
      authenticated: boolean;
      user: Profile | null;
      application?: PendingApplicationRecord | null;
      token?: string;
    }>('/api/auth/session')
      .then((res) => {
        if (res.authenticated && res.user) {
          if (res.token && !token) setStoredToken(res.token);
          setUser(res.user);
          setPendingApp(res.application ?? null);
          if (!res.user.account_status || res.user.account_status === 'approved') {
            void loadWorkspaceData();
          }
        } else {
          setStoredToken(null);
          setUser(null);
          setPendingApp(null);
        }
      })
      .catch(() => {
        setStoredToken(null);
        setUser(null);
        setPendingApp(null);
      })
      .finally(() => setAuthChecking(false));
  }, [loadWorkspaceData]);

  const { connected: wsConnected } = useTahfidzWebSocket(isApprovedUser, (evt) => {
    if (evt.type === 'session:published' || evt.type === 'session:updated') {
      setLiveToast('Pembaruan laporan setoran baru diterima secara real-time.');
      setRefreshTrigger((t) => t + 1);
      void loadWorkspaceData();
      setTimeout(() => setLiveToast(null), 5000);
    }
  });

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredToken(null);
    setUser(null);
    setPendingApp(null);
    setJustSubmittedApp(false);
    setStudents([]);
    setNotifications([]);
    setSelectedStudentId('');
    setStudentSearch('');
    setLiveToast(null);
    setMobileMenuOpen(false);
    setActiveNav('beranda');
  };

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const navItems = useMemo(() => {
    if (!user) return [];
    if (user.role === 'admin') {
      return [
        { id: 'beranda' as NavKey, label: 'Dashboard Admin', icon: LayoutDashboard },
        { id: 'admin_applications' as NavKey, label: 'Permohonan Akun', icon: UserCheck },
        { id: 'admin_users' as NavKey, label: 'Data Pengguna & Kelas', icon: Users },
        { id: 'admin_linking' as NavKey, label: 'Relasi Wali & Anak', icon: Link2 },
        { id: 'input_setoran' as NavKey, label: 'Input Setoran', icon: ClipboardPlus },
        { id: 'santri_detail' as NavKey, label: 'Detail & Laporan Santri', icon: BookOpen },
        { id: 'statistik_kesalahan' as NavKey, label: 'Statistik Kesalahan', icon: ShieldAlert },
        { id: 'admin_settings' as NavKey, label: 'Pengaturan & WhatsApp', icon: Settings },
        { id: 'admin_erd' as NavKey, label: 'ERD Database (23 Tabel)', icon: Database },
        { id: 'profil_notifikasi' as NavKey, label: 'Notifikasi & Profil', icon: Bell },
      ];
    }
    if (user.role === 'ustadz') {
      return [
        { id: 'beranda' as NavKey, label: 'Beranda Halaqah', icon: LayoutDashboard },
        { id: 'input_setoran' as NavKey, label: 'Input Setoran', icon: ClipboardPlus },
        { id: 'santri_detail' as NavKey, label: 'Progres & Evaluasi Santri', icon: BookOpen },
        { id: 'statistik_kesalahan' as NavKey, label: 'Statistik Kesalahan', icon: BarChart3 },
        { id: 'profil_notifikasi' as NavKey, label: 'Profil & Notifikasi', icon: User },
      ];
    }
    if (user.role === 'wali_santri') {
      return [
        { id: 'beranda' as NavKey, label: 'Pantauan Anak', icon: LayoutDashboard },
        { id: 'statistik_kesalahan' as NavKey, label: 'Analisis Kesalahan', icon: BarChart3 },
        { id: 'profil_notifikasi' as NavKey, label: 'Profil & Notifikasi', icon: Bell },
      ];
    }
    return [
      { id: 'beranda' as NavKey, label: 'Hafalan Saya', icon: LayoutDashboard },
      { id: 'statistik_kesalahan' as NavKey, label: 'Evaluasi Kesalahan', icon: BarChart3 },
      { id: 'profil_notifikasi' as NavKey, label: 'Profil & Notifikasi', icon: User },
    ];
  }, [user]);

  const todayISO = todayJakartaISO();
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.student_number.toLowerCase().includes(q) ||
        (s.class_name || '').toLowerCase().includes(q)
    );
  }, [students, studentSearch]);

  const activeMushaf: MushafSetting = systemStatus?.mushaf ?? {
    id: 'default',
    mushaf_name: 'Mushaf Madinah (Rasm Utsmani)',
    total_juz: 30,
    default_pages_per_juz: 20,
    passing_threshold: 80,
    is_default: true,
    created_at: '',
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Memuat ruang kerja E-Tahfidz...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginView
          onSuccess={(loggedUser, _token, application, justSubmitted) => {
            setLiveToast(null);
            setMobileMenuOpen(false);
            setStudentSearch('');
            setUser(loggedUser);
            setPendingApp(application ?? null);
            setJustSubmittedApp(Boolean(justSubmitted));
            setActiveNav('beranda');
            if (!loggedUser.account_status || loggedUser.account_status === 'approved') {
              void loadWorkspaceData();
            }
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  // Keamanan: Blokir akses dashboard utama jika akun belum berstatus approved
  if (user.account_status && user.account_status !== 'approved') {
    return (
      <>
        <AccountStatusView
          user={user}
          application={pendingApp}
          justSubmitted={justSubmittedApp}
          onRefreshStatus={async () => {
            const res = await apiFetch<{ user: Profile; application: PendingApplicationRecord | null }>(
              '/api/account-requests/me'
            );
            setUser(res.user);
            setPendingApp(res.application);
            if (!res.user.account_status || res.user.account_status === 'approved') {
              setJustSubmittedApp(false);
              void loadWorkspaceData();
            }
          }}
          onApplicationUpdated={(updatedUser, updatedApp) => {
            setUser(updatedUser);
            setPendingApp(updatedApp);
            setJustSubmittedApp(false);
          }}
          onLogout={() => void handleLogout()}
        />
        <OfflineIndicator />
      </>
    );
  }

  const institutionName = systemStatus?.settings.institution_name || 'Pondok Pesantren Tahfidz Al-Furqan';
  const roleLabel =
    user.role === 'admin'
      ? 'Administrator'
      : user.role === 'ustadz'
        ? 'Ustadz / Musyrif'
        : user.role === 'wali_santri'
          ? 'Wali Santri'
          : 'Santri';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900 text-slate-100 border-r border-slate-800 no-print">
        <div className="p-5 border-b border-slate-800 flex items-center gap-3">
          <img
            src="/src/assets/images/etahfidz_emblem_1794618124579.jpg"
            alt="Lambang E-Tahfidz"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-lg object-cover bg-white shrink-0"
          />
          <div className="min-w-0">
            <span className="font-display text-base font-bold text-white block truncate">E-Tahfidz</span>
            <span className="text-[11px] text-emerald-300 block truncate">{roleLabel}</span>
          </div>
        </div>

        <nav aria-label="Menu Utama" className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === 'input_setoran') setSessionInputDefaultType('ziyadah');
                  setActiveNav(item.id);
                }}
                className={`w-full flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors text-left ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'profil_notifikasi' && unreadCount > 0 && (
                  <span className="font-mono text-[11px] font-bold bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded">
                    {unreadCount}
                  </span>
                )}
                {item.id === 'admin_applications' && (systemStatus?.pendingApplicationsCount || 0) > 0 && (
                  <span className="font-mono text-[11px] font-bold bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded">
                    {systemStatus?.pendingApplicationsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-white truncate">{user.full_name}</p>
            <p className="text-slate-400 truncate text-[11px]">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Keluar Akun</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-16 lg:pb-0">
        {/* Top Header Bar (3-zone contract) */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-display text-sm sm:text-base font-bold text-slate-900 truncate whitespace-nowrap">
              {navItems.find((n) => n.id === activeNav)?.label || 'E-Tahfidz'}
            </span>
          </div>

          {/* Child Switcher untuk Wali Santri atau Pemilih Santri untuk Ustadz/Admin */}
          <div className="flex items-center gap-3 shrink-0">
            {user.role === 'wali_santri' && students.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="child-switcher" className="hidden sm:inline text-xs font-medium text-slate-500">
                  Anak:
                </label>
                <select
                  id="child-switcher"
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-950"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <PWAInstallButton compact />

            <button
              type="button"
              onClick={() => setActiveNav('profil_notifikasi')}
              aria-label={`Notifikasi (${unreadCount} belum dibaca)`}
              className="relative rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-amber-600 text-[10px] font-mono font-bold text-white flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Live WebSocket Toast */}
        {liveToast && (
          <div
            role="status"
            className="mx-4 sm:mx-6 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-950 flex items-center justify-between gap-3"
          >
            <span>{liveToast}</span>
            <button type="button" onClick={() => setLiveToast(null)} aria-label="Tutup pemberitahuan">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* ==================== ADMIN VIEWS ==================== */}
          {user.role === 'admin' && activeNav === 'beranda' && (
            <AdminConsole
              section="overview"
              students={students}
              geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
              whatsappConfigured={Boolean(systemStatus?.whatsappConfigured)}
              whatsappProvider={systemStatus?.whatsappProvider || 'belum_dikonfigurasi'}
              systemSettings={systemStatus?.settings || {}}
              onRefreshAll={() => void loadWorkspaceData()}
              onOpenApplications={() => setActiveNav('admin_applications')}
            />
          )}
          {user.role === 'admin' && activeNav === 'admin_applications' && (
            <AdminApplicationsPanel
              students={students}
              onRefreshAll={() => void loadWorkspaceData()}
            />
          )}
          {user.role === 'admin' && activeNav === 'admin_users' && (
            <AdminConsole
              section="users"
              students={students}
              geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
              whatsappConfigured={Boolean(systemStatus?.whatsappConfigured)}
              whatsappProvider={systemStatus?.whatsappProvider || 'belum_dikonfigurasi'}
              systemSettings={systemStatus?.settings || {}}
              onRefreshAll={() => void loadWorkspaceData()}
            />
          )}
          {user.role === 'admin' && activeNav === 'admin_linking' && (
            <AdminConsole
              section="linking"
              students={students}
              geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
              whatsappConfigured={Boolean(systemStatus?.whatsappConfigured)}
              whatsappProvider={systemStatus?.whatsappProvider || 'belum_dikonfigurasi'}
              systemSettings={systemStatus?.settings || {}}
              onRefreshAll={() => void loadWorkspaceData()}
            />
          )}
          {user.role === 'admin' && activeNav === 'admin_settings' && (
            <AdminConsole
              section="settings"
              students={students}
              geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
              whatsappConfigured={Boolean(systemStatus?.whatsappConfigured)}
              whatsappProvider={systemStatus?.whatsappProvider || 'belum_dikonfigurasi'}
              systemSettings={systemStatus?.settings || {}}
              onRefreshAll={() => void loadWorkspaceData()}
            />
          )}
          {user.role === 'admin' && activeNav === 'admin_erd' && (
            <AdminConsole
              section="erd"
              students={students}
              geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
              whatsappConfigured={Boolean(systemStatus?.whatsappConfigured)}
              whatsappProvider={systemStatus?.whatsappProvider || 'belum_dikonfigurasi'}
              systemSettings={systemStatus?.settings || {}}
              onRefreshAll={() => void loadWorkspaceData()}
            />
          )}

          {/* ==================== USTADZ BERANDA HALAQAH ==================== */}
          {user.role === 'ustadz' && activeNav === 'beranda' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500">
                    Assalamu&apos;alaikum · {formatTanggalID(todayISO)} · Sinkronisasi {wsConnected ? 'Live Terhubung' : 'Siap'}
                  </p>
                  <h1 className="font-display text-xl font-bold text-slate-900 mt-0.5">
                    {user.full_name}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSessionInputDefaultType('ziyadah');
                      setActiveNav('input_setoran');
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 transition-colors"
                  >
                    <ClipboardPlus className="w-4 h-4" aria-hidden="true" />
                    <span>Input Setoran Sekarang</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSessionInputDefaultType('tes_tahfidz');
                      setActiveNav('input_setoran');
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
                  >
                    <BookOpen className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    <span>Tes Tahfidz (PTS/PAS)</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="text-xs text-slate-500">Total Santri Binaan</span>
                  <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{students.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="text-xs text-slate-500">Menyetor Hari Ini</span>
                  <p className="mt-1 font-mono text-2xl font-bold text-emerald-800">
                    {students.filter((s) => s.lastSession?.session_date === todayISO).length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="text-xs text-slate-500">Belum Menyetor Hari Ini</span>
                  <p className="mt-1 font-mono text-2xl font-bold text-amber-700">
                    {students.filter((s) => s.lastSession?.session_date !== todayISO).length}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <span className="text-xs text-slate-500">Total Juz Tuntas Binaan</span>
                  <p className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {students.reduce((acc, s) => acc + s.completedJuz, 0)} Juz
                  </p>
                </div>
              </div>

              {/* Daftar Santri Binaan */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Daftar Santri Binaan &amp; Progres Terakhir
                  </h2>
                  <input
                    type="search"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Cari nama atau kelas..."
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-full sm:w-64"
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Santri</th>
                        <th className="py-3 px-4 font-semibold">Kelas</th>
                        <th className="py-3 px-4 font-semibold text-right">Juz Selesai</th>
                        <th className="py-3 px-4 font-semibold text-right">Halaman</th>
                        <th className="py-3 px-4 font-semibold text-right">Rata-rata</th>
                        <th className="py-3 px-4 font-semibold">Setoran Terakhir</th>
                        <th className="py-3 px-4 font-semibold text-right">Tindakan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStudents.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {s.full_name}
                            <span className="block font-mono text-[11px] font-normal text-slate-500">
                              {s.student_number}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600">{s.class_name || '-'}</td>
                          <td className="py-3 px-4 text-right font-mono">{s.completedJuz}</td>
                          <td className="py-3 px-4 text-right font-mono">{s.totalPages} hal</td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-800">
                            {formatNilaiID(s.averageScore)}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {s.lastSession
                              ? `${formatTanggalID(s.lastSession.session_date)} · Juz ${s.lastSession.juz_number}`
                              : 'Belum ada'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStudentId(s.id);
                                setActiveNav('input_setoran');
                              }}
                              className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800"
                            >
                              Input Setoran
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedStudentId(s.id);
                                setActiveNav('santri_detail');
                              }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================== INPUT SETORAN (USTADZ / ADMIN) ==================== */}
          {(user.role === 'ustadz' || user.role === 'admin') && activeNav === 'input_setoran' && (
            <SessionInputForm
              students={students}
              defaultStudentId={selectedStudentId}
              defaultSessionType={sessionInputDefaultType}
              mushaf={activeMushaf}
              onSaved={(res) => {
                setSelectedStudentId(res.studentId);
                setRefreshTrigger((t) => t + 1);
                void loadWorkspaceData();
              }}
            />
          )}

          {/* ==================== DETAIL SANTRI (USTADZ/ADMIN ATAU BERANDA WALI & SANTRI) ==================== */}
          {(((user.role === 'ustadz' || user.role === 'admin') && activeNav === 'santri_detail') ||
            ((user.role === 'wali_santri' || user.role === 'santri') && activeNav === 'beranda')) && (
            <div className="space-y-4">
              {(user.role === 'ustadz' || user.role === 'admin') && students.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="select-student-detail" className="text-xs font-semibold text-slate-700">
                    Pilih Santri untuk Dilihat &amp; Dievaluasi:
                  </label>
                  <select
                    id="select-student-detail"
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 min-w-[240px]"
                  >
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({s.class_name || s.student_number})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {user.role === 'wali_santri' && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">
                      Assalamu&apos;alaikum, {user.full_name} · Status Sinkronisasi:{' '}
                      <strong className="text-emerald-700">
                        {wsConnected ? 'Real-Time Aktif' : 'Terhubung'}
                      </strong>
                    </p>
                  </div>
                  {students.length > 1 && (
                    <span className="text-xs text-slate-500">
                      Menampilkan anak ke-{students.findIndex((s) => s.id === selectedStudentId) + 1} dari {students.length} anak terhubung
                    </span>
                  )}
                </div>
              )}

              {selectedStudentId ? (
                <StudentDetailWorkspace
                  studentId={selectedStudentId}
                  viewerRole={user.role}
                  institutionName={institutionName}
                  geminiConfigured={Boolean(systemStatus?.geminiConfigured)}
                  refreshTrigger={refreshTrigger}
                />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-3">
                  <p className="text-sm text-slate-600">
                    Belum ada profil anak yang terhubung dengan akun wali Anda.
                  </p>
                  {user.role === 'wali_santri' && (
                    <button
                      type="button"
                      onClick={() => setActiveNav('profil_notifikasi')}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
                    >
                      Masukkan Kode Penghubung Anak
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================== STATISTIK KESALAHAN ==================== */}
          {activeNav === 'statistik_kesalahan' && (
            <ErrorStatsPanel
              studentId={
                user.role === 'wali_santri' || user.role === 'santri' ? selectedStudentId : undefined
              }
            />
          )}

          {/* ==================== PROFIL & NOTIFIKASI ==================== */}
          {activeNav === 'profil_notifikasi' && (
            <ProfileAndNotifications
              user={user}
              notifications={notifications}
              onRefreshNotifications={() => void loadWorkspaceData()}
              onProfileUpdated={(updated) => setUser(updated)}
              onChildLinked={(sid) => {
                setSelectedStudentId(sid);
                void loadWorkspaceData();
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 w-72 max-w-[85vw] bg-slate-900 text-slate-100 flex flex-col h-full">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <span className="font-display text-base font-bold text-white">E-Tahfidz</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Tutup menu"
                className="p-1 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium text-left ${
                      activeNav === item.id ? 'bg-emerald-700 text-white' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-700 py-2 text-xs font-medium text-white"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Keluar Akun</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav (Ringkas, <= 56px agar gabungan sticky <= 15% tinggi layar) */}
      <nav
        aria-label="Navigasi Cepat Mobile"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white border-t border-slate-200 flex items-center justify-around px-2 no-print"
      >
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 text-[10px] font-medium ${
                active ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="truncate max-w-[70px]">{item.label.split(' ')[0]}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator />
    </div>
  );
}
