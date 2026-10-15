import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { POLICY } from '@/lib/config';
import { ActionError } from '@/lib/errors';
import { SESSION_COOKIE, createSessionToken, decrypt } from '@/lib/session-token';

export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
}

function cookieSecure(): boolean {
  // COOKIE_SECURE=false is needed if the intranet server is reached over plain http://.
  // Prefer HTTPS with an internal certificate and leave this unset in production.
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export async function setSessionCookie(input: {
  userId: string;
  role: Role;
  sessionVersion: number;
  twoFactorVerified: boolean;
}) {
  const token = await createSessionToken(input);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: POLICY.sessionTtlSeconds,
  });
}

export async function logoutSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

async function loadUserForToken(requireTwoFactorDone: boolean) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await decrypt(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive || !user.isApproved) return null;
  if (user.sessionVersion !== payload.sessionVersion) return null; // role/status changed since login
  const twoFactorDone = !user.twoFactorEnabled || payload.twoFactorVerified;
  if (requireTwoFactorDone !== twoFactorDone) return null;

  return user;
}

// Fully authenticated session (password + 2FA when enabled), checked against the DB.
// Cached per request.
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const user = await loadUserForToken(true);
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
  };
});

// Password accepted but TOTP still required. Only for verify2FALogin.
export async function getPendingTwoFactorUser() {
  return loadUserForToken(false);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new ActionError('Your session has expired. Please log in again.');
  return session;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const session = await requireSession();
  if (session.role !== 'SUPER_ADMIN') throw new ActionError('Only a Super Admin can do this.');
  return session;
}
