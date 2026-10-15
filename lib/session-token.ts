import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';
import { POLICY } from '@/lib/config';

// Token signing/verification only (no database), so proxy.ts can use it cheaply.
// The token is NOT the authority on role or account status: lib/auth.ts re-checks
// the user in the database on every request.

export const SESSION_COOKIE = 'ims_session';

export interface SessionTokenPayload {
  userId: string;
  role: Role; // used by proxy.ts for page routing only
  sessionVersion: number;
  twoFactorVerified: boolean;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail safely: never fall back to a built-in secret.
    throw new Error('JWT_SECRET is missing or shorter than 32 characters. Set it in .env.');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${POLICY.sessionTtlSeconds}s`)
    .sign(getSecret());
}

export async function decrypt(token: string): Promise<SessionTokenPayload | null> {
  const secret = getSecret(); // throws (outside the try) if misconfigured
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string' || typeof payload.sessionVersion !== 'number') return null;
    return payload as unknown as SessionTokenPayload;
  } catch {
    return null;
  }
}
