'use server';

import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import type { Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/auth';
import { ActionError, toActionError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';

const ROLES: Role[] = ['SUPER_ADMIN', 'COORDINATOR', 'TECHNICAL_OFFICER', 'BORROWER'];

function refresh() {
  revalidatePath('/dashboard/users');
  revalidatePath('/dashboard/admin/users');
}

async function loadTarget(adminId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: String(userId) } });
  if (!user) throw new ActionError('User not found.');
  if (user.id === adminId) throw new ActionError('You cannot change your own account here.');
  return user;
}

// Get all registered users
export async function getUsers() {
  try {
    await requireSuperAdmin();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        indexNumber: true,
        role: true,
        isApproved: true,
        isActive: true,
        twoFactorEnabled: true,
        createdAt: true,
        passwordHash: true,
        labAssignments: {
          where: { unassignedAt: null },
          select: { role: true, lab: { select: { name: true } } },
        },
      },
    });
    const data = users.map(({ passwordHash, ...u }) => ({ ...u, hasPassword: Boolean(passwordHash) }));
    return { success: true as const, data };
  } catch (error) {
    return toActionError(error, 'Failed to fetch users.');
  }
}

// Approve / revoke approval
export async function toggleUserApproval(userId: string, isApproved: boolean) {
  try {
    const session = await requireSuperAdmin();
    const user = await loadTarget(session.userId, userId);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        // Revoking also clears the roster mark so "Approve all verified" cannot silently re-approve.
        data: { isApproved: Boolean(isApproved), sessionVersion: { increment: 1 }, ...(isApproved ? {} : { rosterVerifiedAt: null }) },
      });
      await audit(tx, { actorId: session.userId, action: isApproved ? 'USER_APPROVED' : 'USER_APPROVAL_REVOKED', entityType: 'User', entityId: user.id });
    });
    if (isApproved) await notify([user.id], { title: 'Account approved', body: 'Your DEIE Labs account has been approved.' });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update approval status.');
  }
}

// Deactivate / reactivate (separate from approval and from lab assignments)
export async function setUserActive(userId: string, isActive: boolean) {
  try {
    const session = await requireSuperAdmin();
    const user = await loadTarget(session.userId, userId);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { isActive: Boolean(isActive), sessionVersion: { increment: 1 } } });
      await audit(tx, { actorId: session.userId, action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', entityType: 'User', entityId: user.id });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update account status.');
  }
}

// Update user role
export async function updateUserRole(userId: string, role: Role) {
  try {
    const session = await requireSuperAdmin();
    if (!ROLES.includes(role)) throw new ActionError('Invalid role.');
    const user = await loadTarget(session.userId, userId);
    if (user.role === role) return { success: true as const };

    await prisma.$transaction(async (tx) => {
      // A Coordinator must not keep TO assignments (and vice versa): end them first, explicitly.
      const active = await tx.labAssignment.count({ where: { userId: user.id, unassignedAt: null } });
      if (active > 0) {
        throw new ActionError(`${user.name} still has ${active} active lab assignment(s). Remove them on the Laboratories page before changing the role.`);
      }
      await tx.user.update({ where: { id: user.id }, data: { role, sessionVersion: { increment: 1 } } });
      await audit(tx, { actorId: session.userId, action: 'USER_ROLE_CHANGED', entityType: 'User', entityId: user.id, details: { from: user.role, to: role } });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update user role.');
  }
}

// Temporary password (account recovery without email). Shown ONCE to the admin.
export async function resetUserPassword(userId: string) {
  try {
    const session = await requireSuperAdmin();
    const user = await loadTarget(session.userId, userId);
    const temporaryPassword = randomBytes(9).toString('base64url'); // 12 chars
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(temporaryPassword, 10), sessionVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
      });
      await audit(tx, { actorId: session.userId, action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: user.id });
    });
    refresh();
    return { success: true as const, data: { temporaryPassword } };
  } catch (error) {
    return toActionError(error, 'Failed to reset password.');
  }
}

// 2FA recovery: remove a lost authenticator so the user can sign in and set it up again
export async function resetUserTwoFactor(userId: string) {
  try {
    const session = await requireSuperAdmin();
    const user = await loadTarget(session.userId, userId);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorSecret: null, sessionVersion: { increment: 1 } },
      });
      await audit(tx, { actorId: session.userId, action: 'USER_TWO_FACTOR_RESET', entityType: 'User', entityId: user.id });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to reset 2FA.');
  }
}
