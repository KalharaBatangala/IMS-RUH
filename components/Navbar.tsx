'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition, type ComponentType } from 'react';
import type { Role } from '@prisma/client';
import { ROLE_LABELS } from '@/components/StatusBadge';
import { APP_NAME, BrandLockup } from '@/components/Brand';
import {
  IconBell,
  IconBox,
  IconBuilding,
  IconCatalog,
  IconChart,
  IconClipboard,
  IconLedger,
  IconLogout,
  IconUsers,
} from '@/components/Icons';

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: Role;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
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

  const isStaffOrAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'COORDINATOR' || user?.role === 'TECHNICAL_OFFICER';

  const links: { href: string; label: string; icon: ComponentType<{ size?: number }>; active: boolean; show: boolean }[] = user
    ? [
        { href: '/', label: 'Catalogue', icon: IconCatalog, active: pathname === '/', show: true },
        { href: '/dashboard/inventory', label: 'Inventory', icon: IconBox, active: pathname.startsWith('/dashboard/inventory'), show: true },
        { href: '/dashboard', label: 'Analytics', icon: IconChart, active: pathname === '/dashboard', show: isStaffOrAdmin },
        {
          href: '/dashboard/borrow',
          label: user.role === 'BORROWER' ? 'My Requests' : 'Requests & Loans',
          icon: IconClipboard,
          active: pathname.startsWith('/dashboard/borrow'),
          show: true,
        },
        { href: '/dashboard/users', label: 'Users', icon: IconUsers, active: pathname.startsWith('/dashboard/users') || pathname.startsWith('/dashboard/admin'), show: user.role === 'SUPER_ADMIN' },
        { href: '/dashboard/labs', label: 'Laboratories', icon: IconBuilding, active: pathname.startsWith('/dashboard/labs'), show: user.role === 'SUPER_ADMIN' },
        { href: '/dashboard/audit', label: 'Audit Log', icon: IconLedger, active: pathname.startsWith('/dashboard/audit'), show: user.role === 'SUPER_ADMIN' },
      ]
    : [];

  const visibleLinks = links.filter((l) => l.show);

  return (
    <header className="print:hidden sticky top-0 z-50 bg-white/85 backdrop-blur-md border-b border-slate-200/80 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-6">

          {/* Brand + primary navigation */}
          <div className="flex items-center gap-8 min-w-0">
            <Link href="/" className="shrink-0 rounded-lg" aria-label={`${APP_NAME} home`}>
              <BrandLockup size={34} />
            </Link>

            {!loading && user && (
              <nav className="hidden lg:flex items-center gap-0.5">
                {visibleLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={l.active ? 'page' : undefined}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      l.active ? 'bg-brand-50 text-brand-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
                    }`}
                  >
                    <l.icon size={15} />
                    {l.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>

          {/* User Profile / Auth Area */}
          <div className="flex items-center gap-2 shrink-0">
            {loading ? (
              <div className="w-40 h-9 bg-slate-100 animate-pulse rounded-lg" />
            ) : user ? (
              <>
                <Link
                  href="/dashboard/notifications"
                  className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    pathname.startsWith('/dashboard/notifications')
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  title="Notifications"
                  aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
                >
                  <IconBell size={18} />
                  {unread > 0 && (
                    <span className="absolute top-1 right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-600 ring-2 ring-white text-white text-[9px] font-semibold flex items-center justify-center tabular">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>

                <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

                <Link
                  href="/dashboard/account"
                  className="flex items-center gap-2.5 rounded-lg pl-1 pr-2 py-1 hover:bg-slate-100 transition-colors"
                  title="My account"
                >
                  <span className="w-8 h-8 rounded-full bg-brand-800 text-white text-[11px] font-semibold flex items-center justify-center ring-2 ring-brand-100">
                    {initials(user.name)}
                  </span>
                  <span className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-[13px] font-semibold text-slate-800 max-w-40 truncate">{user.name}</span>
                    <span className="text-[11px] text-slate-500">{ROLE_LABELS[user.role]}</span>
                  </span>
                </Link>

                <button
                  onClick={handleLogout}
                  disabled={isPending}
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
                  title="Log out"
                  aria-label="Log out"
                >
                  <IconLogout size={18} />
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-brand-800 hover:bg-brand-900 text-white text-[13px] font-medium rounded-lg shadow-sm transition-colors"
              >
                Sign in
              </Link>
            )}
          </div>

        </div>
      </div>

      {/* Compact navigation (below the lg breakpoint) */}
      {!loading && user && (
        <nav className="lg:hidden flex gap-1 overflow-x-auto px-4 pb-2.5">
          {visibleLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={l.active ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                l.active ? 'bg-brand-50 text-brand-800' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <l.icon size={14} />
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
