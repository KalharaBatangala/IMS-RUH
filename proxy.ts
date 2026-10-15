import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, decrypt } from '@/lib/session-token';

// Page routing only (Next.js 16 "proxy", formerly middleware). This checks the token
// signature for fast redirects; it is NOT the authorization boundary. Every server action
// and the dashboard layout re-check the user, role and lab assignment in the database.

const SUPER_ADMIN_ONLY = ['/dashboard/users', '/dashboard/admin', '/dashboard/labs', '/dashboard/audit'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await decrypt(token) : null;
  const session = payload?.twoFactorVerified ? payload : null; // pending-2FA is not a session

  if (pathname.startsWith('/dashboard')) {
    if (!session) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('error', 'Please log in to access this page.');
      return NextResponse.redirect(loginUrl);
    }
    if (pathname === '/dashboard/unauthorized') return NextResponse.next();

    if (SUPER_ADMIN_ONLY.some((p) => pathname.startsWith(p)) && session.role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard/unauthorized', req.url));
    }
    // Analytics overview is for staff; borrowers land on the inventory.
    if (pathname === '/dashboard' && session.role === 'BORROWER') {
      return NextResponse.redirect(new URL('/dashboard/inventory', req.url));
    }
    // /dashboard/inventory, /dashboard/borrow (own requests), /dashboard/account and
    // /dashboard/notifications are open to every signed-in user; data is scoped server-side.
  }

  if ((pathname === '/login' || pathname === '/register') && session) {
    const target = session.role === 'BORROWER' ? '/dashboard/inventory' : '/dashboard';
    return NextResponse.redirect(new URL(target, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
