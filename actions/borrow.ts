'use server';

import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { RequestStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';

// Helper for Staff / Admin auth check
async function checkStaffAuth() {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    throw new Error('Unauthorized');
  }
  return session;
}

// 1. Borrower submits a request
export async function createBorrowRequest(data: {
  equipmentId: string;
  borrowDate: string;
  returnDate: string;
  notes?: string;
}) {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: 'Not authenticated.' };

    const availableCount = await prisma.equipmentUnit.count({
      where: { equipmentId: data.equipmentId, status: 'AVAILABLE', condition: 'WORKING' },
    });
    if (availableCount === 0) {
      return { success: false, error: 'No working units of this equipment are currently available.' };
    }

    const log = await prisma.borrowLog.create({
      data: {
        userId: session.userId,
        equipmentId: data.equipmentId,
        borrowDate: new Date(data.borrowDate),
        returnDate: new Date(data.returnDate),
        notes: data.notes || null,
        status: 'PENDING',
      },
    });

    revalidatePath('/dashboard/inventory');
    revalidatePath('/dashboard/borrow');
    return { success: true, log };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to submit borrow request.' };
  }
}

// 2. Fetch Borrow Requests (Filtered by Role)
export async function getBorrowLogs() {
  try {
    const session = await getSession();
    if (!session) return { success: false, error: 'Not authenticated.' };

    const isStaff = session.role === 'LAB_STAFF' || session.role === 'SUPER_ADMIN';

    const logs = await prisma.borrowLog.findMany({
      where: isStaff ? {} : { userId: session.userId },
      include: {
        user: { select: { name: true, email: true } },
        equipment: { include: { lab: { select: { name: true } } } },
        unit: { select: { serialNumber: true } },
        approvedBy: { select: { name: true } },
        issuedBy: { select: { name: true } },
        returnedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, logs };
  } catch (error) {
    return { success: false, error: 'Failed to fetch borrow requests.' };
  }
}

// 3. Staff Action: Update Request Status (APPROVED, ISSUED, RETURNED, REJECTED)
export async function updateBorrowStatus(logId: string, status: RequestStatus, unitId?: string) {
  try {
    const session = await checkStaffAuth();

    const currentLog = await prisma.borrowLog.findUnique({ where: { id: logId } });
    if (!currentLog) return { success: false, error: 'Borrow request not found.' };

    if (status === 'ISSUED' && !unitId) {
      return { success: false, error: 'Please select which serial number is being issued.' };
    }

    await prisma.$transaction(async (tx) => {
      if (status === 'ISSUED') {
        const unit = await tx.equipmentUnit.findUnique({ where: { id: unitId! } });
        if (!unit || unit.status !== 'AVAILABLE' || unit.condition !== 'WORKING') {
          throw new Error('Selected unit is no longer available.');
        }
        await tx.equipmentUnit.update({ where: { id: unitId! }, data: { status: 'ISSUED' } });
      }

      if (status === 'RETURNED' && currentLog.unitId) {
        await tx.equipmentUnit.update({
          where: { id: currentLog.unitId },
          data: { status: 'AVAILABLE' },
        });
      }

      const updateData: any = { status };
      if (status === 'APPROVED') updateData.approvedById = session.userId;
      if (status === 'ISSUED') {
        updateData.issuedById = session.userId;
        updateData.unitId = unitId;
      }
      if (status === 'RETURNED') {
        updateData.returnedById = session.userId;
        updateData.actualReturn = new Date();
      }

      await tx.borrowLog.update({ where: { id: logId }, data: updateData });
    });

    revalidatePath('/dashboard/borrow');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to update request status.' };
  }
}