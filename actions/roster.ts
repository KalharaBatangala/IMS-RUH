'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/auth';
import { ALLOWED_EMAIL_DOMAINS } from '@/lib/config';
import { ActionError, requireText, toActionError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { ROSTER_MAX_ROWS, type RosterRow } from '@/lib/student-roster';

// Student roster verification (Super Admin only).
//   1. Upload one or more student lists (CSV: index number, name, email).
//   2. "Verify" marks PENDING BORROWER accounts whose email appears in any uploaded list,
//      and copies the index number onto the account.
//   3. "Approve all verified" approves those accounts in one step.
// Staff are not on a student list, so they are never marked and stay on manual approval.
// A match proves the email belongs to a listed student, NOT that the person who
// registered controls that mailbox (registration has no email confirmation).

const BULK_TX_TIMEOUT_MS = 60_000;

function refresh() {
  revalidatePath('/dashboard/admin/users');
  revalidatePath('/dashboard/users');
}

// Pending student-candidate accounts: unapproved, active borrowers.
const PENDING_BORROWER = { isApproved: false, isActive: true, role: 'BORROWER' } as const;

export async function getRosters() {
  try {
    await requireSuperAdmin();
    const rosters = await prisma.studentRoster.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, rowCount: true, createdAt: true, uploadedBy: { select: { name: true } } },
    });
    return { success: true as const, data: rosters };
  } catch (error) {
    return toActionError(error, 'Failed to load student lists.');
  }
}

export async function uploadRoster(input: { fileName: string; rows: RosterRow[] }) {
  try {
    const session = await requireSuperAdmin();
    const fileName = requireText(input?.fileName, 'File name', 200);
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new ActionError('The file has no student rows.');
    if (input.rows.length > ROSTER_MAX_ROWS) throw new ActionError(`At most ${ROSTER_MAX_ROWS} students per file.`);

    const valid: RosterRow[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    input.rows.forEach((raw, i) => {
      const line = i + 2; // +1 header, +1 for 1-based numbering as in a spreadsheet
      const indexNumber = String(raw?.indexNumber ?? '').trim();
      const name = String(raw?.name ?? '').trim();
      const email = String(raw?.email ?? '').trim().toLowerCase();
      if (!indexNumber || !name || !email) return skipped.push(`Row ${line}: index number, name and email are all required.`);
      if (indexNumber.length > 50 || name.length > 120 || email.length > 200) return skipped.push(`Row ${line}: a value is too long.`);
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || !ALLOWED_EMAIL_DOMAINS.some((d) => email.endsWith(d))) {
        return skipped.push(`Row ${line}: "${email}" is not a university email.`);
      }
      if (seen.has(email)) return skipped.push(`Row ${line}: duplicate email ${email}.`);
      seen.add(email);
      valid.push({ indexNumber, name, email });
    });
    if (valid.length === 0) throw new ActionError(`No valid rows. ${skipped.slice(0, 3).join(' ')}`);

    const roster = await prisma.$transaction(
      async (tx) => {
        const created = await tx.studentRoster.create({
          data: { fileName, rowCount: valid.length, uploadedById: session.userId },
        });
        await tx.studentRosterEntry.createMany({ data: valid.map((r) => ({ ...r, rosterId: created.id })) });
        await audit(tx, {
          actorId: session.userId,
          action: 'STUDENT_ROSTER_UPLOADED',
          entityType: 'StudentRoster',
          entityId: created.id,
          details: { fileName, rows: valid.length, skipped: skipped.length },
        });
        return created;
      },
      { timeout: BULK_TX_TIMEOUT_MS }
    );

    refresh();
    return { success: true as const, data: { rosterId: roster.id, imported: valid.length, skipped } };
  } catch (error) {
    return toActionError(error, 'Failed to upload the student list.');
  }
}

// Removes the list and its rows. Accounts already verified keep their copied index number.
export async function deleteRoster(rosterId: string) {
  try {
    const session = await requireSuperAdmin();
    await prisma.$transaction(async (tx) => {
      const roster = await tx.studentRoster.findUnique({ where: { id: String(rosterId) } });
      if (!roster) throw new ActionError('Student list not found.');
      await tx.studentRoster.delete({ where: { id: roster.id } });
      await audit(tx, {
        actorId: session.userId,
        action: 'STUDENT_ROSTER_DELETED',
        entityType: 'StudentRoster',
        entityId: roster.id,
        details: { fileName: roster.fileName, rows: roster.rowCount },
      });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to delete the student list.');
  }
}

// Checks every pending, not-yet-verified borrower against ALL uploaded lists.
export async function verifyPendingStudents() {
  try {
    const session = await requireSuperAdmin();
    const result = await prisma.$transaction(
      async (tx) => {
        const pending = await tx.user.findMany({
          where: { ...PENDING_BORROWER, rosterVerifiedAt: null },
          select: { id: true, email: true },
        });
        if (pending.length === 0) return { checked: 0, verified: [] as string[] };

        // Newest list wins if the same email is in more than one.
        const entries = await tx.studentRosterEntry.findMany({
          where: { email: { in: pending.map((u) => u.email.toLowerCase()) } },
          orderBy: { roster: { createdAt: 'desc' } },
          select: { email: true, indexNumber: true },
        });
        const byEmail = new Map<string, string>();
        for (const e of entries) if (!byEmail.has(e.email)) byEmail.set(e.email, e.indexNumber);

        const now = new Date();
        const verified: string[] = [];
        for (const u of pending) {
          const indexNumber = byEmail.get(u.email.toLowerCase());
          if (!indexNumber) continue;
          // Conditional update: skip if approved / verified / changed meanwhile.
          const res = await tx.user.updateMany({
            where: { id: u.id, ...PENDING_BORROWER, rosterVerifiedAt: null },
            data: { indexNumber, rosterVerifiedAt: now },
          });
          if (res.count === 1) verified.push(u.id);
        }
        if (verified.length > 0) {
          await audit(tx, {
            actorId: session.userId,
            action: 'STUDENTS_ROSTER_VERIFIED',
            entityType: 'User',
            details: { checked: pending.length, verified: verified.length, userIds: verified },
          });
        }
        return { checked: pending.length, verified };
      },
      { timeout: BULK_TX_TIMEOUT_MS }
    );
    refresh();
    return { success: true as const, data: { checked: result.checked, verified: result.verified.length } };
  } catch (error) {
    return toActionError(error, 'Failed to verify pending accounts.');
  }
}

// One-click approval of every pending borrower already marked as roster-verified.
// Each account gets its own USER_APPROVED audit row, the same as manual approval.
export async function approveVerifiedStudents() {
  try {
    const session = await requireSuperAdmin();
    const approved = await prisma.$transaction(
      async (tx) => {
        const candidates = await tx.user.findMany({
          where: { ...PENDING_BORROWER, rosterVerifiedAt: { not: null } },
          select: { id: true },
        });
        const ids: string[] = [];
        for (const c of candidates) {
          const res = await tx.user.updateMany({
            where: { id: c.id, ...PENDING_BORROWER, rosterVerifiedAt: { not: null } },
            data: { isApproved: true, sessionVersion: { increment: 1 } },
          });
          if (res.count !== 1) continue;
          ids.push(c.id);
          await audit(tx, {
            actorId: session.userId,
            action: 'USER_APPROVED',
            entityType: 'User',
            entityId: c.id,
            details: { via: 'student roster bulk approval' },
          });
        }
        return ids;
      },
      { timeout: BULK_TX_TIMEOUT_MS }
    );
    if (approved.length === 0) throw new ActionError('There are no verified accounts waiting for approval.');
    await notify(approved, { title: 'Account approved', body: 'Your DEIE Labs account has been approved.', link: '/dashboard/inventory' });
    refresh();
    return { success: true as const, data: { approved: approved.length } };
  } catch (error) {
    return toActionError(error, 'Failed to approve verified accounts.');
  }
}
