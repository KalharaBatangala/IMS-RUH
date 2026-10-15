'use server';

import { prisma } from '@/lib/prisma';
import { Prisma, type AssignmentRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireSuperAdmin } from '@/lib/auth';
import { ActionError, optionalText, requireText, toActionError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';

// Lab records and Coordinator / Technical Officer assignments: Super Admin only.

function refresh() {
  revalidatePath('/dashboard/labs');
  revalidatePath('/dashboard/inventory');
  revalidatePath('/');
}

function friendlyUniqueError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ActionError('A laboratory with this name already exists.');
  }
  return error;
}

const ROLE_LABEL: Record<AssignmentRole, string> = {
  COORDINATOR: 'Coordinator',
  TECHNICAL_OFFICER: 'Technical Officer',
};

// 1. All labs (including archived) with active assignments and recent history
export async function getManageableLabs() {
  try {
    await requireSuperAdmin();
    const labs = await prisma.lab.findMany({
      include: {
        _count: { select: { equipment: true } },
        assignments: {
          include: {
            user: { select: { id: true, name: true, email: true, isActive: true } },
            assignedBy: { select: { name: true } },
            unassignedBy: { select: { name: true } },
          },
          orderBy: { assignedAt: 'desc' },
        },
      },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });

    const data = labs.map((lab) => {
      const active = lab.assignments.filter((a) => !a.unassignedAt);
      const history = lab.assignments.filter((a) => a.unassignedAt).slice(0, 10);
      const coordinators = active.filter((a) => a.role === 'COORDINATOR');
      const technicalOfficers = active.filter((a) => a.role === 'TECHNICAL_OFFICER');
      return {
        id: lab.id,
        name: lab.name,
        description: lab.description,
        archived: Boolean(lab.archivedAt),
        _count: lab._count,
        coordinators,
        technicalOfficers,
        history,
        staffingWarning:
          coordinators.length === 0 && technicalOfficers.length === 0
            ? 'No Coordinator or Technical Officer assigned — borrowing is paused.'
            : coordinators.length === 0
            ? 'No Coordinator assigned — borrowing is paused.'
            : technicalOfficers.length === 0
            ? 'No Technical Officer assigned — borrowing is paused.'
            : null,
      };
    });
    return { success: true as const, data };
  } catch (error) {
    return toActionError(error, 'Failed to load laboratories.');
  }
}

// 2. Staff who can be assigned (role must match the assignment kind)
export async function getAvailableStaff() {
  try {
    await requireSuperAdmin();
    const staff = await prisma.user.findMany({
      where: { role: { in: ['COORDINATOR', 'TECHNICAL_OFFICER'] }, isActive: true, isApproved: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    return { success: true as const, data: staff };
  } catch (error) {
    return toActionError(error, 'Failed to load staff.');
  }
}

// 3. Create / edit a lab
export async function createLab(name: string, description?: string) {
  try {
    const session = await requireSuperAdmin();
    const lab = await prisma.$transaction(async (tx) => {
      const created = await tx.lab.create({
        data: { name: requireText(name, 'Lab name', 150), description: optionalText(description, 'Description', 1000) },
      });
      await audit(tx, { actorId: session.userId, action: 'LAB_CREATED', entityType: 'Lab', entityId: created.id, labId: created.id, details: { name: created.name } });
      return created;
    });
    refresh();
    return { success: true as const, data: lab };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Failed to create laboratory.');
  }
}

export async function updateLab(labId: string, name: string, description?: string) {
  try {
    const session = await requireSuperAdmin();
    const before = await prisma.lab.findUnique({ where: { id: String(labId) } });
    if (!before) throw new ActionError('Laboratory not found.');
    const next = { name: requireText(name, 'Lab name', 150), description: optionalText(description, 'Description', 1000) };
    await prisma.$transaction(async (tx) => {
      await tx.lab.update({ where: { id: before.id }, data: next });
      await audit(tx, {
        actorId: session.userId,
        action: 'LAB_UPDATED',
        entityType: 'Lab',
        entityId: before.id,
        labId: before.id,
        details: { before: { name: before.name, description: before.description }, after: next },
      });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Failed to update laboratory.');
  }
}

// 4. Assign a Coordinator or Technical Officer to a lab
export async function assignStaff(labId: string, userId: string, role: AssignmentRole) {
  try {
    const session = await requireSuperAdmin();
    if (role !== 'COORDINATOR' && role !== 'TECHNICAL_OFFICER') throw new ActionError('Invalid assignment type.');

    const [lab, user] = await Promise.all([
      prisma.lab.findUnique({ where: { id: String(labId) } }),
      prisma.user.findUnique({ where: { id: String(userId) } }),
    ]);
    if (!lab) throw new ActionError('Laboratory not found.');
    if (lab.archivedAt) throw new ActionError('Restore this laboratory before assigning staff.');
    if (!user || !user.isActive || !user.isApproved) throw new ActionError('User not found or not active.');
    // One person cannot be both Coordinator and TO: the account role decides which.
    if (user.role !== role) {
      throw new ActionError(`${user.name} does not have the ${ROLE_LABEL[role]} role. Change their role on the Users page first.`);
    }

    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.labAssignment.findFirst({ where: { labId: lab.id, userId: user.id, unassignedAt: null } });
        if (existing) throw new ActionError(`${user.name} is already assigned to this laboratory.`);
        const created = await tx.labAssignment.create({
          data: { labId: lab.id, userId: user.id, role, assignedById: session.userId },
        });
        await audit(tx, { actorId: session.userId, action: 'LAB_STAFF_ASSIGNED', entityType: 'LabAssignment', entityId: created.id, labId: lab.id, details: { userId: user.id, role } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    await notify([user.id], {
      title: 'Laboratory assignment',
      body: `You have been assigned as ${ROLE_LABEL[role]} for ${lab.name}.`,
      link: '/dashboard/borrow',
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return { success: false as const, error: 'Another change happened at the same time. Please try again.' };
    }
    return toActionError(error, 'Failed to assign staff.');
  }
}

// 5. End an assignment (history is kept; the account is not affected)
export async function unassignStaff(assignmentId: string) {
  try {
    const session = await requireSuperAdmin();
    const assignment = await prisma.labAssignment.findUnique({
      where: { id: String(assignmentId) },
      include: { lab: { select: { name: true } }, user: { select: { name: true } } },
    });
    if (!assignment) throw new ActionError('Assignment not found.');

    await prisma.$transaction(async (tx) => {
      const res = await tx.labAssignment.updateMany({
        where: { id: assignment.id, unassignedAt: null },
        data: { unassignedAt: new Date(), unassignedById: session.userId },
      });
      if (res.count !== 1) throw new ActionError('This assignment has already ended.');
      await audit(tx, {
        actorId: session.userId,
        action: 'LAB_STAFF_UNASSIGNED',
        entityType: 'LabAssignment',
        entityId: assignment.id,
        labId: assignment.labId,
        details: { userId: assignment.userId, role: assignment.role },
      });
    });

    await notify([assignment.userId], {
      title: 'Laboratory assignment ended',
      body: `Your ${ROLE_LABEL[assignment.role]} assignment for ${assignment.lab.name} has ended.`,
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to remove assignment.');
  }
}

// 6. Archive / restore (preferred over deletion)
export async function setLabArchived(labId: string, archived: boolean) {
  try {
    const session = await requireSuperAdmin();
    const lab = await prisma.lab.findUnique({ where: { id: String(labId) } });
    if (!lab) throw new ActionError('Laboratory not found.');

    await prisma.$transaction(async (tx) => {
      if (archived) {
        const open = await tx.borrowLog.count({
          where: { equipment: { labId: lab.id }, status: { in: ['PENDING', 'APPROVED', 'ISSUED', 'OVERDUE'] } },
        });
        if (open > 0) throw new ActionError(`${lab.name} has ${open} open request(s) or loan(s). Resolve them before archiving.`);
      }
      await tx.lab.update({ where: { id: lab.id }, data: { archivedAt: archived ? new Date() : null } });
      await audit(tx, { actorId: session.userId, action: archived ? 'LAB_ARCHIVED' : 'LAB_RESTORED', entityType: 'Lab', entityId: lab.id, labId: lab.id });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update laboratory.');
  }
}

// 7. Hard delete only for a lab that was never used (no equipment, no assignment history)
export async function deleteLab(labId: string) {
  try {
    const session = await requireSuperAdmin();
    const lab = await prisma.lab.findUnique({
      where: { id: String(labId) },
      include: { _count: { select: { equipment: true, assignments: true } } },
    });
    if (!lab) throw new ActionError('Laboratory not found.');
    if (lab._count.equipment > 0 || lab._count.assignments > 0) {
      throw new ActionError('This laboratory has equipment or assignment history. Archive it instead of deleting it.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.lab.delete({ where: { id: lab.id } });
      await audit(tx, { actorId: session.userId, action: 'LAB_DELETED', entityType: 'Lab', entityId: lab.id, details: { name: lab.name } });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to delete laboratory.');
  }
}
