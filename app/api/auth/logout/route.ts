import { NextResponse } from 'next/server';
import { logoutSession } from '@/lib/auth';

export async function POST() {
  await logoutSession();
  return NextResponse.json({ success: true }, { status: 200 });
}

// Used by the dashboard guard when a token is still signed but no longer valid
// (role/status changed, account deactivated): clear it, then go to the login page.
export async function GET(request: Request) {
  await logoutSession();
  const url = new URL('/login', request.url);
  url.searchParams.set('error', 'Your session has ended. Please log in again.');
  return NextResponse.redirect(url);
}
