'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export async function getDashboardStats() {
  try {
    const session = await getSession();
    if (!session) {
      throw new Error('Unauthorized');
    }

    const [
      totalEquipment,
      totalLabs,
      pendingRequests,
      activeLoans,
      overdueLoans,
      recentLogs,
    ] = await Promise.all([
      // Total equipment items
      prisma.equipment.count(),
      
      // Total laboratories
      prisma.lab.count(),

      // Pending borrow requests requiring staff approval
      prisma.borrowLog.count({
        where: { status: 'PENDING' },
      }),

      // Currently issued equipment out in the field
      prisma.borrowLog.count({
        where: { status: 'ISSUED' },
      }),

      // Items currently flagged as overdue
      prisma.borrowLog.count({
        where: { status: 'OVERDUE' },
      }),

      // 5 most recent requests for quick view
      prisma.borrowLog.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true } },
          equipment: { select: { name: true, lab: { select: { name: true } } } },
        },
      }),
    ]);

    return {
      success: true,
      stats: {
        totalEquipment,
        totalLabs,
        pendingRequests,
        activeLoans,
        overdueLoans,
      },
      recentLogs,
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to fetch dashboard stats.' };
  }
}