'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function checkAndUpdateOverdueLogs() {
  try {
    const now = new Date();

    // Find all ISSUED logs where returnDate is in the past
    const overdueLogs = await prisma.borrowLog.findMany({
      where: {
        status: 'ISSUED',
        returnDate: {
          lt: now,
        },
      },
      select: { id: true },
    });

    if (overdueLogs.length === 0) {
      return { success: true, updatedCount: 0, message: 'No overdue items found.' };
    }

    const idsToUpdate = overdueLogs.map((log) => log.id);

    // Update their status to OVERDUE
    const result = await prisma.borrowLog.updateMany({
      where: {
        id: {
          in: idsToUpdate,
        },
      },
      data: {
        status: 'OVERDUE',
      },
    });

    revalidatePath('/dashboard/borrow');
    return { success: true, updatedCount: result.count };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update overdue logs.' };
  }
}