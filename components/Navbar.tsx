'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { Role } from '@prisma/client';
import { ROLE_LABELS } from '@/components/StatusBadge';

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export default function Navbar() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await res.json();
        setUser(data.user ?? null);
        setUnread(data.unreadNotifications ?? 0);
      } catch (err) {
        console.error('Failed to load user session', err);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, [pathname]); // Refetches session on page navigation

  function handleLogout() {
    startTransition(async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  const getRoleBadgeStyle = (role: Role) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'COORDINATOR':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'TECHNICAL_OFFICER':
        return 'bg-teal-100 text-teal-700 border-teal-200';
      case 'BORROWER':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const isStaffOrAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'COORDINATOR' || user?.role === 'TECHNICAL_OFFICER';

  const links: { href: string; label: string; active: boolean; show: boolean }[] = user
    ? [
        { href: '/', label: '🏠 Catalog & Labs', active: pathname === '/', show: true },
        { href: '/dashboard/inventory', label: '📦 Inventory', active: pathname.startsWith('/dashboard/inventory'), show: true },
        { href: '/dashboard', label: '📊 Analytics', active: pathname === '/dashboard', show: isStaffOrAdmin },
        {
          href: '/dashboard/borrow',
          label: user.role === 'BORROWER' ? '📋 My Requests' : '📋 Requests & Loans',
          active: pathname.startsWith('/dashboard/borrow'),
          show: true,
        },
        { href: '/dashboard/users', label: '👥 Users', active: pathname.startsWith('/dashboard/users') || pathname.startsWith('/dashboard/admin'), show: user.role === 'SUPER_ADMIN' },
        { href: '/dashboard/labs', label: '🏢 Laboratories', active: pathname.startsWith('/dashboard/labs'), show: user.role === 'SUPER_ADMIN' },
        { href: '/dashboard/audit', label: '🧾 Audit Log', active: pathname.startsWith('/dashboard/audit'), show: user.role === 'SUPER_ADMIN' },
      ]
    : [];

  return (
    <header className="print:hidden sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Brand Logo */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold text-lg flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
                ⚡
              </div>
              <span className="font-bold text-lg text-slate-900 tracking-tight group-hover:text-blue-600 transition">
                Ruhuna IMS
              </span>
            </Link>

            {/* Navigation Links */}
            {!loading && user && (
              <nav className="hidden md:flex items-center gap-1 flex-wrap">
                {links
                  .filter((l) => l.show)
                  .map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        l.active ? 'bg-slate-100 text-blue-600' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
              </nav>
            )}
          </div>

          {/* User Profile / Auth Area */}
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-24 h-8 bg-slate-100 animate-pulse rounded-lg" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard/notifications"
                  className="relative px-2 py-1.5 rounded-lg hover:bg-slate-100 text-sm"
                  title="Notifications"
                >
                  🔔
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>
                <Link href="/dashboard/account" className="hidden sm:flex flex-col items-end group" title="My account">
                  <span className="text-xs font-bold text-slate-800 leading-tight group-hover:text-blue-600">
                    {user.name}
                  </span>
                  <span
                    className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border uppercase mt-0.5 ${getRoleBadgeStyle(user.role)}`}
                  >
                    {ROLE_LABELS[user.role]}
                  </span>
                </Link>

                <button
                  onClick={handleLogout}
                  disabled={isPending}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition disabled:opacity-50 flex items-center gap-1"
                  title="Log out of account"
                >
                  🚪 <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                Sign In
              </Link>
            )}
          </div>

        </div>
      </div>
      {/* Mobile navigation */}
      {!loading && user && (
        <nav className="md:hidden flex gap-1 overflow-x-auto px-4 pb-2">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  l.active ? 'bg-slate-100 text-blue-600' : 'text-slate-600'
                }`}
              >
                {l.label}
              </Link>
            ))}
        </nav>
      )}
    </header>
  );
}
