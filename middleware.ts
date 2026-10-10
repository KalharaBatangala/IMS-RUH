import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Get session cookie
  const sessionCookie = req.cookies.get('ims_session')?.value;
  const session = sessionCookie ? await decrypt(sessionCookie) : null;

  // 2. Protect all /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    // If not logged in, redirect to login page
    if (!session) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('error', 'Please log in to access this page.');
      return NextResponse.redirect(loginUrl);
    }

    // Allow access to the unauthorized landing page without role checks
    if (pathname === '/dashboard/unauthorized') {
      return NextResponse.next();
    }

    const role = session.role;

    // A. Super Admin Only Routes (/dashboard/users OR /dashboard/admin/...)
    if (
      pathname.startsWith('/dashboard/users') ||
      pathname.startsWith('/dashboard/admin')
    ) {
      if (role !== 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/dashboard/unauthorized', req.url));
      }
    }

    // B. Staff & Super Admin Only Routes (Analytics Overview & Request Approval Management)
    else if (
      pathname === '/dashboard' ||
      pathname.startsWith('/dashboard/borrow') ||
      pathname.startsWith('/dashboard/staff')
    ) {
      if (role !== 'SUPER_ADMIN' && role !== 'LAB_STAFF') {
        // If a BORROWER tries to access admin analytics or borrow approvals, redirect to inventory
        return NextResponse.redirect(new URL('/dashboard/inventory', req.url));
      }
    }

    // C. Open to ALL authenticated users (BORROWER, LAB_STAFF, SUPER_ADMIN)
    // /dashboard/inventory allows borrowers to view items and request loans
  }

  // 3. Redirect logged-in users away from auth pages (/login, /register)
  if ((pathname === '/login' || pathname === '/register') && session) {
    // Direct staff/admin to analytics dashboard, and borrowers to the inventory page
    const targetPath =
      session.role === 'BORROWER' ? '/dashboard/inventory' : '/dashboard';
    return NextResponse.redirect(new URL(targetPath, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};