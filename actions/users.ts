'server action';
'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';

// Admin-only check helper
async function checkAdminAuth() {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') {
    throw new Error('Unauthorized: Super Admin access required');
  }
  return session;
}

// Get all registered users
export async function getUsers() {
  try {
    await checkAdminAuth();
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isApproved: true,
        createdAt: true,
      },
    });
    return { success: true, data: users };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch users.' };
  }
}

// Toggle account approval status
export async function toggleUserApproval(userId: string, isApproved: boolean) {
  try {
    await checkAdminAuth();
    await prisma.user.update({
      where: { id: userId },
      data: { isApproved },
    });
    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update approval status.' };
  }
}

// Update user role
export async function updateUserRole(userId: string, role: UserRole) {
  try {
    await checkAdminAuth();
    await prisma.user.update({
      where: { id: userId },
      data: { role },
    });
    revalidatePath('/dashboard/users');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update user role.' };
  }
}