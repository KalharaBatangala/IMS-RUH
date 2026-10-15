'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { toActionError } from '@/lib/errors';

export async function getMyNotifications() {
  try {
    const session = await requireSession();
    const notifications = await prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { success: true as const, data: notifications };
  } catch (error) {
    return toActionError(error, 'Failed to load notifications.');
  }
}

export async function markNotificationsRead(ids?: string[]) {
  try {
    const session = await requireSession();
    await prisma.notification.updateMany({
      where: { userId: session.userId, readAt: null, ...(ids ? { id: { in: ids.map(String) } } : {}) },
      data: { readAt: new Date() },
    });
    revalidatePath('/dashboard/notifications');
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update notifications.');
  }
}
