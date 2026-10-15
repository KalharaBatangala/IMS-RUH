'use server';

import { prisma } from '@/lib/prisma';
import { Prisma, type AssetStatus, type ItemCondition } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { ActionError, optionalText, requireText, toActionError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { effectiveAvailability, isFitForUse, type Availability } from '@/lib/availability';
import { getLabStaffing, getManagedLabIds, requireInventoryManager } from '@/lib/authz';
import { cancelReservationForUnfitUnit } from '@/lib/borrow-workflow';
import {
  normalizeSerial,
  parseAssetStatus,
  parseCondition,
  parseFlexibleDate,
  type ImportRow,
} from '@/lib/inventory-import';

const CONDITIONS: ItemCondition[] = ['WORKING', 'DAMAGED', 'UNDER_REPAIR'];
const ASSET_STATUSES: AssetStatus[] = ['RECEIVED', 'NOT_RECEIVED'];
const MAX_UNITS_PER_ADD = 200;
const MAX_IMPORT_ROWS = 1000;

type Tx = Prisma.TransactionClient;

function refresh() {
  revalidatePath('/dashboard/inventory');
  revalidatePath('/dashboard/borrow');
  revalidatePath('/');
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameText(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

// 'YYYY-MM-DD' (from a date input) -> Date at local midnight; '' / null -> null.
function parseDateInput(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFlexibleDate(String(value));
  if (parsed === 'invalid' || parsed === null) throw new ActionError(`${field} is not a valid date.`);
  const [y, m, d] = parsed.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Generated asset tags for units without a manufacturer serial, e.g. "MULTIM-1A2B-3".
// They are flagged serialIsPlaceholder so nobody mistakes them for real serials; staff can
// label the physical item with this tag or replace it with the real serial later.
async function placeholderSerials(tx: Tx, name: string, equipmentId: string, count: number) {
  if (count <= 0) return [];
  const prefix = (name.match(/[a-zA-Z0-9]/g)?.join('').slice(0, 6) || 'UNIT').toUpperCase();
  const base = `${prefix}-${equipmentId.slice(0, 4).toUpperCase()}-`;
  const existing = await tx.equipmentUnit.findMany({ where: { serialNumber: { startsWith: base } }, select: { serialNumber: true } });
  const taken = new Set(existing.map((u) => u.serialNumber));
  const serials: string[] = [];
  for (let i = 1; serials.length < count; i++) {
    if (!taken.has(base + i)) serials.push(base + i);
  }
  return serials;
}

function parseSerials(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  const serials = input
    .split(/[\n,]+/)
    .map((s) => normalizeSerial(s))
    .filter((s): s is string => Boolean(s));
  if (serials.some((s) => s.length > 100)) throw new ActionError('Serial numbers must be at most 100 characters.');
  if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) throw new ActionError('Duplicate serial numbers in the list.');
  return serials;
}

// Serials are unique ignoring letter case ("ABC-1" and "abc-1" are the same label).
async function assertSerialsFree(db: Tx | typeof prisma, serials: string[], exceptUnitId?: string) {
  if (serials.length === 0) return;
  const clash = await db.equipmentUnit.findMany({
    where: { serialNumber: { in: serials, mode: 'insensitive' }, ...(exceptUnitId ? { id: { not: exceptUnitId } } : {}) },
    select: { serialNumber: true, equipment: { select: { name: true, lab: { select: { name: true } } } } },
    take: 5,
  });
  if (clash.length > 0) {
    const list = clash.map((c) => `${c.serialNumber} (${c.equipment.name}, ${c.equipment.lab.name})`).join('; ');
    throw new ActionError(`Serial number already registered: ${list}`);
  }
}

function parseQuantity(value: unknown, serialCount: number) {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_UNITS_PER_ADD) {
    throw new ActionError(`Quantity must be between 1 and ${MAX_UNITS_PER_ADD}.`);
  }
  if (serialCount > quantity) throw new ActionError('More serial numbers were entered than the quantity.');
  return quantity;
}

function friendlyUniqueError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ActionError('That serial number is already in use.');
  }
  return error;
}

interface UnitDetails {
  condition?: ItemCondition;
  assetStatus?: AssetStatus;
  location?: string | null;
  purchasedAt?: Date | null;
  lastCheckedAt?: Date | null;
  notes?: string | null;
}

function parseUnitDetails(input: {
  condition?: unknown;
  assetStatus?: unknown;
  location?: unknown;
  purchasedAt?: unknown;
  notes?: unknown;
}): UnitDetails {
  const condition = (input.condition || 'WORKING') as ItemCondition;
  const assetStatus = (input.assetStatus || 'RECEIVED') as AssetStatus;
  if (!CONDITIONS.includes(condition)) throw new ActionError('Invalid condition.');
  if (!ASSET_STATUSES.includes(assetStatus)) throw new ActionError('Invalid asset status.');
  return {
    condition,
    assetStatus,
    location: optionalText(input.location, 'Location', 200),
    purchasedAt: parseDateInput(input.purchasedAt, 'Purchase date'),
    notes: optionalText(input.notes, 'Unit remark', 500),
  };
}

async function createUnits(tx: Tx, equipment: { id: string; name: string }, quantity: number, serials: string[], details: UnitDetails = {}) {
  const generated = await placeholderSerials(tx, equipment.name, equipment.id, quantity - serials.length);
  await tx.equipmentUnit.createMany({
    data: [
      ...serials.map((serialNumber) => ({ serialNumber, serialIsPlaceholder: false })),
      ...generated.map((serialNumber) => ({ serialNumber, serialIsPlaceholder: true })),
    ].map((s) => ({ equipmentId: equipment.id, ...s, ...details })),
  });
  return { entered: serials.length, generated: generated.length };
}

// -------------------------------------------------------------
// 1. Inventory list (one row per equipment type)
// -------------------------------------------------------------
// Borrower view: every active type; types with no AVAILABLE unit (or in a lab whose
// borrowing is paused) are returned with requestable=false and shown dimmed.
// Staff view: everything in the labs they manage (Super Admin: all labs), with counts
// for all four availability states. Search matches name, brand, model, serial number
// and unit location; serial/location matches are listed for staff.
export async function getEquipment(query?: string, labId?: string, includeArchived = false) {
  try {
    const session = await requireSession();
    const managed = await getManagedLabIds(session);
    const canManageLab = (id: string) => managed === null || managed.includes(id);

    const q = typeof query === 'string' ? query.trim().slice(0, 100) : '';
    const contains = { contains: q, mode: 'insensitive' as const };
    const equipment = await prisma.equipment.findMany({
      where: {
        lab: { archivedAt: null },
        ...(labId ? { labId } : {}),
        ...(q
          ? {
              OR: [
                { name: contains },
                { brand: contains },
                { model: contains },
                { remarks: contains },
                // Unit-level search (serial / location) is for inventory staff only.
                ...(managed === null || managed.length > 0
                  ? [{ units: { some: { OR: [{ serialNumber: contains }, { location: contains }] } } }]
                  : []),
              ],
            }
          : {}),
      },
      include: {
        lab: { select: { id: true, name: true } },
        units: {
          select: { serialNumber: true, location: true, status: true, condition: true, assetStatus: true, archivedAt: true, serialIsPlaceholder: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const labIds = Array.from(new Set(equipment.map((e) => e.labId)));
    const staffing = new Map(await Promise.all(labIds.map(async (id) => [id, await getLabStaffing(id)] as const)));
    const needle = q.toLowerCase();

    const data = equipment
      .map((eq) => {
        const canManage = canManageLab(eq.labId);
        const live = eq.units.filter((u) => !u.archivedAt);
        const counts: Record<Availability, number> = { AVAILABLE: 0, RESERVED: 0, ISSUED: 0, UNAVAILABLE: 0 };
        for (const u of live) counts[effectiveAvailability(u)]++;
        const s = staffing.get(eq.labId);
        const labOperational = Boolean(s && s.coordinatorIds.length > 0 && s.technicalOfficerIds.length > 0);
        const unitMatches =
          canManage && needle
            ? eq.units
                .filter((u) => u.serialNumber.toLowerCase().includes(needle) || (u.location ?? '').toLowerCase().includes(needle))
                .map((u) => u.serialNumber)
            : [];
        return {
          id: eq.id,
          name: eq.name,
          brand: eq.brand,
          model: eq.model,
          remarks: eq.remarks,
          lab: eq.lab,
          archived: Boolean(eq.archivedAt),
          totalUnits: live.length,
          availableUnits: counts.AVAILABLE,
          counts: canManage ? counts : null,
          placeholderSerials: canManage ? live.filter((u) => u.serialIsPlaceholder).length : 0,
          unitMatches,
          canManage,
          labOperational,
          requestable: !eq.archivedAt && labOperational && counts.AVAILABLE > 0,
        };
      })
      // Archived types are hidden from everyone except managers who ask for them. Borrowers
      // see every active type; ones with nothing to lend are shown but not requestable.
      .filter((eq) => (eq.canManage ? includeArchived || !eq.archived : !eq.archived));

    return { success: true as const, data, managesAnyLab: managed === null || managed.length > 0 };
  } catch (error) {
    return toActionError(error, 'Could not fetch equipment items.');
  }
}

// -------------------------------------------------------------
// 2. Units of one equipment type (staff of that lab / Super Admin only)
// -------------------------------------------------------------
export async function getEquipmentUnits(equipmentId: string) {
  try {
    const session = await requireSession();
    const equipment = await prisma.equipment.findUnique({ where: { id: String(equipmentId) }, select: { labId: true } });
    if (!equipment) throw new ActionError('Equipment not found.');
    await requireInventoryManager(session, equipment.labId);

    const units = await prisma.equipmentUnit.findMany({
      where: { equipmentId },
      include: { currentLog: { select: { status: true, returnDate: true, user: { select: { name: true } } } } },
      orderBy: { serialNumber: 'asc' },
    });
    return {
      success: true as const,
      data: units.map((u) => ({
        id: u.id,
        serialNumber: u.serialNumber,
        serialIsPlaceholder: u.serialIsPlaceholder,
        status: u.status,
        condition: u.condition,
        assetStatus: u.assetStatus,
        unavailableReason: u.unavailableReason,
        notes: u.notes,
        location: u.location,
        purchasedAt: u.purchasedAt,
        lastCheckedAt: u.lastCheckedAt,
        archived: Boolean(u.archivedAt),
        availability: effectiveAvailability(u),
        holder: u.currentLog ? { name: u.currentLog.user.name, status: u.currentLog.status, returnDate: u.currentLog.returnDate } : null,
      })),
    };
  } catch (error) {
    return toActionError(error, 'Could not fetch equipment units.');
  }
}

// -------------------------------------------------------------
// 3. Laboratories (for filters / dropdowns / overview)
// -------------------------------------------------------------
export async function getLabs() {
  try {
    const session = await requireSession();
    const managed = await getManagedLabIds(session);
    const labs = await prisma.lab.findMany({
      where: { archivedAt: null },
      include: {
        _count: { select: { equipment: { where: { archivedAt: null } } } },
        assignments: {
          where: { unassignedAt: null, user: { isActive: true } },
          select: { role: true, user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const data = labs.map((lab) => {
      const coordinators = lab.assignments.filter((a) => a.role === 'COORDINATOR').map((a) => a.user);
      const technicalOfficers = lab.assignments.filter((a) => a.role === 'TECHNICAL_OFFICER').map((a) => a.user);
      return {
        id: lab.id,
        name: lab.name,
        description: lab.description,
        _count: lab._count,
        coordinators,
        technicalOfficers,
        operational: coordinators.length > 0 && technicalOfficers.length > 0,
        canManage: managed === null || managed.includes(lab.id),
      };
    });
    return { success: true as const, data };
  } catch (error) {
    return toActionError(error, 'Could not fetch laboratory list.');
  }
}

// Equipment types of one lab (for "move unit to another type").
export async function getLabEquipmentTypes(labId: string) {
  try {
    const session = await requireSession();
    await requireInventoryManager(session, String(labId));
    const types = await prisma.equipment.findMany({
      where: { labId: String(labId), archivedAt: null },
      select: { id: true, name: true, brand: true, model: true },
      orderBy: { name: 'asc' },
    });
    return { success: true as const, data: types };
  } catch (error) {
    return toActionError(error, 'Could not load equipment types.');
  }
}

// -------------------------------------------------------------
// 4. Create equipment type (merges into an existing type with the same name in that lab)
// -------------------------------------------------------------
export async function createEquipment(formData: {
  name: string;
  quantity: number;
  brand?: string;
  model?: string;
  remarks?: string;
  labId: string;
  serialNumbers?: string;
  condition?: ItemCondition;
  assetStatus?: AssetStatus;
  location?: string;
  purchasedAt?: string;
  unitNotes?: string;
}) {
  try {
    const session = await requireSession();
    const labId = String(formData.labId ?? '');
    await requireInventoryManager(session, labId);
    const lab = await prisma.lab.findUnique({ where: { id: labId }, select: { archivedAt: true } });
    if (!lab || lab.archivedAt) throw new ActionError('Please choose an active laboratory.');

    const name = requireText(formData.name, 'Equipment name', 200).replace(/\s+/g, ' ');
    const brand = optionalText(formData.brand, 'Brand', 100);
    const model = optionalText(formData.model, 'Model', 100);
    const serials = parseSerials(formData.serialNumbers);
    const quantity = parseQuantity(formData.quantity, serials.length);
    const details = parseUnitDetails({ ...formData, notes: formData.unitNotes });

    const result = await prisma.$transaction(async (tx) => {
      await assertSerialsFree(tx, serials);
      const candidates = await tx.equipment.findMany({ where: { labId, archivedAt: null } });
      const match = candidates.find((eq) => normalizeName(eq.name) === normalizeName(name));
      if (match) {
        // Same name = same catalogue item. Refuse rather than silently dropping a different brand/model.
        const brandClash = brand && match.brand && !sameText(brand, match.brand);
        const modelClash = model && match.model && !sameText(model, match.model);
        if (brandClash || modelClash) {
          throw new ActionError(
            `"${match.name}" already exists in this lab as ${match.brand ?? '-'} / ${match.model ?? '-'}. ` +
              `If this is a different item, give it a distinct name (e.g. "${name} (${brand ?? model})"); ` +
              `if the existing brand/model is wrong, correct it with Edit first.`
          );
        }
      }
      const target =
        match ??
        (await tx.equipment.create({
          data: { name, brand, model, remarks: optionalText(formData.remarks, 'Remarks', 500), labId },
        }));
      const units = await createUnits(tx, target, quantity, serials, details);
      await audit(tx, {
        actorId: session.userId,
        action: match ? 'UNITS_ADDED' : 'EQUIPMENT_CREATED',
        entityType: 'Equipment',
        entityId: target.id,
        labId,
        details: { quantity, ...units },
      });
      return { target, merged: Boolean(match), units };
    });

    refresh();
    const placeholderNote = result.units.generated > 0 ? ` ${result.units.generated} unit(s) without a serial got a generated asset tag.` : '';
    return {
      success: true as const,
      data: { id: result.target.id },
      merged: result.merged,
      message:
        (result.merged
          ? `${quantity} unit(s) added to the existing "${result.target.name}" entry.`
          : `"${result.target.name}" added with ${quantity} unit(s).`) + placeholderNote,
    };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Failed to add equipment item.');
  }
}

export async function addUnitsToEquipment(
  equipmentId: string,
  quantityInput: number,
  serialNumbers?: string,
  unitDetails: { condition?: ItemCondition; assetStatus?: AssetStatus; location?: string; purchasedAt?: string; notes?: string } = {}
) {
  try {
    const session = await requireSession();
    const equipment = await prisma.equipment.findUnique({ where: { id: String(equipmentId) } });
    if (!equipment) throw new ActionError('Equipment type not found.');
    if (equipment.archivedAt) throw new ActionError('Restore this equipment type before adding units.');
    await requireInventoryManager(session, equipment.labId);
    const serials = parseSerials(serialNumbers);
    const quantity = parseQuantity(quantityInput, serials.length);
    const details = parseUnitDetails(unitDetails);

    await prisma.$transaction(async (tx) => {
      await assertSerialsFree(tx, serials);
      const units = await createUnits(tx, equipment, quantity, serials, details);
      await audit(tx, { actorId: session.userId, action: 'UNITS_ADDED', entityType: 'Equipment', entityId: equipment.id, labId: equipment.labId, details: { quantity, ...units } });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Failed to add units.');
  }
}

export async function updateEquipmentDetails(
  equipmentId: string,
  data: { name: string; brand?: string; model?: string; remarks?: string }
) {
  try {
    const session = await requireSession();
    const equipment = await prisma.equipment.findUnique({ where: { id: String(equipmentId) } });
    if (!equipment) throw new ActionError('Equipment type not found.');
    await requireInventoryManager(session, equipment.labId);
    const next = {
      name: requireText(data.name, 'Equipment name', 200).replace(/\s+/g, ' '),
      brand: optionalText(data.brand, 'Brand', 100),
      model: optionalText(data.model, 'Model', 100),
      remarks: optionalText(data.remarks, 'Remarks', 500),
    };
    await prisma.$transaction(async (tx) => {
      if (normalizeName(next.name) !== normalizeName(equipment.name)) {
        const clash = await tx.equipment.findMany({ where: { labId: equipment.labId, archivedAt: null, id: { not: equipment.id } }, select: { name: true } });
        if (clash.some((c) => normalizeName(c.name) === normalizeName(next.name))) {
          throw new ActionError(`Another equipment type named "${next.name}" already exists in this lab.`);
        }
      }
      await tx.equipment.update({ where: { id: equipment.id }, data: next });
      await audit(tx, {
        actorId: session.userId,
        action: 'EQUIPMENT_UPDATED',
        entityType: 'Equipment',
        entityId: equipment.id,
        labId: equipment.labId,
        details: { before: { name: equipment.name, brand: equipment.brand, model: equipment.model, remarks: equipment.remarks }, after: next },
      });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update equipment.');
  }
}

// Archive instead of delete: history keeps pointing at the type.
export async function setEquipmentArchived(equipmentId: string, archived: boolean) {
  try {
    const session = await requireSession();
    const equipment = await prisma.equipment.findUnique({ where: { id: String(equipmentId) } });
    if (!equipment) throw new ActionError('Equipment type not found.');
    await requireInventoryManager(session, equipment.labId);

    await prisma.$transaction(async (tx) => {
      if (archived) {
        const open = await tx.borrowLog.count({
          where: { equipmentId: equipment.id, status: { in: ['PENDING', 'APPROVED', 'ISSUED', 'OVERDUE'] } },
        });
        if (open > 0) throw new ActionError(`This type has ${open} open request(s) or loan(s). Resolve them before archiving.`);
      }
      await tx.equipment.update({ where: { id: equipment.id }, data: { archivedAt: archived ? new Date() : null } });
      await audit(tx, { actorId: session.userId, action: archived ? 'EQUIPMENT_ARCHIVED' : 'EQUIPMENT_RESTORED', entityType: 'Equipment', entityId: equipment.id, labId: equipment.labId });
    });
    refresh();
    return { success: true as const };
  } catch (error) {
    return toActionError(error, 'Failed to update equipment.');
  }
}

// -------------------------------------------------------------
// 5. Edit a physical unit: serial, condition, asset status, location, dates, remarks,
//    archive, or move it to the correct equipment type (data-entry corrections).
//    Allocation status (AVAILABLE/RESERVED/ISSUED) is deliberately NOT editable here;
//    only the borrow workflow changes it.
// -------------------------------------------------------------
export async function updateEquipmentUnit(
  unitId: string,
  data: {
    condition?: ItemCondition;
    assetStatus?: AssetStatus;
    unavailableReason?: string | null;
    notes?: string | null;
    location?: string | null;
    purchasedAt?: string | null;
    lastCheckedAt?: string | null;
    markCheckedToday?: boolean;
    serialNumber?: string;
    archived?: boolean;
    moveToEquipmentId?: string;
  }
) {
  try {
    const session = await requireSession();
    const unit = await prisma.equipmentUnit.findUnique({
      where: { id: String(unitId) },
      include: { equipment: { select: { labId: true, name: true } } },
    });
    if (!unit) throw new ActionError('Unit not found.');
    await requireInventoryManager(session, unit.equipment.labId);

    if (data.condition !== undefined && !CONDITIONS.includes(data.condition)) throw new ActionError('Invalid condition.');
    if (data.assetStatus !== undefined && !ASSET_STATUSES.includes(data.assetStatus)) throw new ActionError('Invalid asset status.');

    const changesFitness =
      (data.condition !== undefined && data.condition !== unit.condition) ||
      (data.assetStatus !== undefined && data.assetStatus !== unit.assetStatus) ||
      (data.archived !== undefined && data.archived !== Boolean(unit.archivedAt));
    if (unit.status === 'ISSUED' && changesFitness) {
      throw new ActionError('This unit is on loan. Its condition is recorded by the Technical Officer when it is returned.');
    }

    let moveTarget: { id: string; name: string } | null = null;
    if (data.moveToEquipmentId && data.moveToEquipmentId !== unit.equipmentId) {
      if (unit.status !== 'AVAILABLE' || unit.currentLogId) {
        throw new ActionError('A reserved or issued unit cannot be moved to another type until it is back in stock.');
      }
      const target = await prisma.equipment.findUnique({ where: { id: String(data.moveToEquipmentId) } });
      if (!target || target.archivedAt || target.labId !== unit.equipment.labId) {
        throw new ActionError('Choose an active equipment type in the same laboratory.');
      }
      moveTarget = { id: target.id, name: target.name };
    }

    const next = {
      condition: data.condition ?? unit.condition,
      assetStatus: data.assetStatus ?? unit.assetStatus,
      archivedAt: data.archived === undefined ? unit.archivedAt : data.archived ? unit.archivedAt ?? new Date() : null,
    };
    const update: Prisma.EquipmentUnitUncheckedUpdateManyInput = {
      condition: next.condition,
      assetStatus: next.assetStatus,
      archivedAt: next.archivedAt,
    };
    let newSerial: string | null = null;
    if (data.serialNumber !== undefined) {
      newSerial = normalizeSerial(data.serialNumber);
      if (!newSerial) throw new ActionError('Serial number is required (keep the generated tag if the item has none).');
      if (newSerial.length > 100) throw new ActionError('Serial numbers must be at most 100 characters.');
      if (newSerial !== unit.serialNumber) {
        update.serialNumber = newSerial;
        update.serialIsPlaceholder = false; // a typed serial is treated as the real one
      }
    }
    if (data.unavailableReason !== undefined) update.unavailableReason = optionalText(data.unavailableReason, 'Reason', 500);
    if (isFitForUse(next) && data.unavailableReason === undefined) update.unavailableReason = null;
    if (data.notes !== undefined) update.notes = optionalText(data.notes, 'Remark', 500);
    if (data.location !== undefined) update.location = optionalText(data.location, 'Location', 200);
    if (data.purchasedAt !== undefined) update.purchasedAt = parseDateInput(data.purchasedAt, 'Purchase date');
    if (data.lastCheckedAt !== undefined) update.lastCheckedAt = parseDateInput(data.lastCheckedAt, 'Last checked date');
    if (data.markCheckedToday) update.lastCheckedAt = new Date();
    if (moveTarget) update.equipmentId = moveTarget.id;

    const cancelled = await prisma.$transaction(async (tx) => {
      if (update.serialNumber) await assertSerialsFree(tx, [newSerial!], unit.id);
      let cancelledReservation = null;
      if (unit.status === 'RESERVED' && !isFitForUse(next)) {
        const why = next.archivedAt ? 'unit archived' : `${next.condition}${next.assetStatus === 'NOT_RECEIVED' ? ', NOT_RECEIVED' : ''}`;
        cancelledReservation = await cancelReservationForUnfitUnit(tx, session, unit.id, why);
      }
      // Conditional on the allocation state we based this decision on (guards against a
      // concurrent issue / reservation of the same unit).
      const expectedStatus = cancelledReservation ? 'AVAILABLE' : unit.status;
      const res = await tx.equipmentUnit.updateMany({ where: { id: unit.id, status: expectedStatus }, data: update });
      if (res.count !== 1) throw new ActionError('This unit changed while you were editing it. Please refresh and try again.');
      await audit(tx, {
        actorId: session.userId,
        action: moveTarget ? 'UNIT_MOVED' : data.markCheckedToday && Object.keys(data).length === 1 ? 'UNIT_CHECKED' : 'UNIT_UPDATED',
        entityType: 'EquipmentUnit',
        entityId: unit.id,
        labId: unit.equipment.labId,
        details: {
          serialNumber: unit.serialNumber,
          before: {
            serialNumber: unit.serialNumber,
            equipment: unit.equipment.name,
            condition: unit.condition,
            assetStatus: unit.assetStatus,
            archived: Boolean(unit.archivedAt),
            unavailableReason: unit.unavailableReason,
            notes: unit.notes,
            location: unit.location,
          },
          changed: JSON.parse(JSON.stringify({ ...update, equipmentId: undefined, equipment: moveTarget?.name })),
        },
      });
      return cancelledReservation;
    });

    if (cancelled) {
      const staffing = await getLabStaffing(cancelled.labId);
      await notify([cancelled.borrowerId, ...staffing.coordinatorIds, ...staffing.technicalOfficerIds], {
        title: 'Reservation cancelled',
        body: `The reservation for "${cancelled.equipmentName}" was cancelled. ${cancelled.reason}. The borrower may submit a new request.`,
        link: '/dashboard/borrow',
      });
    }
    refresh();
    return {
      success: true as const,
      message: cancelled
        ? 'Unit updated. Its reservation was cancelled and the borrower notified.'
        : moveTarget
        ? `Unit moved to "${moveTarget.name}".`
        : undefined,
    };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Failed to update unit.');
  }
}

// -------------------------------------------------------------
// 6. Spreadsheet import (CSV saved from Excel / Google Sheets)
//    Call with commit=false for a preview; nothing is written unless every row is valid.
// -------------------------------------------------------------
export async function importEquipment(input: { labId: string; rows: ImportRow[]; commit: boolean }) {
  try {
    const session = await requireSession();
    const labId = String(input.labId ?? '');
    await requireInventoryManager(session, labId);
    const lab = await prisma.lab.findUnique({ where: { id: labId }, select: { name: true, archivedAt: true } });
    if (!lab || lab.archivedAt) throw new ActionError('Please choose an active laboratory.');
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length === 0) throw new ActionError('The file has no equipment rows.');
    if (rows.length > MAX_IMPORT_ROWS) throw new ActionError(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

    const existingTypes = await prisma.equipment.findMany({ where: { labId, archivedAt: null } });
    const typeByName = new Map(existingTypes.map((t) => [normalizeName(t.name), t]));

    const serialsInFile = rows.map((r) => normalizeSerial(String(r.serial ?? ''))).filter((s): s is string => Boolean(s));
    const existingSerials = serialsInFile.length
      ? await prisma.equipmentUnit.findMany({
          where: { serialNumber: { in: serialsInFile, mode: 'insensitive' } },
          select: { serialNumber: true, equipment: { select: { name: true, lab: { select: { name: true } } } } },
        })
      : [];
    const takenSerial = new Map(existingSerials.map((u) => [u.serialNumber.toLowerCase(), u]));

    const seenSerial = new Map<string, number>();
    const groupBrandModel = new Map<string, { brand: string | null; model: string | null; line: number }>();

    const checked = rows.map((raw) => {
      const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as ImportRow;
      const errors: string[] = [];
      const warnings: string[] = [];
      const name = (r.name || '').replace(/\s+/g, ' ');
      if (!name) errors.push('Item name is missing.');
      if (name.length > 200) errors.push('Item name is too long.');

      const serial = normalizeSerial(r.serial || '');
      if (serial) {
        if (serial.length > 100) errors.push('Serial number is too long.');
        const key = serial.toLowerCase();
        if (seenSerial.has(key)) errors.push(`Serial ${serial} is repeated (also on row ${seenSerial.get(key)}).`);
        else seenSerial.set(key, r.line);
        const taken = takenSerial.get(key);
        if (taken) errors.push(`Serial ${serial} is already registered (${taken.equipment.name}, ${taken.equipment.lab.name}).`);
      } else {
        warnings.push(r.serial ? `No usable serial ("${r.serial}") — an asset tag will be generated.` : 'No serial — an asset tag will be generated.');
      }

      const status = parseAssetStatus(r.status || '');
      if (!status) errors.push(`Unknown status "${r.status}" (use Received / Not Received).`);
      const condition = parseCondition(r.condition || '');
      if (!condition) errors.push(`Unknown condition "${r.condition}" (use Working / Damaged / Under repair).`);
      const purchased = parseFlexibleDate(r.purchased || '');
      if (purchased === 'invalid') errors.push(`Date of purchase "${r.purchased}" is not a date.`);
      const lastChecked = parseFlexibleDate(r.lastChecked || '');
      if (lastChecked === 'invalid') errors.push(`Last checked "${r.lastChecked}" is not a date.`);
      for (const [field, max] of [['brand', 100], ['model', 100], ['location', 200], ['remarks', 500]] as const) {
        if ((r[field] || '').length > max) errors.push(`${field} is too long (max ${max}).`);
      }

      const brand = r.brand || null;
      const model = r.model || null;
      const key = normalizeName(name);
      const existing = typeByName.get(key);
      if (existing) {
        if ((brand && existing.brand && !sameText(brand, existing.brand)) || (model && existing.model && !sameText(model, existing.model))) {
          errors.push(`"${existing.name}" already exists here as ${existing.brand ?? '-'} / ${existing.model ?? '-'}; this row says ${brand ?? '-'} / ${model ?? '-'}. Use a distinct item name or fix the existing type.`);
        }
      } else if (name) {
        const first = groupBrandModel.get(key);
        if (!first) groupBrandModel.set(key, { brand, model, line: r.line });
        else if ((brand && first.brand && !sameText(brand, first.brand)) || (model && first.model && !sameText(model, first.model))) {
          errors.push(`Same item name as row ${first.line} but a different brand/model. Use a distinct item name.`);
        } else {
          first.brand ??= brand;
          first.model ??= model;
        }
      }
      if (status?.value === 'NOT_RECEIVED') warnings.push('Not received — will be Unavailable until marked Received.');

      const notes = [status?.remark, r.remarks].filter(Boolean).join('; ') || null;
      return {
        line: r.line,
        name,
        serial,
        brand,
        model,
        typeAction: existing ? ('ADD_TO_EXISTING' as const) : ('NEW_TYPE' as const),
        typeName: existing?.name ?? name,
        errors,
        warnings,
        unit: {
          assetStatus: status?.value ?? 'RECEIVED',
          condition: condition ?? 'WORKING',
          location: r.location || null,
          purchasedAt: purchased && purchased !== 'invalid' ? purchased : null,
          lastCheckedAt: lastChecked && lastChecked !== 'invalid' ? lastChecked : null,
          notes,
        },
      };
    });

    const errorCount = checked.filter((c) => c.errors.length > 0).length;
    const summary = {
      rows: checked.length,
      errorRows: errorCount,
      newTypes: new Set(checked.filter((c) => c.typeAction === 'NEW_TYPE' && c.name).map((c) => normalizeName(c.name))).size,
      existingTypes: new Set(checked.filter((c) => c.typeAction === 'ADD_TO_EXISTING').map((c) => normalizeName(c.name))).size,
      generatedTags: checked.filter((c) => !c.serial).length,
    };
    const preview = checked.map(({ unit, ...rest }) => ({ ...rest, location: unit.location, condition: unit.condition, assetStatus: unit.assetStatus }));

    if (!input.commit) return { success: true as const, data: { committed: false, summary, rows: preview } };
    if (errorCount > 0) throw new ActionError(`Fix the ${errorCount} row(s) with errors before importing.`);

    const toDate = (ymd: string | null) => {
      if (!ymd) return null;
      const [y, m, d] = ymd.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    await prisma.$transaction(
      async (tx) => {
        await assertSerialsFree(tx, checked.map((c) => c.serial).filter((s): s is string => Boolean(s)));
        const typeIds = new Map<string, { id: string; name: string }>();
        for (const c of checked) {
          const key = normalizeName(c.name);
          if (typeIds.has(key)) continue;
          const existing = typeByName.get(key);
          if (existing) {
            typeIds.set(key, existing);
          } else {
            const group = groupBrandModel.get(key);
            const created = await tx.equipment.create({ data: { name: c.name, brand: group?.brand ?? null, model: group?.model ?? null, labId } });
            typeIds.set(key, created);
          }
        }
        for (const [key, type] of typeIds) {
          const group = checked.filter((c) => normalizeName(c.name) === key);
          const withoutSerial = group.filter((c) => !c.serial);
          const tags = await placeholderSerials(tx, type.name, type.id, withoutSerial.length);
          await tx.equipmentUnit.createMany({
            data: group.map((c) => {
              const serialNumber = c.serial ?? tags[withoutSerial.indexOf(c)];
              return {
                equipmentId: type.id,
                serialNumber,
                serialIsPlaceholder: !c.serial,
                assetStatus: c.unit.assetStatus,
                condition: c.unit.condition,
                location: c.unit.location,
                purchasedAt: toDate(c.unit.purchasedAt),
                lastCheckedAt: toDate(c.unit.lastCheckedAt),
                notes: c.unit.notes,
              };
            }),
          });
        }
        await audit(tx, {
          actorId: session.userId,
          action: 'EQUIPMENT_IMPORTED',
          entityType: 'Lab',
          entityId: labId,
          labId,
          details: summary,
        });
      },
      { timeout: 60_000 }
    );

    refresh();
    return { success: true as const, data: { committed: true, summary, rows: preview } };
  } catch (error) {
    return toActionError(friendlyUniqueError(error), 'Import failed.');
  }
}

// -------------------------------------------------------------
// 7. Export (one row per physical unit) for reports / stock checks
// -------------------------------------------------------------
export async function exportInventory(labId?: string) {
  try {
    const session = await requireSession();
    const managed = await getManagedLabIds(session);
    if (managed !== null && managed.length === 0) throw new ActionError('You do not manage any laboratory.');
    if (labId && managed !== null && !managed.includes(labId)) throw new ActionError('You can only export laboratories you manage.');
    const labFilter = labId ? { labId } : managed === null ? {} : { labId: { in: managed } };

    const units = await prisma.equipmentUnit.findMany({
      where: { equipment: labFilter },
      include: {
        equipment: { select: { name: true, brand: true, model: true, remarks: true, archivedAt: true, lab: { select: { name: true } } } },
        currentLog: { select: { status: true, returnDate: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: [{ equipment: { lab: { name: 'asc' } } }, { equipment: { name: 'asc' } }, { serialNumber: 'asc' }],
    });
    const day = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
    const header = [
      'Laboratory', 'Item', 'Brand', 'Model', 'Serial Number / Asset Tag', 'Serial Type', 'Availability', 'Condition', 'Status',
      'Current location', 'With (on loan)', 'Loan due', 'Date of Purchase', 'Last Checked', 'Unit Remarks', 'Unavailable Reason', 'Item Remarks', 'Archived',
    ];
    const rows = units.map((u) => [
      u.equipment.lab.name,
      u.equipment.name,
      u.equipment.brand ?? '',
      u.equipment.model ?? '',
      u.serialNumber,
      u.serialIsPlaceholder ? 'Generated tag' : 'Manufacturer serial',
      effectiveAvailability(u),
      u.condition,
      u.assetStatus === 'RECEIVED' ? 'Received' : 'Not Received',
      u.location ?? '',
      u.currentLog ? `${u.currentLog.user.name} (${u.currentLog.user.email})` : '',
      u.currentLog ? `${day(u.currentLog.returnDate)}${u.currentLog.status === 'OVERDUE' ? ' OVERDUE' : ''}` : '',
      day(u.purchasedAt),
      day(u.lastCheckedAt),
      u.notes ?? '',
      u.unavailableReason ?? '',
      u.equipment.remarks ?? '',
      u.archivedAt || u.equipment.archivedAt ? 'Yes' : '',
    ]);
    await audit(prisma, { actorId: session.userId, action: 'INVENTORY_EXPORTED', entityType: 'Lab', entityId: labId ?? null, labId: labId ?? null, details: { units: rows.length } });
    return { success: true as const, data: { header, rows } };
  } catch (error) {
    return toActionError(error, 'Export failed.');
  }
}
