// End-to-end test of the borrow workflow against a THROWAWAY database.
//
//   1. Create an empty database, e.g. ruhuna_ims_test
//   2. $env:TEST_DATABASE_URL="postgresql://USER:PASS@localhost:5432/ruhuna_ims_test"
//   3. npx prisma migrate deploy   (with DATABASE_URL pointed at the test DB)
//   4. npm run test:workflow
//
// Refuses to run unless TEST_DATABASE_URL is set and equals DATABASE_URL, so it can
// never touch the real database by accident. It creates its own users/labs/units.

import assert from 'node:assert/strict';

// Never send real emails from the test run (lib/email.ts reads this at send time).
process.env.EMAIL_ENABLED = 'false';
import { randomUUID } from 'crypto';

if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL and DATABASE_URL to the same throwaway test database.');
  process.exit(1);
}

async function main() {
  const { prisma } = await import('../lib/prisma');
  const wf = await import('../lib/borrow-workflow');
  const { ActionError } = await import('../lib/errors');
  const { effectiveAvailability } = await import('../lib/availability');
  type Actor = Parameters<typeof wf.createRequest>[0];

  const tag = randomUUID().slice(0, 6);
  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  };
  const rejects = async (p: Promise<unknown>, pattern: RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof ActionError && pattern.test(e.message));
  };

  async function makeUser(name: string, role: 'SUPER_ADMIN' | 'COORDINATOR' | 'TECHNICAL_OFFICER' | 'BORROWER'): Promise<Actor> {
    const u = await prisma.user.create({ data: { name, email: `${name}-${tag}@eie.ruh.ac.lk`, role, isApproved: true } });
    return { userId: u.id, email: u.email, name: u.name, role: u.role, twoFactorEnabled: false };
  }

  const admin = await makeUser('admin', 'SUPER_ADMIN');
  const coordA = await makeUser('coordA', 'COORDINATOR');
  const coordB = await makeUser('coordB', 'COORDINATOR');
  const toA = await makeUser('toA', 'TECHNICAL_OFFICER');
  const toA2 = await makeUser('toA2', 'TECHNICAL_OFFICER');
  const toB = await makeUser('toB', 'TECHNICAL_OFFICER');
  const student = await makeUser('student', 'BORROWER');
  const student2 = await makeUser('student2', 'BORROWER');

  const labA = await prisma.lab.create({ data: { name: `Lab A ${tag}` } });
  const labB = await prisma.lab.create({ data: { name: `Lab B ${tag}` } });
  const assign = (labId: string, userId: string, role: 'COORDINATOR' | 'TECHNICAL_OFFICER') =>
    prisma.labAssignment.create({ data: { labId, userId, role, assignedById: admin.userId } });

  const eq = await prisma.equipment.create({
    data: {
      name: `Multimeter ${tag}`,
      labId: labA.id,
      units: { create: [{ serialNumber: `DMM-${tag}-1` }, { serialNumber: `DMM-${tag}-2` }] },
    },
    include: { units: true },
  });
  const [unit1, unit2] = eq.units.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));

  const today = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const inDays = (n: number) => ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const req = { equipmentId: eq.id, borrowDate: inDays(0), returnDate: inDays(3), notes: 'test' };

  console.log('Borrow workflow tests');

  await step('lab without Coordinator + TO pauses borrowing', async () => {
    await rejects(wf.createRequest(student, req), /borrowing is paused/);
  });
  await assign(labA.id, coordA.userId, 'COORDINATOR');
  await assign(labA.id, toA.userId, 'TECHNICAL_OFFICER');
  await assign(labA.id, toA2.userId, 'TECHNICAL_OFFICER');
  await assign(labB.id, coordB.userId, 'COORDINATOR');
  await assign(labB.id, toB.userId, 'TECHNICAL_OFFICER');

  await step('date validation', async () => {
    await rejects(wf.createRequest(student, { ...req, borrowDate: inDays(-1) }), /past/);
    await rejects(wf.createRequest(student, { ...req, returnDate: inDays(-1), borrowDate: inDays(0) }), /on or after/);
  });

  const { id: logId } = await wf.createRequest(student, req);
  await step('borrower submits; duplicate open request is rejected', async () => {
    await rejects(wf.createRequest(student, req), /already have an open request/);
  });

  await step('other-lab Coordinator and TOs cannot recommend', async () => {
    await rejects(wf.recommendRequest(coordB, logId, unit1.id), /not an assigned Laboratory Coordinator/);
    await rejects(wf.recommendRequest(toA, logId, unit1.id), /Only a Laboratory Coordinator/);
    await rejects(wf.recommendRequest(admin, logId, unit1.id), /Only a Laboratory Coordinator/);
  });

  const visibleToB = await wf.listVisibleLogs(coordB);
  await step('other-lab Coordinator cannot see the request', async () => {
    assert.equal(visibleToB.some((l) => l.id === logId), false);
  });

  const { id: logId2 } = await wf.createRequest(student2, req);
  let handoverCode = '';
  await step('recommend reserves the exact unit and returns a 6-digit code', async () => {
    const r = await wf.recommendRequest(coordA, logId, unit1.id);
    handoverCode = r.code;
    assert.match(r.code, /^\d{6}$/);
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit1.id } });
    assert.equal(effectiveAvailability(u), 'RESERVED');
    assert.equal(u.currentLogId, logId);
    const stored = await prisma.confirmationCode.findFirstOrThrow({ where: { logId } });
    assert.notEqual(stored.codeHash, handoverCode, 'plaintext code must not be stored');
  });

  await step('the same unit cannot be reserved for a second request', async () => {
    await rejects(wf.recommendRequest(coordA, logId2, unit1.id), /no longer available/);
    const pending = await prisma.borrowLog.findUniqueOrThrow({ where: { id: logId2 } });
    assert.equal(pending.status, 'PENDING', 'failed recommend must roll back');
  });

  await step('concurrent recommends of the last unit: exactly one wins', async () => {
    const { id: logId3 } = await wf.createRequest(await makeUser('student3', 'BORROWER'), req);
    const results = await Promise.allSettled([
      wf.recommendRequest(coordA, logId2, unit2.id),
      wf.recommendRequest(coordA, logId3, unit2.id),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const holders = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit2.id } });
    assert.equal(holders.status, 'RESERVED');
  });

  await step('borrower list never exposes codes', async () => {
    const mine = await wf.listVisibleLogs(student);
    assert.equal(JSON.stringify(mine).includes(handoverCode), false);
    assert.equal(JSON.stringify(mine).includes('codeHash'), false);
  });

  await step('TO of another lab cannot issue; wrong code counts attempts', async () => {
    await rejects(wf.issueWithCode(toB, logId, handoverCode), /not an assigned Technical Officer/);
    const wrong = handoverCode === '000000' ? '111111' : '000000';
    await rejects(wf.issueWithCode(toA, logId, wrong), /Incorrect code\. 4 attempt/);
  });

  await step('TO issues with the correct code; code cannot be replayed', async () => {
    await wf.issueWithCode(toA, logId, handoverCode, 'with leads');
    const log = await prisma.borrowLog.findUniqueOrThrow({ where: { id: logId } });
    assert.equal(log.status, 'ISSUED');
    assert.equal(log.issuedById, toA.userId);
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit1.id } });
    assert.equal(effectiveAvailability(u), 'ISSUED');
    await rejects(wf.issueWithCode(toA2, logId, handoverCode), /Only a recommended/);
  });

  await step('overdue keeps the unit Issued', async () => {
    await prisma.borrowLog.update({ where: { id: logId }, data: { returnDate: new Date(Date.now() - 60_000) } });
    await wf.runMaintenance();
    const log = await prisma.borrowLog.findUniqueOrThrow({ where: { id: logId } });
    assert.equal(log.status, 'OVERDUE');
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit1.id } });
    assert.equal(u.status, 'ISSUED');
  });

  let returnCode = '';
  await step('return: inspection -> code; cannot finalize before acknowledgement', async () => {
    returnCode = (await wf.startReturn(toA, logId, { condition: 'DAMAGED', notes: 'cracked display' })).code;
    await rejects(wf.finalizeReturn(toA, logId), /not acknowledged/);
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit1.id } });
    assert.equal(u.status, 'ISSUED', 'unit stays issued during a pending return');
  });

  await step('only the borrower can acknowledge; then TO finalizes; double finalize rejected', async () => {
    await rejects(wf.acknowledgeReturn(student2, logId, returnCode), /Only the borrower/);
    await wf.acknowledgeReturn(student, logId, returnCode);
    await wf.finalizeReturn(toA2, logId);
    const log = await prisma.borrowLog.findUniqueOrThrow({ where: { id: logId } });
    assert.equal(log.status, 'RETURNED');
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit1.id } });
    assert.equal(effectiveAvailability(u), 'UNAVAILABLE', 'damaged return makes the unit unavailable');
    assert.equal(u.currentLogId, null);
    await rejects(wf.finalizeReturn(toA, logId), /not currently active|Start the return/);
  });

  await step('borrower cancels a recommended request; reservation released', async () => {
    const reserved = await prisma.borrowLog.findFirstOrThrow({ where: { equipmentId: eq.id, status: 'APPROVED' } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: reserved.userId } });
    await rejects(wf.cancelRequest(student, reserved.id), /only cancel your own/);
    await wf.cancelRequest({ userId: owner.id, email: owner.email, name: owner.name, role: owner.role, twoFactorEnabled: false }, reserved.id, 'no longer needed');
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit2.id } });
    assert.equal(effectiveAvailability(u), 'AVAILABLE');
  });

  await step('reservation expiry releases the unit; TO cannot issue to self', async () => {
    const { id } = await wf.createRequest(toA, req);
    await assert.rejects(wf.recommendRequest(coordA, id, unit2.id).then(async (r) => {
      await wf.issueWithCode(toA, id, r.code);
    }), (e: unknown) => e instanceof ActionError && /cannot issue equipment to yourself/.test(e.message));
    await prisma.borrowLog.update({ where: { id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await wf.runMaintenance();
    const log = await prisma.borrowLog.findUniqueOrThrow({ where: { id } });
    assert.equal(log.status, 'EXPIRED');
    const u = await prisma.equipmentUnit.findUniqueOrThrow({ where: { id: unit2.id } });
    assert.equal(effectiveAvailability(u), 'AVAILABLE');
  });

  await step('code locks after 5 wrong attempts', async () => {
    const { id } = await wf.createRequest(await makeUser('student4', 'BORROWER'), req);
    const { code } = await wf.recommendRequest(coordA, id, unit2.id);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) await rejects(wf.issueWithCode(toA, id, wrong), /Incorrect code/);
    await rejects(wf.issueWithCode(toA, id, wrong), /now locked/);
    await rejects(wf.issueWithCode(toA, id, code), /no active handover code/);
    const { code: fresh } = await wf.regenerateHandoverCode(coordA, id);
    await wf.issueWithCode(toA, id, fresh);
  });

  await step('audit trail recorded the key events', async () => {
    const actions = new Set((await prisma.auditLog.findMany({ where: { entityId: logId } })).map((a) => a.action));
    for (const a of ['REQUEST_SUBMITTED', 'REQUEST_RECOMMENDED', 'HANDOVER_CODE_FAILED', 'LOAN_ISSUED', 'LOAN_OVERDUE', 'RETURN_INITIATED', 'RETURN_ACKNOWLEDGED', 'LOAN_RETURNED']) {
      assert.ok(actions.has(a), `missing audit ${a}`);
    }
  });

  console.log(`\n${passed} checks passed.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('\n✖ FAILED:', e);
  process.exit(1);
});
