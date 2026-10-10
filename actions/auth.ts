'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { setSessionCookie, logoutSession, getSession } from '@/lib/auth';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';

const ALLOWED_DOMAINS = ['@eie.ruh.ac.lk', '@eng.ruh.ac.lk'];

// -------------------------------------------------------------
// 1. User Registration (Admin Approval Required)
// -------------------------------------------------------------
export async function registerUser(formData: {
  name: string;
  email: string;
  password: string;
}) {
  try {
    const email = formData.email.trim().toLowerCase();

    // Check allowed university domains
    const isValidDomain = ALLOWED_DOMAINS.some((domain) => email.endsWith(domain));
    if (!isValidDomain) {
      return {
        success: false,
        error: 'Only official university emails (@eie.ruh.ac.lk or @eng.ruh.ac.lk) are allowed.',
      };
    }

    if (formData.password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    const passwordHash = await bcrypt.hash(formData.password, 10);

    if (existingUser) {
      // If user was pre-seeded with no password (e.g. initial super admins)
      if (!existingUser.passwordHash) {
        const updatedUser = await prisma.user.update({
          where: { email },
          data: {
            name: formData.name,
            passwordHash,
            isApproved: true, // Pre-seeded admins auto-approved
          },
        });

        await setSessionCookie({
          userId: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
          twoFactorVerified: false,
        });

        return { success: true, message: 'Account initialized successfully!' };
      }

      return { success: false, error: 'An account with this email already exists.' };
    }

    // Create new standard borrower (Default: isApproved = false)
    await prisma.user.create({
      data: {
        name: formData.name,
        email,
        passwordHash,
        role: 'BORROWER',
        isApproved: false, // Pending Admin Approval
      },
    });

    return {
      success: true,
      message: 'Registration successful! Your account is pending admin approval. You can log in once approved by a lab administrator.',
    };
  } catch (error) {
    console.error('Registration Error:', error);
    return { success: false, error: 'Registration failed.' };
  }
}

// -------------------------------------------------------------
// 2. Credentials Login (Blocked if unapproved)
// -------------------------------------------------------------
export async function loginUser(formData: { email: string; password: string }) {
  try {
    const email = formData.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      return { success: false, error: 'Invalid credentials or account not registered yet.' };
    }

    const passwordValid = await bcrypt.compare(formData.password, user.passwordHash);
    if (!passwordValid) {
      return { success: false, error: 'Invalid email or password.' };
    }

    // Block unapproved accounts from logging in
    if (!user.isApproved) {
      return {
        success: false,
        error: 'Your account is pending admin approval. Please contact a lab administrator.',
      };
    }

    // If 2FA is enabled, return 2FA requirement flag
    if (user.twoFactorEnabled) {
      await setSessionCookie({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        twoFactorVerified: false, // Pending 2FA verification
      });
      return { success: true, require2FA: true };
    }

    // Standard session login
    await setSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      twoFactorVerified: true,
    });

    return { success: true, require2FA: false };
  } catch (error) {
    console.error('Login Error:', error);
    return { success: false, error: 'Login failed.' };
  }
}

// -------------------------------------------------------------
// 3. Admin Approval Server Actions
// -------------------------------------------------------------

// Fetch pending users for Admin/Lab Staff dashboard
export async function getPendingUsers() {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized' };
  }

  const users = await prisma.user.findMany({
    where: { isApproved: false },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return { success: true, users };
}

// Approve a pending user
export async function approveUser(userId: string) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isApproved: true },
  });

  revalidatePath('/dashboard/admin/users');
  return { success: true, message: 'User approved successfully!' };
}

// -------------------------------------------------------------
// 4. Generate 2FA Secret & QR Code (Google Authenticator)
// -------------------------------------------------------------
export async function setup2FA() {
  const session = await getSession();
  if (!session) return { success: false, error: 'Not authenticated.' };

  const secret = generateSecret();
  const otpauth = generateURI({
    issuer: 'Ruhuna IMS',
    label: session.email,
    secret,
  });

  const qrCodeUrl = await QRCode.toDataURL(otpauth);

  await prisma.user.update({
    where: { id: session.userId },
    data: { twoFactorSecret: secret },
  });

  return { success: true, qrCodeUrl, secret };
}

// -------------------------------------------------------------
// 5. Verify & Enable 2FA
// -------------------------------------------------------------
export async function verifyAndEnable2FA(token: string) {
  const session = await getSession();
  if (!session) return { success: false, error: 'Not authenticated.' };

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.twoFactorSecret) {
    return { success: false, error: '2FA setup was not initiated.' };
  }

  const { valid } = await verify({
    token: token.trim(),
    secret: user.twoFactorSecret,
  });

  if (!valid) {
    return { success: false, error: 'Invalid 6-digit code. Please try again.' };
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { twoFactorEnabled: true },
  });

  await setSessionCookie({
    ...session,
    twoFactorVerified: true,
  });

  revalidatePath('/dashboard');
  return { success: true, message: '2FA successfully enabled!' };
}

// -------------------------------------------------------------
// 6. Verify 2FA on Login
// -------------------------------------------------------------
export async function verify2FALogin(token: string) {
  const session = await getSession();
  if (!session) return { success: false, error: 'Session expired. Please log in again.' };

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.twoFactorSecret) {
    return { success: false, error: '2FA is not configured.' };
  }

  const { valid } = await verify({
    token: token.trim(),
    secret: user.twoFactorSecret,
  });

  if (!valid) {
    return { success: false, error: 'Invalid 6-digit code.' };
  }

  await setSessionCookie({
    ...session,
    twoFactorVerified: true,
  });

  return { success: true };
}

// -------------------------------------------------------------
// 7. Logout
// -------------------------------------------------------------
export async function logout() {
  await logoutSession();
}

// actions/auth.ts — 
export async function getCurrentUserRole() {
  const session = await getSession();
  return { role: session?.role ?? null };
}