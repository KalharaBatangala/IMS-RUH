'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { toActionError } from '@/lib/errors';
import { runMaintenance } from '@/lib/borrow-workflow';

// Flags overdue loans and expires uncollected reservations. This also runs automatically
// whenever the Requests page loads, and via /api/cron/overdue (requires CRON_SECRET).
// An overdue loan stays ISSUED: overdue never releases the unit.
export async function checkAndUpdateOverdueLogs() {
  try {
    const session = await requireSession();
    if (session.role === 'BORROWER') return { success: false as const, error: 'Not permitted.' };
    const result = await runMaintenance();
    revalidatePath('/dashboard/borrow');
    return { success: true as const, updatedCount: result.overdue, expiredCount: result.expired };
  } catch (error) {
    return toActionError(error, 'Failed to update overdue logs.');
  }
}
