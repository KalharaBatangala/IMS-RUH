'use server';

import { prisma } from '@/lib/prisma';
import { AssetStatus, ItemCondition } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';


function generateSerial(name: string, equipmentId: string, index: number) {
  const prefix = (name.match(/[a-zA-Z0-9]/g)?.join('').slice(0, 6) || 'UNIT').toUpperCase();
  return `${prefix}-${equipmentId.slice(0, 4).toUpperCase()}-${index}`;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}



// 1. Fetch All Equipment
export async function getEquipment(query?: string, labId?: string) {
  try {
    const equipment = await prisma.equipment.findMany({
      where: {
        ...(labId ? { labId } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { brand: { contains: query, mode: 'insensitive' } },
                { model: { contains: query, mode: 'insensitive' } },
                { units: { some: { serialNumber: { contains: query, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: {
        lab: {
          select: {
            name: true,
          },
        },
        units: { select: { status: true, condition: true } },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const data = equipment.map((eq) => {
      const totalUnits = eq.units.length;
      const availableUnits = eq.units.filter(
        (u) => u.status === 'AVAILABLE' && u.condition === 'WORKING'
      ).length;
      const conditionSummary: Record<string, number> = {};
      for (const u of eq.units) {
        conditionSummary[u.condition] = (conditionSummary[u.condition] || 0) + 1;
      }
      return {
        id: eq.id,
        name: eq.name,
        brand: eq.brand,
        model: eq.model,
        remarks: eq.remarks,
        lab: eq.lab,
        totalUnits,
        availableUnits,
        conditionSummary,
      };
    });


    return { success: true, data: data };
  } catch (error) {
    console.error('Failed to fetch equipment:', error);
    return { success: false, error: 'Could not fetch equipment items.' };
  }
}


// 2. Fetch individual units for one equipment type (staff-only, for expand row)
export async function getEquipmentUnits(equipmentId: string) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized.' };
  }
  try {
    const units = await prisma.equipmentUnit.findMany({
      where: { equipmentId },
      orderBy: { serialNumber: 'asc' },
    });
    return { success: true, data: units };
  } catch (error) {
    return { success: false, error: 'Could not fetch equipment units.' };
  }
}

// 3. Fetch only currently-available units (staff-only, for the Issue modal dropdown)
export async function getAvailableUnitsForIssue(equipmentId: string) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized.' };
  }
  try {
    const units = await prisma.equipmentUnit.findMany({
      where: { equipmentId, status: 'AVAILABLE', condition: 'WORKING' },
      orderBy: { serialNumber: 'asc' },
    });
    return { success: true, data: units };
  } catch (error) {
    return { success: false, error: 'Could not fetch available units.' };
  }
}





// 2. Fetch All Laboratories
export async function getLabs() {
  try {
    const labs = await prisma.lab.findMany({
      include: {
        _count: {
          select: { equipment: true },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

     const coordinatorIds = Array.from(
      new Set(labs.flatMap((lab) => lab.coordinators || []))
    );

    const users = await prisma.user.findMany({
      where: { id: { in: coordinatorIds } },
      select: { id: true, name: true, email: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const formattedLabs = labs.map((lab) => ({
      ...lab,
      coordinators: (lab.coordinators || [])
        .map((id) => userMap.get(id))
        .filter((u): u is { id: string; name: string; email: string } => Boolean(u)),
    }));


    return { success: true, data: formattedLabs };
  } catch (error) {
    console.error('Failed to fetch labs:', error);
    return { success: false, error: 'Could not fetch laboratory list.' };
  }
}

// 3. Create a New Equipment Item
// Modified: createEquipment now merges into an existing type if the name
// matches (case/whitespace-insensitive) within the same lab.
export async function createEquipment(formData: {
  name: string;
  quantity: number;
  brand?: string;
  model?: string;
  remarks?: string;
  labId: string;
}) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized: only lab staff can add equipment.' };
  }

  try {

    const normalized = normalizeName(formData.name);
    const candidates = await prisma.equipment.findMany({ where: { labId: formData.labId } });
    const match = candidates.find((eq) => normalizeName(eq.name) === normalized);

    if (match) {
      const existingUnitsCount = await prisma.equipmentUnit.count({ where: { equipmentId: match.id } });
      const unitsData = Array.from({ length: formData.quantity }, (_, i) => ({
        equipmentId: match.id,
        serialNumber: generateSerial(match.name, match.id, existingUnitsCount + i + 1),
        condition: 'WORKING' as const,
        status: 'AVAILABLE' as const,
      }));
      await prisma.equipmentUnit.createMany({ data: unitsData });

      revalidatePath('/dashboard/inventory');
      return {
        success: true,
        data: match,
        merged: true,
        message: `${formData.quantity} unit(s) added to the existing "${match.name}" entry.`,
      };
    }

    const newEquipment = await prisma.equipment.create({
      data: {
        name: formData.name.trim(),
        brand: formData.brand || null,
        model: formData.model || null,
        remarks: formData.remarks || null,
        labId: formData.labId,
      },
    });

    const unitsData = Array.from({ length: formData.quantity }, (_, i) => ({
      equipmentId: newEquipment.id,
      serialNumber: generateSerial(formData.name, newEquipment.id, i + 1),
      condition: 'WORKING' as const,
      status: 'AVAILABLE' as const,
    }));

    await prisma.equipmentUnit.createMany({ data: unitsData });

    revalidatePath('/dashboard/inventory');
    return { success: true, data: newEquipment };
  } catch (error) {
    console.error('Failed to create equipment:', error);
    return { success: false, error: 'Failed to add equipment item.' };
  }
}

// New: explicit "add more units to an existing type" action
export async function addUnitsToEquipment(equipmentId: string, quantity: number) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized.' };
  }
  try {
    const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
    if (!equipment) return { success: false, error: 'Equipment type not found.' };

    const existingUnitsCount = await prisma.equipmentUnit.count({ where: { equipmentId } });
    const unitsData = Array.from({ length: quantity }, (_, i) => ({
      equipmentId,
      serialNumber: generateSerial(equipment.name, equipment.id, existingUnitsCount + i + 1),
      condition: 'WORKING' as const,
      status: 'AVAILABLE' as const,
    }));
    await prisma.equipmentUnit.createMany({ data: unitsData });

    revalidatePath('/dashboard/inventory');
    return { success: true };
  } catch (error) {
    console.error('Failed to add units:', error);
    return { success: false, error: 'Failed to add units.' };
  }
}

// New: edit a unit's condition / asset status (staff/admin only, status excluded on purpose)
export async function updateEquipmentUnit(
  unitId: string,
  data: { condition?: ItemCondition; assetStatus?: AssetStatus }
) {
  const session = await getSession();
  if (!session || (session.role !== 'LAB_STAFF' && session.role !== 'SUPER_ADMIN')) {
    return { success: false, error: 'Unauthorized.' };
  }
  try {
    await prisma.equipmentUnit.update({
      where: { id: unitId },
      data: {
        ...(data.condition ? { condition: data.condition } : {}),
        ...(data.assetStatus ? { assetStatus: data.assetStatus } : {}),
      },
    });
    revalidatePath('/dashboard/inventory');
    return { success: true };
  } catch (error) {
    console.error('Failed to update unit:', error);
    return { success: false, error: 'Failed to update unit.' };
  }
}