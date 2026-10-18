import { randomUUID } from 'crypto';
import { Prisma, type CodePurpose, type ItemCondition, type RequestStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { POLICY } from '@/lib/config';
import { ActionError, optionalText, requireText } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { handoverCodeEmail, sendEmail } from '@/lib/email';
import { codeMatches, generateCode, hashCode } from '@/lib/codes';
import { requestableUnitWhere } from '@/lib/availability';
import {
  assignmentRoleFor,
  getActiveLabIds,
  getLabStaffing,
  isAssignedToLab,
  requireLabOperational,
  requireLabRole,
} from '@/lib/authz';
import type { SessionUser } from '@/lib/auth';

// Core borrow / reservation / issue / return workflow.
//
// Every state change is a CONDITIONAL update inside a transaction
// (e.g. "set APPROVED where id = X AND status = PENDING"). If the row is no longer in the
// expected state, zero rows change and the whole transaction is rolled back. This is what
// stops two Coordinators reserving the same unit, or a code being used twice, even when
// requests arrive at the same moment.

type Tx = Prisma.TransactionClient;
type Actor = SessionUser;

const ACTIVE_LOAN: RequestStatus[] = ['ISSUED', 'OVERDUE'];
const OPEN_REQUEST: RequestStatus[] = ['PENDING', 'APPROVED'];
const CONDITIONS: ItemCondition[] = ['WORKING', 'DAMAGED', 'UNDER_REPAIR'];

const BORROW_PATH = '/dashboard/borrow';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// 'YYYY-MM-DD' in the server's local time zone. Return dates are due at the END of the day.
export function parseLocalDate(value: string, endOfDay: boolean): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) throw new ActionError('Please provide valid dates.');
  const [, y, m, d] = match.map(Number);
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) throw new ActionError('Please provide valid dates.');
  return date;
}

function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function loadLog(logId: string, db: Tx | typeof prisma = prisma) {
  if (typeof logId !== 'string' || !logId) throw new ActionError('Request not found.');
  const log = await db.borrowLog.findUnique({
    where: { id: logId },
    include: {
      equipment: { select: { id: true, name: true, labId: true, lab: { select: { name: true } } } },
      unit: { select: { id: true, serialNumber: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!log) throw new ActionError('Request not found.');
  return log;
}

function expectOne(count: number, message: string) {
  if (count !== 1) throw new ActionError(message);
}

async function invalidateCodes(tx: Tx, logId: string, purpose?: CodePurpose) {
  await tx.confirmationCode.updateMany({
    where: { logId, consumedAt: null, invalidatedAt: null, ...(purpose ? { purpose } : {}) },
    data: { invalidatedAt: new Date() },
  });
}

async function createCode(tx: Tx, logId: string, purpose: CodePurpose, expiresAt: Date, createdById: string) {
  await invalidateCodes(tx, logId, purpose);
  const id = randomUUID();
  const code = generateCode();
  await tx.confirmationCode.create({
    data: { id, logId, purpose, codeHash: hashCode(code, id), expiresAt, createdById },
  });
  return code; // returned to the caller ONCE; never stored or logged in plaintext
}

// Release a unit held by `logId` (reserved or issued) back to the AVAILABLE allocation state.
async function releaseUnit(tx: Tx, logId: string, from: 'RESERVED' | 'ISSUED', data: Prisma.EquipmentUnitUpdateManyMutationInput = {}) {
  return tx.equipmentUnit.updateMany({
    where: { currentLogId: logId, status: from },
    data: { status: 'AVAILABLE', currentLogId: null, ...data },
  });
}

// Shared check for one-time codes. Wrong attempts are counted OUTSIDE the main transaction
// so they persist even though the workflow change is not made.
async function verifyCode(
  actor: Actor,
  log: { id: string; equipment: { labId: string } },
  purpose: CodePurpose,
  code: string
) {
  const now = new Date();
  const active = await prisma.confirmationCode.findFirst({
    where: { logId: log.id, purpose, consumedAt: null, invalidatedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const label = purpose === 'HANDOVER' ? 'handover' : 'return';
  if (!active) throw new ActionError(`There is no active ${label} code for this request. Ask for a new code.`);
  if (active.expiresAt <= now) throw new ActionError(`The ${label} code has expired. Ask for a new code.`);
  if (active.attempts >= POLICY.codeMaxAttempts) throw new ActionError(`The ${label} code is locked after too many attempts. Ask for a new code.`);

  if (!codeMatches(String(code ?? ''), active.id, active.codeHash)) {
    const attempts = active.attempts + 1;
    await prisma.confirmationCode.updateMany({
      where: { id: active.id, attempts: active.attempts },
      data: { attempts: { increment: 1 }, ...(attempts >= POLICY.codeMaxAttempts ? { invalidatedAt: now } : {}) },
    });
    await audit(prisma, {
      actorId: actor.userId,
      action: purpose === 'HANDOVER' ? 'HANDOVER_CODE_FAILED' : 'RETURN_CODE_FAILED',
      entityType: 'BorrowLog',
      entityId: log.id,
      labId: log.equipment.labId,
      details: { attempts },
    });
    const left = POLICY.codeMaxAttempts - attempts;
    throw new ActionError(
      left > 0 ? `Incorrect code. ${left} attempt(s) left.` : `Incorrect code. The ${label} code is now locked; ask for a new code.`
    );
  }
  return active;
}

async function consumeCode(tx: Tx, codeId: string) {
  const res = await tx.confirmationCode.updateMany({
    where: { id: codeId, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  expectOne(res.count, 'This code has already been used or is no longer valid.');
}

// Run a transaction; translate serialization conflicts into a friendly retry message.
async function tx<T>(fn: (tx: Tx) => Promise<T>, options?: { serializable?: boolean }): Promise<T> {
  try {
    return await prisma.$transaction(fn, {
      isolationLevel: options?.serializable ? Prisma.TransactionIsolationLevel.Serializable : undefined,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new ActionError('Another change happened at the same time. Please refresh and try again.');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// maintenance: reservation expiry + overdue flagging (run lazily on page loads / cron)
// ---------------------------------------------------------------------------

export async function runMaintenance(now = new Date()) {
  const expiring = await prisma.borrowLog.findMany({
    where: { status: 'APPROVED', reservationExpiresAt: { lt: now } },
    select: { id: true, userId: true, equipment: { select: { name: true, labId: true } } },
  });
  for (const log of expiring) {
    const done = await tx(async (t) => {
      const res = await t.borrowLog.updateMany({
        where: { id: log.id, status: 'APPROVED', reservationExpiresAt: { lt: now } },
        data: { status: 'EXPIRED', expiredAt: now },
      });
      if (res.count !== 1) return false;
      await releaseUnit(t, log.id, 'RESERVED');
      await invalidateCodes(t, log.id);
      await audit(t, { actorId: null, action: 'RESERVATION_EXPIRED', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId });
      return true;
    }).catch((error) => {
      console.error('[maintenance] expiry failed', error);
      return false;
    });
    if (done) {
      const staffing = await getLabStaffing(log.equipment.labId);
      await notify([log.userId, ...staffing.coordinatorIds], {
        title: 'Reservation expired',
        body: `The reservation for "${log.equipment.name}" was not collected before its deadline and has expired.`,
        link: BORROW_PATH,
      });
    }
  }

  const overdue = await prisma.borrowLog.findMany({
    where: { status: 'ISSUED', returnDate: { lt: now } },
    select: { id: true, userId: true, equipment: { select: { name: true, labId: true } } },
  });
  for (const log of overdue) {
    const res = await prisma.borrowLog.updateMany({
      where: { id: log.id, status: 'ISSUED', returnDate: { lt: now } },
      data: { status: 'OVERDUE' },
    });
    if (res.count === 1) {
      await audit(prisma, { actorId: null, action: 'LOAN_OVERDUE', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId });
      await notify([log.userId], {
        title: 'Loan overdue',
        body: `"${log.equipment.name}" is past its return date. Please return it to the Technical Officer.`,
        link: BORROW_PATH,
      });
    }
  }
  return { expired: expiring.length, overdue: overdue.length };
}

// ---------------------------------------------------------------------------
// 1. Borrower submits a request
// ---------------------------------------------------------------------------

export async function createRequest(
  actor: Actor,
  input: { equipmentId: string; borrowDate: string; returnDate: string; notes?: string }
) {
  const equipment = await prisma.equipment.findUnique({
    where: { id: String(input.equipmentId ?? '') },
    include: { lab: { select: { name: true, archivedAt: true } } },
  });
  if (!equipment || equipment.archivedAt || equipment.lab.archivedAt) {
    throw new ActionError('This equipment is not available for borrowing.');
  }
  const staffing = await requireLabOperational(equipment.labId);

  const borrowDate = parseLocalDate(input.borrowDate, false);
  const returnDate = parseLocalDate(input.returnDate, true);
  if (borrowDate < startOfToday()) throw new ActionError('The borrow date cannot be in the past.');
  if (returnDate < borrowDate) throw new ActionError('The return date must be on or after the borrow date.');
  const notes = optionalText(input.notes, 'Purpose / notes', 1000);

  const log = await tx(
    async (t) => {
      const available = await t.equipmentUnit.count({ where: { equipmentId: equipment.id, ...requestableUnitWhere } });
      if (available === 0) throw new ActionError('No units of this equipment are currently available.');

      const duplicate = await t.borrowLog.findFirst({
        where: { userId: actor.userId, equipmentId: equipment.id, status: { in: OPEN_REQUEST } },
        select: { id: true },
      });
      if (duplicate) throw new ActionError('You already have an open request for this equipment.');

      const created = await t.borrowLog.create({
        data: { userId: actor.userId, equipmentId: equipment.id, borrowDate, returnDate, notes, status: 'PENDING' },
      });
      await audit(t, {
        actorId: actor.userId,
        action: 'REQUEST_SUBMITTED',
        entityType: 'BorrowLog',
        entityId: created.id,
        labId: equipment.labId,
        details: { equipmentId: equipment.id },
      });
      return created;
    },
    { serializable: true }
  );

  await notify(staffing.coordinatorIds, {
    title: 'New borrow request',
    body: `${actor.name} requested "${equipment.name}" (${equipment.lab.name}).`,
    link: BORROW_PATH,
  });
  return { id: log.id };
}

// ---------------------------------------------------------------------------
// 2. Borrower cancels own request before physical issue
// ---------------------------------------------------------------------------

export async function cancelRequest(actor: Actor, logId: string, reason?: string) {
  const log = await loadLog(logId);
  if (log.userId !== actor.userId) throw new ActionError('You can only cancel your own requests.');
  const cancelReason = optionalText(reason, 'Reason', 500);
  const wasReserved = log.status === 'APPROVED';

  await tx(async (t) => {
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, userId: actor.userId, status: { in: OPEN_REQUEST } },
      data: { status: 'CANCELLED', cancelledById: actor.userId, cancelledAt: new Date(), cancelReason },
    });
    expectOne(res.count, 'This request can no longer be cancelled (it may already have been issued or closed).');
    await releaseUnit(t, log.id, 'RESERVED');
    await invalidateCodes(t, log.id);
    await audit(t, { actorId: actor.userId, action: 'REQUEST_CANCELLED', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId, details: { reason: cancelReason } });
  });

  const staffing = await getLabStaffing(log.equipment.labId);
  await notify(wasReserved ? [...staffing.coordinatorIds, ...staffing.technicalOfficerIds] : staffing.coordinatorIds, {
    title: 'Request cancelled',
    body: `${actor.name} cancelled their request for "${log.equipment.name}".`,
    link: BORROW_PATH,
  });
}

// ---------------------------------------------------------------------------
// 3. Coordinator recommends (reserves a specific unit) or rejects
// ---------------------------------------------------------------------------

export async function getReservableUnits(actor: Actor, logId: string) {
  const log = await loadLog(logId);
  await requireLabRole(actor, log.equipment.labId, 'COORDINATOR');
  return prisma.equipmentUnit.findMany({
    where: { equipmentId: log.equipmentId, ...requestableUnitWhere },
    select: { id: true, serialNumber: true },
    orderBy: { serialNumber: 'asc' },
  });
}

export async function recommendRequest(actor: Actor, logId: string, unitId: string) {
  const log = await loadLog(logId);
  if (typeof unitId !== 'string' || !unitId) throw new ActionError('Please select the unit to reserve.');
  const now = new Date();
  const reservationExpiresAt = new Date(now.getTime() + POLICY.reservationCollectionMs);

  const result = await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'COORDINATOR', t);
    await requireLabOperational(log.equipment.labId, t);

    const res = await t.borrowLog.updateMany({
      where: { id: log.id, status: 'PENDING' },
      data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: now, reservationExpiresAt, unitId },
    });
    expectOne(res.count, 'This request is no longer pending.');

    const unitRes = await t.equipmentUnit.updateMany({
      where: { id: unitId, equipmentId: log.equipmentId, ...requestableUnitWhere },
      data: { status: 'RESERVED', currentLogId: log.id },
    });
    expectOne(unitRes.count, 'That unit is no longer available. Please choose another unit.');

    const unit = await t.equipmentUnit.findUniqueOrThrow({ where: { id: unitId }, select: { serialNumber: true } });
    const code = await createCode(t, log.id, 'HANDOVER', reservationExpiresAt, actor.userId);
    await audit(t, {
      actorId: actor.userId,
      action: 'REQUEST_RECOMMENDED',
      entityType: 'BorrowLog',
      entityId: log.id,
      labId: log.equipment.labId,
      details: {
        unitId,
        serialNumber: unit.serialNumber,
        reservationExpiresAt: reservationExpiresAt.toISOString(),
        // v1 accepted limitation: a Coordinator may recommend their own request.
        selfRecommended: log.userId === actor.userId,
      },
    });
    return { code, serialNumber: unit.serialNumber };
  });

  // Email the code to the borrower (after commit; never affects the reservation). The
  // email doubles as the notification email, so the in-app copy is not emailed again.
  const codeEmailed = await emailHandoverCode(log, result.code, result.serialNumber, reservationExpiresAt);
  const staffing = await getLabStaffing(log.equipment.labId);
  await notify(
    [log.userId],
    {
      title: 'Request recommended — unit reserved',
      body: codeEmailed
        ? `Your request for "${log.equipment.name}" was recommended by ${actor.name}. Unit ${result.serialNumber} is reserved for you until ${reservationExpiresAt.toLocaleString()}. Your handover code has been emailed to you; present it to a Technical Officer of ${log.equipment.lab.name}.`
        : `Your request for "${log.equipment.name}" was recommended by ${actor.name}. Unit ${result.serialNumber} is reserved for you until ${reservationExpiresAt.toLocaleString()}. Collect your handover code from the Coordinator and present it to a Technical Officer of ${log.equipment.lab.name}.`,
      link: BORROW_PATH,
    },
    { email: !codeEmailed }
  );
  await notify(staffing.technicalOfficerIds, {
    title: 'Unit reserved — awaiting collection',
    body: `${result.serialNumber} ("${log.equipment.name}") is reserved for ${log.user.name}.`,
    link: BORROW_PATH,
  });
  return { ...result, reservationExpiresAt, codeEmailed };
}

export async function rejectRequest(actor: Actor, logId: string, reason: string) {
  const log = await loadLog(logId);
  const rejectionReason = requireText(reason, 'Rejection reason', 500);

  await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'COORDINATOR', t);
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectedById: actor.userId, rejectedAt: new Date(), rejectionReason },
    });
    expectOne(res.count, 'This request is no longer pending.');
    await audit(t, { actorId: actor.userId, action: 'REQUEST_REJECTED', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId, details: { reason: rejectionReason } });
  });

  await notify([log.userId], {
    title: 'Request rejected',
    body: `Your request for "${log.equipment.name}" was not recommended. Reason: ${rejectionReason}`,
    link: BORROW_PATH,
  });
}

// Controlled recovery when the borrower did not receive / lost the handover code.
export async function regenerateHandoverCode(actor: Actor, logId: string) {
  const log = await loadLog(logId);
  const result = await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'COORDINATOR', t);
    const current = await t.borrowLog.findUnique({ where: { id: log.id }, select: { status: true, reservationExpiresAt: true } });
    if (current?.status !== 'APPROVED' || !current.reservationExpiresAt || current.reservationExpiresAt <= new Date()) {
      throw new ActionError('A handover code can only be issued for an active, not-yet-issued reservation.');
    }
    const code = await createCode(t, log.id, 'HANDOVER', current.reservationExpiresAt, actor.userId);
    await audit(t, { actorId: actor.userId, action: 'HANDOVER_CODE_REGENERATED', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId });
    const unit = log.unitId ? await t.equipmentUnit.findUnique({ where: { id: log.unitId }, select: { serialNumber: true } }) : null;
    return { code, expiresAt: current.reservationExpiresAt, serialNumber: unit?.serialNumber ?? '' };
  });
  const codeEmailed = await emailHandoverCode(log, result.code, result.serialNumber, result.expiresAt, true);
  return { code: result.code, expiresAt: result.expiresAt, codeEmailed };
}

// Sends the handover code to the borrower's university email. Returns false when email is
// disabled or delivery failed; the Coordinator then gives the code in person as before.
async function emailHandoverCode(
  log: Awaited<ReturnType<typeof loadLog>>,
  code: string,
  serialNumber: string,
  expiresAt: Date,
  regenerated = false
) {
  const content = handoverCodeEmail({
    borrowerName: log.user.name,
    equipmentName: log.equipment.name,
    serialNumber,
    labName: log.equipment.lab.name,
    code,
    expiresAt,
    regenerated,
  });
  return sendEmail({ to: log.user.email, userId: log.user.id, kind: 'HANDOVER_CODE', logId: log.id, ...content });
}

// ---------------------------------------------------------------------------
// 4. Technical Officer records physical handover (issue) using the handover code
// ---------------------------------------------------------------------------

export async function issueWithCode(actor: Actor, logId: string, code: string, issueNotesInput?: string) {
  const log = await loadLog(logId);
  await requireLabRole(actor, log.equipment.labId, 'TECHNICAL_OFFICER');
  if (log.userId === actor.userId) {
    throw new ActionError('You cannot issue equipment to yourself. Another Technical Officer of this lab must record the handover.');
  }
  if (log.status !== 'APPROVED') throw new ActionError('Only a recommended (reserved) request can be issued.');
  const issueNotes = optionalText(issueNotesInput, 'Issue notes', 1000);

  const active = await verifyCode(actor, log, 'HANDOVER', code);
  const now = new Date();

  await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'TECHNICAL_OFFICER', t);
    await consumeCode(t, active.id);
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, status: 'APPROVED', reservationExpiresAt: { gt: now } },
      data: { status: 'ISSUED', issuedById: actor.userId, issuedAt: now, issueNotes },
    });
    expectOne(res.count, 'This reservation is no longer valid for issue.');
    const unitRes = await t.equipmentUnit.updateMany({
      where: { currentLogId: log.id, status: 'RESERVED', condition: 'WORKING', assetStatus: 'RECEIVED', archivedAt: null },
      data: { status: 'ISSUED' },
    });
    expectOne(unitRes.count, 'The reserved unit is no longer fit for issue. The Coordinator must resolve this reservation.');
    await audit(t, {
      actorId: actor.userId,
      action: 'LOAN_ISSUED',
      entityType: 'BorrowLog',
      entityId: log.id,
      labId: log.equipment.labId,
      details: { unitId: log.unitId, serialNumber: log.unit?.serialNumber ?? null },
    });
  });

  await notify([log.userId], {
    title: 'Equipment issued',
    body: `"${log.equipment.name}" (${log.unit?.serialNumber ?? ''}) was issued to you by ${actor.name}. Please return it by ${log.returnDate.toLocaleDateString()}.`,
    link: BORROW_PATH,
  });
}

// ---------------------------------------------------------------------------
// 5. Return: TO inspects & starts -> borrower enters code -> TO finalizes
// ---------------------------------------------------------------------------

export async function startReturn(actor: Actor, logId: string, input: { condition: ItemCondition; notes?: string }) {
  const log = await loadLog(logId);
  if (!CONDITIONS.includes(input.condition)) throw new ActionError('Please record the condition of the returned item.');
  const returnNotes = optionalText(input.notes, 'Inspection notes', 1000);
  if (input.condition !== 'WORKING' && !returnNotes) {
    throw new ActionError('Please describe the damage / problem in the inspection notes.');
  }
  if (log.userId === actor.userId) {
    throw new ActionError('You cannot process the return of your own loan. Another Technical Officer of this lab must do it.');
  }
  const now = new Date();

  const code = await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'TECHNICAL_OFFICER', t);
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, status: { in: ACTIVE_LOAN } },
      data: {
        returnInitiatedById: actor.userId,
        returnInitiatedAt: now,
        returnCondition: input.condition,
        returnNotes,
        returnAcknowledgedAt: null,
        returnAckOverrideById: null,
        returnAckOverrideReason: null,
      },
    });
    expectOne(res.count, 'This loan is not currently active.');
    const generated = await createCode(t, log.id, 'RETURN', new Date(now.getTime() + POLICY.returnCodeTtlMs), actor.userId);
    await audit(t, {
      actorId: actor.userId,
      action: 'RETURN_INITIATED',
      entityType: 'BorrowLog',
      entityId: log.id,
      labId: log.equipment.labId,
      details: { condition: input.condition, notes: returnNotes },
    });
    return generated;
  });

  await notify([log.userId], {
    title: 'Return in progress',
    body: `${actor.name} has inspected "${log.equipment.name}". Enter the return code they show you under My Requests to acknowledge the return.`,
    link: BORROW_PATH,
  });
  return { code, expiresAt: new Date(now.getTime() + POLICY.returnCodeTtlMs) };
}

export async function acknowledgeReturn(actor: Actor, logId: string, code: string) {
  const log = await loadLog(logId);
  if (log.userId !== actor.userId) throw new ActionError('Only the borrower can acknowledge this return.');
  if (!ACTIVE_LOAN.includes(log.status) || !log.returnInitiatedAt) {
    throw new ActionError('There is no return in progress for this loan.');
  }
  if (log.returnAcknowledgedAt) throw new ActionError('You have already acknowledged this return.');

  const active = await verifyCode(actor, log, 'RETURN', code);
  await tx(async (t) => {
    await consumeCode(t, active.id);
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, userId: actor.userId, status: { in: ACTIVE_LOAN }, returnInitiatedAt: { not: null }, returnAcknowledgedAt: null },
      data: { returnAcknowledgedAt: new Date() },
    });
    expectOne(res.count, 'This return can no longer be acknowledged.');
    await audit(t, { actorId: actor.userId, action: 'RETURN_ACKNOWLEDGED', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId });
  });

  if (log.returnInitiatedById) {
    await notify([log.returnInitiatedById], {
      title: 'Return acknowledged',
      body: `${actor.name} acknowledged the return of "${log.equipment.name}". You can now finalize the return.`,
      link: BORROW_PATH,
    });
  }
}

// Authorised, audited resolution when the borrower cannot enter the return code.
export async function overrideReturnAcknowledgement(actor: Actor, logId: string, reason: string) {
  const log = await loadLog(logId);
  const overrideReason = requireText(reason, 'Reason', 500);
  if (log.userId === actor.userId) throw new ActionError('You cannot override the acknowledgement of your own return.');

  await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'COORDINATOR', t);
    const res = await t.borrowLog.updateMany({
      where: { id: log.id, status: { in: ACTIVE_LOAN }, returnInitiatedAt: { not: null }, returnAcknowledgedAt: null, returnAckOverrideById: null },
      data: { returnAckOverrideById: actor.userId, returnAckOverrideReason: overrideReason },
    });
    expectOne(res.count, 'There is no unacknowledged return in progress for this loan.');
    await invalidateCodes(t, log.id, 'RETURN');
    await audit(t, { actorId: actor.userId, action: 'RETURN_ACK_OVERRIDDEN', entityType: 'BorrowLog', entityId: log.id, labId: log.equipment.labId, details: { reason: overrideReason } });
  });

  const staffing = await getLabStaffing(log.equipment.labId);
  await notify([log.userId, ...staffing.technicalOfficerIds], {
    title: 'Return acknowledgement recorded by Coordinator',
    body: `${actor.name} recorded the return acknowledgement for "${log.equipment.name}" on the borrower's behalf. Reason: ${overrideReason}`,
    link: BORROW_PATH,
  });
}

export async function finalizeReturn(actor: Actor, logId: string) {
  const log = await loadLog(logId);
  if (log.userId === actor.userId) {
    throw new ActionError('You cannot finalize the return of your own loan. Another Technical Officer of this lab must do it.');
  }
  if (!ACTIVE_LOAN.includes(log.status) || !log.returnInitiatedAt || !log.returnCondition) {
    throw new ActionError('Start the return (inspection) first.');
  }
  if (!log.returnAcknowledgedAt && !log.returnAckOverrideById) {
    throw new ActionError('The borrower has not acknowledged the return yet.');
  }
  const now = new Date();
  const fit = log.returnCondition === 'WORKING';

  await tx(async (t) => {
    await requireLabRole(actor, log.equipment.labId, 'TECHNICAL_OFFICER', t);
    const res = await t.borrowLog.updateMany({
      where: {
        id: log.id,
        status: { in: ACTIVE_LOAN },
        returnInitiatedAt: { not: null },
        OR: [{ returnAcknowledgedAt: { not: null } }, { returnAckOverrideById: { not: null } }],
      },
      data: { status: 'RETURNED', actualReturn: now, returnedById: actor.userId },
    });
    expectOne(res.count, 'This return has already been completed or is no longer valid.');
    const unitRes = await releaseUnit(t, log.id, 'ISSUED', {
      condition: log.returnCondition!,
      unavailableReason: fit ? null : `Returned ${log.returnCondition} on ${now.toLocaleDateString()}: ${log.returnNotes ?? ''}`.trim(),
    });
    expectOne(unitRes.count, 'The issued unit could not be found for this loan.');
    await invalidateCodes(t, log.id);
    await audit(t, {
      actorId: actor.userId,
      action: 'LOAN_RETURNED',
      entityType: 'BorrowLog',
      entityId: log.id,
      labId: log.equipment.labId,
      details: {
        condition: log.returnCondition,
        serialNumber: log.unit?.serialNumber ?? null,
        acknowledgedBy: log.returnAcknowledgedAt ? 'BORROWER' : 'COORDINATOR_OVERRIDE',
      },
    });
  });

  const staffing = await getLabStaffing(log.equipment.labId);
  await notify([log.userId], {
    title: 'Return completed',
    body: `The return of "${log.equipment.name}" has been completed by ${actor.name}.`,
    link: BORROW_PATH,
  });
  if (!fit) {
    await notify(staffing.coordinatorIds, {
      title: 'Item returned with a problem',
      body: `${log.unit?.serialNumber ?? log.equipment.name} was returned ${log.returnCondition}: ${log.returnNotes ?? ''}`,
      link: '/dashboard/inventory',
    });
  }
}

// ---------------------------------------------------------------------------
// 6. A reserved unit became unfit (damaged / under repair / not received / archived)
//    before issue: cancel that reservation transparently, keeping its history.
//    Must be called inside the transaction that changes the unit.
// ---------------------------------------------------------------------------

export async function cancelReservationForUnfitUnit(t: Tx, actor: Actor, unitId: string, why: string) {
  const unit = await t.equipmentUnit.findUnique({ where: { id: unitId }, select: { status: true, currentLogId: true, serialNumber: true } });
  if (!unit?.currentLogId || unit.status !== 'RESERVED') return null;
  const logId = unit.currentLogId;
  const reason = `Reserved unit ${unit.serialNumber} became unavailable: ${why}`;
  const res = await t.borrowLog.updateMany({
    where: { id: logId, status: 'APPROVED' },
    data: { status: 'CANCELLED', cancelledById: actor.userId, cancelledAt: new Date(), cancelReason: reason },
  });
  if (res.count !== 1) return null;
  await releaseUnit(t, logId, 'RESERVED');
  await invalidateCodes(t, logId);
  const log = await t.borrowLog.findUniqueOrThrow({ where: { id: logId }, select: { userId: true, equipment: { select: { labId: true, name: true } } } });
  await audit(t, { actorId: actor.userId, action: 'RESERVATION_CANCELLED_UNIT_UNFIT', entityType: 'BorrowLog', entityId: logId, labId: log.equipment.labId, details: { reason } });
  return { logId, borrowerId: log.userId, labId: log.equipment.labId, equipmentName: log.equipment.name, reason };
}

// ---------------------------------------------------------------------------
// 7. Listing: what the actor may see, with the actions they may take
// ---------------------------------------------------------------------------

export async function listVisibleLogs(actor: Actor) {
  const coordLabs = assignmentRoleFor(actor) === 'COORDINATOR' ? await getActiveLabIds(actor.userId, 'COORDINATOR') : [];
  const toLabs = assignmentRoleFor(actor) === 'TECHNICAL_OFFICER' ? await getActiveLabIds(actor.userId, 'TECHNICAL_OFFICER') : [];
  const staffLabs = [...coordLabs, ...toLabs];

  const where: Prisma.BorrowLogWhereInput =
    actor.role === 'SUPER_ADMIN'
      ? {}
      : { OR: [{ userId: actor.userId }, ...(staffLabs.length ? [{ equipment: { labId: { in: staffLabs } } }] : [])] };

  const logs = await prisma.borrowLog.findMany({
    where,
    include: {
      user: { select: { name: true, email: true } },
      equipment: { select: { id: true, name: true, brand: true, labId: true, lab: { select: { name: true } } } },
      unit: { select: { serialNumber: true, location: true } },
      approvedBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
      cancelledBy: { select: { name: true } },
      issuedBy: { select: { name: true } },
      returnInitiatedBy: { select: { name: true } },
      returnAckOverrideBy: { select: { name: true } },
      returnedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = Date.now();
  return logs.map((log) => {
    const isOwn = log.userId === actor.userId;
    const isCoord = coordLabs.includes(log.equipment.labId);
    const isTO = toLabs.includes(log.equipment.labId);
    const active = ACTIVE_LOAN.includes(log.status);
    const returnStarted = active && Boolean(log.returnInitiatedAt);
    const returnAcked = Boolean(log.returnAcknowledgedAt || log.returnAckOverrideById);
    const reservationLive = log.status === 'APPROVED' && Boolean(log.reservationExpiresAt && log.reservationExpiresAt.getTime() > now);
    return {
      ...log,
      flags: {
        isOwn,
        awaitingReviewTooLong: log.status === 'PENDING' && now - log.createdAt.getTime() > POLICY.pendingReviewFlagMs,
        selfRecommended: Boolean(log.approvedById && log.approvedById === log.userId),
        returnStarted,
        returnAcked,
        // Printable loan form exists once a Coordinator has recommended the request.
        // Kept out of `can` so it does not count as "needs my action".
        hasForm: Boolean(log.approvedAt),
      },
      can: {
        cancel: isOwn && OPEN_REQUEST.includes(log.status),
        recommend: isCoord && log.status === 'PENDING',
        reject: isCoord && log.status === 'PENDING',
        regenerateHandoverCode: isCoord && reservationLive,
        issue: isTO && !isOwn && reservationLive,
        startReturn: isTO && !isOwn && active,
        acknowledgeReturn: isOwn && returnStarted && !log.returnAcknowledgedAt && !log.returnAckOverrideById,
        overrideReturnAck: isCoord && !isOwn && returnStarted && !returnAcked,
        finalizeReturn: isTO && !isOwn && returnStarted && returnAcked,
      },
    };
  });
}


// ---------------------------------------------------------------------------
// 8. Printable loan form (read-only). Available once a request has been recommended,
//    and kept available afterwards (issued, returned, or voided) as a record.
//    Same visibility as the request list: the borrower, the lab's currently assigned
//    Coordinator / TO, or a Super Admin. Returns null for "not found" AND "not allowed"
//    so the existence of other people's requests is not revealed.
//    Confirmation codes are never loaded here.
// ---------------------------------------------------------------------------

export async function getLoanForm(actor: Actor, logId: string) {
  if (typeof logId !== 'string' || !/^[0-9a-f-]{36}$/i.test(logId)) return null;
  const name = { select: { name: true } } as const;
  const log = await prisma.borrowLog.findUnique({
    where: { id: logId },
    include: {
      user: { select: { name: true, email: true } },
      equipment: { select: { name: true, brand: true, model: true, labId: true, lab: { select: { name: true } } } },
      unit: { select: { serialNumber: true, serialIsPlaceholder: true, location: true } },
      approvedBy: { select: { name: true, email: true } },
      cancelledBy: name,
      issuedBy: name,
      returnInitiatedBy: name,
      returnAckOverrideBy: name,
      returnedBy: name,
    },
  });
  if (!log || !log.approvedAt) return null;

  const staffRole = assignmentRoleFor(actor);
  const allowed =
    actor.role === 'SUPER_ADMIN' ||
    log.userId === actor.userId ||
    (staffRole !== null && (await isAssignedToLab(actor.userId, log.equipment.labId, staffRole)));
  return allowed ? log : null;
}
