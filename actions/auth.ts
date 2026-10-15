'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import {
  getPendingTwoFactorUser,
  getSession,
  logoutSession,
  requireSession,
  requireSuperAdmin,
  setSessionCookie,
} from '@/lib/auth';
import { ALLOWED_EMAIL_DOMAINS, POLICY } from '@/lib/config';
import { ActionError, requireText, toActionError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';

// Used to keep login timing similar whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 10);

function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < POLICY.minPasswordLength) {
    throw new ActionError(`Password must be at least ${POLICY.minPasswordLength} characters long.`);
  }
  if (password.length > 128) throw new ActionError('Password is too long.');
  return password;
}

// -------------------------------------------------------------
// 1. User Registration (Admin Approval Required)
// -------------------------------------------------------------
export async function registerUser(formData: { name: string; email: string; password: string }) {
  try {
    const email = requireText(formData.email, 'Email', 200).toLowerCase();
    const name = requireText(formData.name, 'Full name', 120);
    const password = validatePassword(formData.password);

    if (!ALLOWED_EMAIL_DOMAINS.some((domain) => email.endsWith(domain))) {
      throw new ActionError('Only official university emails (@eie.ruh.ac.lk or @eng.ruh.ac.lk) are allowed.');
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      // Pre-created accounts are NOT initialised through public registration any more
      // (anyone could have claimed them). The Super Admin sets a temporary password instead.
      throw new ActionError('An account with this email already exists. Contact the system administrator if you cannot sign in.');
    }

    const user = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: 'BORROWER', isApproved: false },
    });
    await audit(prisma, { actorId: user.id, action: 'USER_REGISTERED', entityType: 'User', entityId: user.id });

    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } });
    await notify(admins.map((a) => a.id), {
      title: 'New registration awaiting approval',
      body: `${name} (${email}) registered and is waiting for approval.`,
      link: '/dashboard/admin/users',
    });

    return {
      success: true as const,
      message: 'Registration successful! Your account is pending admin approval. You can log in once approved.',
    };
  } catch (error) {
    return toActionError(error, 'Registration failed.');
  }
}

// -------------------------------------------------------------
// 2. Credentials Login (throttled; blocked if unapproved / inactive)
// -------------------------------------------------------------
async function recordFailedLogin(userId: string, failedLoginCount: number) {
  const failures = failedLoginCount + 1;
  const lock = failures >= POLICY.loginMaxFailures;
  await prisma.user.update({
    where: { id: userId },
    data: lock
      ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + POLICY.loginLockoutMs) }
      : { failedLoginCount: failures },
  });
  if (lock) {
    await audit(prisma, { actorId: null, action: 'LOGIN_LOCKED', entityType: 'User', entityId: userId });
  }
}

export async function loginUser(formData: { email: string; password: string }) {
  try {
    const email = String(formData.email ?? '').trim().toLowerCase();
    const password = String(formData.password ?? '');
    const user = await prisma.user.findUnique({ where: { email } });

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new ActionError('Too many failed attempts. Please try again later.');
    }

    const passwordValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !passwordValid) {
      if (user) await recordFailedLogin(user.id, user.failedLoginCount);
      throw new ActionError('Invalid email or password.');
    }
    if (!user.isActive) throw new ActionError('This account has been deactivated. Please contact the administrator.');
    if (!user.isApproved) {
      throw new ActionError('Your account is pending admin approval. Please contact the administrator.');
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }

    await setSessionCookie({
      userId: user.id,
      role: user.role,
      sessionVersion: user.sessionVersion,
      twoFactorVerified: !user.twoFactorEnabled, // pending until TOTP is verified
    });
    return { success: true as const, require2FA: user.twoFactorEnabled };
  } catch (error) {
    return toActionError(error, 'Login failed.');
  }
}

// -------------------------------------------------------------
// 3. Admin approval of registrations (Super Admin only)
// -------------------------------------------------------------
export async function getPendingUsers() {
  try {
    await requireSuperAdmin();
    const users = await prisma.user.findMany({
      where: { isApproved: false },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true as const, users };
  } catch (error) {
    return toActionError(error, 'Failed to load pending users.');
  }
}

export async function approveUser(userId: string) {
  try {
    const session = await requireSuperAdmin();
    const res = await prisma.user.updateMany({
      where: { id: String(userId), isApproved: false },
      data: { isApproved: true, sessionVersion: { increment: 1 } },
    });
    if (res.count !== 1) throw new ActionError('User not found or already approved.');
    await audit(prisma, { actorId: session.userId, action: 'USER_APPROVED', entityType: 'User', entityId: userId });
    await notify([userId], { title: 'Account approved', body: 'Your Ruhuna IMS account has been approved.', link: '/dashboard/inventory' });
    revalidatePath('/dashboard/admin/users');
    revalidatePath('/dashboard/users');
    return { success: true as const, message: 'User approved successfully!' };
  } catch (error) {
    return toActionError(error, 'Failed to approve user.');
  }
}

// -------------------------------------------------------------
// 4. 2FA (Google Authenticator / any TOTP app)
// -------------------------------------------------------------
export async function setup2FA() {
  try {
    const session = await requireSession();
    if (session.twoFactorEnabled) throw new ActionError('Two-factor authentication is already enabled.');

    const secret = generateSecret();
    const otpauth = generateURI({ issuer: 'Ruhuna IMS', label: session.email, secret });
    const qrCodeUrl = await QRCode.toDataURL(otpauth); // generated locally, no network call

    await prisma.user.update({ where: { id: session.userId }, data: { twoFactorSecret: secret } });
    return { success: true as const, qrCodeUrl, secret };
  } catch (error) {
    return toActionError(error, 'Failed to start 2FA setup.');
  }
}

export async function verifyAndEnable2FA(token: string) {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.twoFactorSecret) throw new ActionError('2FA setup was not initiated.');
    if (user.twoFactorEnabled) throw new ActionError('Two-factor authentication is already enabled.');

    const { valid } = await verify({ token: String(token ?? '').trim(), secret: user.twoFactorSecret });
    if (!valid) throw new ActionError('Invalid 6-digit code. Please try again.');

    // Enabling 2FA signs out other sessions (sessionVersion++), then re-issues this one.
    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorEnabled: true, sessionVersion: { increment: 1 } },
    });
    await setSessionCookie({ userId: updated.id, role: updated.role, sessionVersion: updated.sessionVersion, twoFactorVerified: true });
    await audit(prisma, { actorId: session.userId, action: 'TWO_FACTOR_ENABLED', entityType: 'User', entityId: session.userId });

    revalidatePath('/dashboard/account');
    return { success: true as const, message: '2FA successfully enabled!' };
  } catch (error) {
    return toActionError(error, 'Failed to enable 2FA.');
  }
}

export async function disable2FA(token: string) {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) throw new ActionError('2FA is not enabled.');
    const { valid } = await verify({ token: String(token ?? '').trim(), secret: user.twoFactorSecret });
    if (!valid) throw new ActionError('Invalid 6-digit code.');

    const updated = await prisma.user.update({
      where: { id: session.userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, sessionVersion: { increment: 1 } },
    });
    await setSessionCookie({ userId: updated.id, role: updated.role, sessionVersion: updated.sessionVersion, twoFactorVerified: true });
    await audit(prisma, { actorId: session.userId, action: 'TWO_FACTOR_DISABLED', entityType: 'User', entityId: session.userId });
    revalidatePath('/dashboard/account');
    return { success: true as const, message: '2FA disabled.' };
  } catch (error) {
    return toActionError(error, 'Failed to disable 2FA.');
  }
}

export async function verify2FALogin(token: string) {
  try {
    const user = await getPendingTwoFactorUser();
    if (!user || !user.twoFactorSecret) throw new ActionError('Session expired. Please log in again.');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ActionError('Too many failed attempts. Please try again later.');
    }

    const { valid } = await verify({ token: String(token ?? '').trim(), secret: user.twoFactorSecret });
    if (!valid) {
      await recordFailedLogin(user.id, user.failedLoginCount);
      throw new ActionError('Invalid 6-digit code.');
    }

    if (user.failedLoginCount > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    }
    await setSessionCookie({ userId: user.id, role: user.role, sessionVersion: user.sessionVersion, twoFactorVerified: true });
    return { success: true as const };
  } catch (error) {
    return toActionError(error, '2FA verification failed.');
  }
}

// -------------------------------------------------------------
// 5. Password change (self)
// -------------------------------------------------------------
export async function changePassword(currentPassword: string, newPassword: string) {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(String(currentPassword ?? ''), user.passwordHash))) {
      throw new ActionError('Current password is incorrect.');
    }
    const password = validatePassword(newPassword);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10), sessionVersion: { increment: 1 } },
    });
    await setSessionCookie({ userId: updated.id, role: updated.role, sessionVersion: updated.sessionVersion, twoFactorVerified: true });
    await audit(prisma, { actorId: user.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });
    return { success: true as const, message: 'Password changed. Other sessions have been signed out.' };
  } catch (error) {
    return toActionError(error, 'Failed to change password.');
  }
}

// -------------------------------------------------------------
// 6. Logout
// -------------------------------------------------------------
export async function logout() {
  await logoutSession();
}

export async function getCurrentUserRole() {
  const session = await getSession();
  return { role: session?.role ?? null, userId: session?.userId ?? null };
}
