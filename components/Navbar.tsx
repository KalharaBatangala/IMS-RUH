'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { logout } from '@/actions/auth'; // Make sure logout is a Server Action!
import { UserRole } from '@prisma/client';

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export default function Navbar() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();

  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
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
      // If logout is a server action, call it here
      await fetch('/api/auth/logout', { method: 'POST' }); // Or call your logout action
      window.location.href = '/login';
    });
  }

  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case 'SUPER_ADMIN':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'LAB_STAFF':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'BORROWER':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const isStaffOrAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'LAB_STAFF';

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Brand Logo */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold text-lg flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
                ⚡
              </div>
              <span className="font-bold text-lg text-slate-900 tracking-tight group-hover:text-blue-600 transition">
                LabFlow
              </span>
            </Link>

            {/* Navigation Links */}
            {!loading && user && (
              <nav className="hidden md:flex items-center gap-1">
                <Link
                  href="/"
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                    pathname === '/'
                      ? 'bg-slate-100 text-blue-600'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  🏠 Catalog & Labs
                </Link>
                <Link
                      href="/dashboard/inventory"
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        pathname.startsWith('/dashboard/inventory')
                          ? 'bg-slate-100 text-blue-600'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      📦 Inventory
                </Link>
                {/* Staff & Admin Links */}
                {isStaffOrAdmin && (
                  <>
                    <Link
                      href="/dashboard"
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        pathname === '/dashboard'
                          ? 'bg-slate-100 text-blue-600'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      📊 Analytics
                    </Link>
                    <Link
                      href="/dashboard/borrow"
                      className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                        pathname.startsWith('/dashboard/borrow')
                          ? 'bg-slate-100 text-blue-600'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      📋 Requests & Loans
                    </Link>
                    
                  </>
                )}

                {/* Super Admin Only Link */}
                {user.role === 'SUPER_ADMIN' && (
                  <>
                  <Link
                    href="/dashboard/users"
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                      pathname.startsWith('/dashboard/users')
                        ? 'bg-slate-100 text-blue-600'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    👥 Users
                  </Link>

                  <Link
                    href="/dashboard/labs"
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                      pathname.startsWith('/dashboard/labs')
                        ? 'bg-slate-100 text-blue-600'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    🏢 Laboratories
                  </Link>


                  </>
                )}
              </nav>
            )}
          </div>

          {/* User Profile / Auth Area */}
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-24 h-8 bg-slate-100 animate-pulse rounded-lg" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-xs font-bold text-slate-800 leading-tight">
                    {user.name}
                  </span>
                  <span
                    className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border uppercase mt-0.5 ${getRoleBadgeStyle(
                      user.role
                    )}`}
                  >
                    {user.role.replace('_', ' ')}
                  </span>
                </div>

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
    </header>
  );
}