import type { AssignmentRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ActionError } from '@/lib/errors';
import type { SessionUser } from '@/lib/auth';

// RBAC + lab scope:
//   the account role decides WHAT KIND of action a person may perform;
//   an active LabAssignment decides IN WHICH LAB they may perform it.

type Db = Prisma.TransactionClient | typeof prisma;

export function assignmentRoleFor(session: SessionUser): AssignmentRole | null {
  if (session.role === 'COORDINATOR') return 'COORDINATOR';
  if (session.role === 'TECHNICAL_OFFICER') return 'TECHNICAL_OFFICER';
  return null;
}

export async function getActiveLabIds(userId: string, role?: AssignmentRole, db: Db = prisma) {
  const rows = await db.labAssignment.findMany({
    where: { userId, unassignedAt: null, ...(role ? { role } : {}), lab: { archivedAt: null } },
    select: { labId: true },
  });
  return Array.from(new Set(rows.map((r) => r.labId)));
}

export async function isAssignedToLab(
  userId: string,
  labId: string,
  role: AssignmentRole,
  db: Db = prisma
) {
  const row = await db.labAssignment.findFirst({
    where: { userId, labId, role, unassignedAt: null },
    select: { id: true },
  });
  return Boolean(row);
}

// Throws unless the session holds `role` AND is actively assigned to `labId` in that role.
export async function requireLabRole(
  session: SessionUser,
  labId: string,
  role: AssignmentRole,
  db: Db = prisma
) {
  const label = role === 'COORDINATOR' ? 'Laboratory Coordinator' : 'Technical Officer';
  if (assignmentRoleFor(session) !== role) {
    throw new ActionError(`Only a ${label} can do this.`);
  }
  if (!(await isAssignedToLab(session.userId, labId, role, db))) {
    throw new ActionError(`You are not an assigned ${label} for this laboratory.`);
  }
}

// Labs whose inventory the session may manage: Super Admin = all; Coordinator / TO =
// labs they are actively assigned to. Returns null for "all labs".
export async function getManagedLabIds(session: SessionUser): Promise<string[] | null> {
  if (session.role === 'SUPER_ADMIN') return null;
  const role = assignmentRoleFor(session);
  if (!role) return [];
  return getActiveLabIds(session.userId, role);
}

export async function requireInventoryManager(session: SessionUser, labId: string) {
  const managed = await getManagedLabIds(session);
  if (managed === null) return;
  if (!managed.includes(labId)) {
    throw new ActionError('You can only manage inventory for laboratories you are assigned to.');
  }
}

export async function getLabStaffing(labId: string, db: Db = prisma) {
  const rows = await db.labAssignment.findMany({
    where: { labId, unassignedAt: null, user: { isActive: true } },
    select: { role: true, userId: true },
  });
  return {
    coordinatorIds: rows.filter((r) => r.role === 'COORDINATOR').map((r) => r.userId),
    technicalOfficerIds: rows.filter((r) => r.role === 'TECHNICAL_OFFICER').map((r) => r.userId),
  };
}

// An operational lab needs at least one active Coordinator and one active TO.
export async function requireLabOperational(labId: string, db: Db = prisma) {
  const lab = await db.lab.findUnique({ where: { id: labId }, select: { name: true, archivedAt: true } });
  if (!lab || lab.archivedAt) throw new ActionError('This laboratory is archived.');
  const staffing = await getLabStaffing(labId, db);
  if (staffing.coordinatorIds.length === 0 || staffing.technicalOfficerIds.length === 0) {
    throw new ActionError(
      `${lab.name} does not currently have both an assigned Coordinator and Technical Officer, so borrowing is paused. Please contact the department.`
    );
  }
  return staffing;
}
