'use server';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireSession } from '@/lib/auth';
import { POLICY } from '@/lib/config';
import { toActionError } from '@/lib/errors';
import { assignmentRoleFor, getActiveLabIds } from '@/lib/authz';
import { runMaintenance } from '@/lib/borrow-workflow';

// Stats are scoped: Super Admin sees all labs; Coordinators / TOs see their assigned labs.
export async function getDashboardStats() {
  try {
    const session = await requireSession();
    await runMaintenance();

    let labIds: string[] | null = null;
    if (session.role !== 'SUPER_ADMIN') {
      const role = assignmentRoleFor(session);
      labIds = role ? await getActiveLabIds(session.userId, role) : [];
    }
    const logScope: Prisma.BorrowLogWhereInput = labIds ? { equipment: { labId: { in: labIds } } } : {};
    const unitScope: Prisma.EquipmentUnitWhereInput = {
      archivedAt: null,
      equipment: { archivedAt: null, lab: { archivedAt: null }, ...(labIds ? { labId: { in: labIds } } : {}) },
    };
    const staleBefore = new Date(Date.now() - POLICY.pendingReviewFlagMs);

    const [
      pendingRequests,
      stalePending,
      reservations,
      activeLoans,
      overdueLoans,
      returnsInProgress,
      unitsAvailable,
      unitsReserved,
      unitsIssued,
      unitsTotal,
      recentLogs,
    ] = await Promise.all([
      prisma.borrowLog.count({ where: { ...logScope, status: 'PENDING' } }),
      prisma.borrowLog.count({ where: { ...logScope, status: 'PENDING', createdAt: { lt: staleBefore } } }),
      prisma.borrowLog.count({ where: { ...logScope, status: 'APPROVED' } }),
      prisma.borrowLog.count({ where: { ...logScope, status: { in: ['ISSUED', 'OVERDUE'] } } }),
      prisma.borrowLog.count({ where: { ...logScope, status: 'OVERDUE' } }),
      prisma.borrowLog.count({ where: { ...logScope, status: { in: ['ISSUED', 'OVERDUE'] }, returnInitiatedAt: { not: null } } }),
      prisma.equipmentUnit.count({ where: { ...unitScope, status: 'AVAILABLE', condition: 'WORKING', assetStatus: 'RECEIVED' } }),
      prisma.equipmentUnit.count({ where: { ...unitScope, status: 'RESERVED' } }),
      prisma.equipmentUnit.count({ where: { ...unitScope, status: 'ISSUED' } }),
      prisma.equipmentUnit.count({ where: unitScope }),
      prisma.borrowLog.findMany({
        where: logScope,
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: {
          user: { select: { name: true, email: true } },
          equipment: { select: { name: true, lab: { select: { name: true } } } },
        },
      }),
    ]);

    return {
      success: true as const,
      scope: labIds === null ? 'ALL' : labIds.length === 0 ? 'NONE' : 'ASSIGNED',
      role: session.role,
      stats: {
        pendingRequests,
        stalePending,
        reservations,
        activeLoans,
        overdueLoans,
        returnsInProgress,
        unitsAvailable,
        unitsReserved,
        unitsIssued,
        unitsUnavailable: unitsTotal - unitsAvailable - unitsReserved - unitsIssued,
        unitsTotal,
      },
      recentLogs,
    };
  } catch (error) {
    return toActionError(error, 'Failed to fetch dashboard stats.');
  }
}
