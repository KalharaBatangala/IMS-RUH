import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { Role } from '@prisma/client';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'ruhuna-ims-super-secret-key-2026-change-me'
);

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
  twoFactorVerified: boolean;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);
}

// export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
//   try {
//     const { payload } = await jwtVerify(token, JWT_SECRET);
//     return payload as unknown as SessionPayload;
//   } catch (error) {
//     return null;
//   }
// }

// 2. Decrypt / Verify JWT Session (Exported for Middleware & Actions)
export async function decrypt(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

// Helper alias in case other actions call verifySessionToken
export const verifySessionToken = decrypt;






export async function setSessionCookie(payload: SessionPayload) {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set('ims_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ims_session')?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function logoutSession() {
  const cookieStore = await cookies();
  cookieStore.delete('ims_session');
}