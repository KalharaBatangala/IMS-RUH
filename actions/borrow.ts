'use server';

import { revalidatePath } from 'next/cache';
import type { ItemCondition } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { toActionError } from '@/lib/errors';
import * as workflow from '@/lib/borrow-workflow';

// Thin server-action wrappers: authenticate, delegate to lib/borrow-workflow.ts (which
// enforces role + lab scope + state atomically), revalidate, and return the standard shape.

function refresh() {
  revalidatePath('/dashboard/borrow');
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard');
}

// 1. Borrower submits a request
export async function createBorrowRequest(data: {
  equipmentId: string;
  borrowDate: string;
  returnDate: string;
  notes?: string;
}) {
  try {
    const session = await requireSession();
    const result = await workflow.createRequest(session, data);
    refresh();
    return { success: true as const, data: result };
  } catch (error) {
    return toActionError(error, 'Failed to submit borrow request.');
  }
}

// 2. Requests visible to the current user, with the actions they may take
export async function getBorrowLogs() {
  try {
    const session = await requireSession();
    await workflow.runMaintenance();
    const logs = await workflow.listVisibleLogs(session);
    return { success: true as const, logs };
  } catch (error) {
    return toActionError(error, 'Failed to fetch borrow requests.');
  }
}

export async function cancelBorrowRequest(logId: string, reason?: string) {
  try {
    const session = await requireSession();
    await workflow.cancelRequest(session, logId, reason);
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to cancel request.');
  }
}

// 3. Coordinator
export async function getReservableUnits(logId: string) {
  try {
    const session = await requireSession();
    return { success: true as const, data: await workflow.getReservableUnits(session, logId) };
  } catch (error) {
    return toActionError(error, 'Failed to load available units.');
  }
}

export async function recommendBorrowRequest(logId: string, unitId: string) {
  try {
    const session = await requireSession();
    const data = await workflow.recommendRequest(session, logId, unitId);
    refresh();
    return { success: true as const, data };
  } catch (error) {
    return toActionError(error, 'Failed to recommend request.');
  }
}

export async function rejectBorrowRequest(logId: string, reason: string) {
  try {
    const session = await requireSession();
    await workflow.rejectRequest(session, logId, reason);
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to reject request.');
  }
}

export async function regenerateHandoverCode(logId: string) {
  try {
    const session = await requireSession();
    return { success: true as const, data: await workflow.regenerateHandoverCode(session, logId) };
  } catch (error) {
    return toActionError(error, 'Failed to generate a handover code.');
  }
}

export async function overrideReturnAcknowledgement(logId: string, reason: string) {
  try {
    const session = await requireSession();
    await workflow.overrideReturnAcknowledgement(session, logId, reason);
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to record acknowledgement.');
  }
}

// 4. Technical Officer
export async function issueBorrowRequest(logId: string, code: string, notes?: string) {
  try {
    const session = await requireSession();
    await workflow.issueWithCode(session, logId, code, notes);
    refresh();
    return { success: true as const };
  } catch (error) {
    refresh(); // a failed attempt may have locked the code
    return toActionError(error, 'Failed to issue item.');
  }
}

export async function startReturn(logId: string, condition: ItemCondition, notes?: string) {
  try {
    const session = await requireSession();
    const data = await workflow.startReturn(session, logId, { condition, notes });
    refresh();
    return { success: true as const, data };
  } catch (error) {
    return toActionError(error, 'Failed to start the return.');
  }
}

export async function finalizeReturn(logId: string) {
  try {
    const session = await requireSession();
    await workflow.finalizeReturn(session, logId);
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to complete the return.');
  }
}

// 5. Borrower acknowledges a return with the code shown by the TO
export async function acknowledgeReturn(logId: string, code: string) {
  try {
    const session = await requireSession();
    await workflow.acknowledgeReturn(session, logId, code);
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to acknowledge the return.');
  }
}
