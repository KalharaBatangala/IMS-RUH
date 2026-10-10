'use server';

import { prisma } from '@/lib/prisma'; // Adjust import based on your Prisma client path
import { getSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

// Helper guard for Super Admin
async function requireSuperAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'SUPER_ADMIN') {
    throw new Error('Unauthorized: Only Super Admins can manage laboratories.');
  }
  return session;
}

// 1. Get all labs with coordinators and equipment counts
export async function getManageableLabs() {
  try {
    await requireSuperAdmin();
    const labs = await prisma.lab.findMany({
      include: {
        
        _count: { select: { equipment: true } },
      },
      orderBy: { name: 'asc' },
    });

    // 2. Collect all unique coordinator user IDs across all labs
    const coordinatorIds = Array.from(
      new Set(labs.flatMap((lab) => lab.coordinators || []))
    );

    // 3. Fetch user info for those IDs
    const users = await prisma.user.findMany({
      where: {
        id: { in: coordinatorIds },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    // Map user IDs to quick lookup objects
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 4. Map labs to attach resolved coordinator user objects
    const formattedLabs = labs.map((lab) => ({
      ...lab,
      coordinators: (lab.coordinators || [])
        .map((id) => userMap.get(id))
        .filter((u): u is { id: string; name: string; email: string } => Boolean(u)),
    }));

    return { success: true, data: formattedLabs };
  } catch (err: any) {
    console.error('Error fetching labs:', err);
    return { success: false, error: err.message };
  }
}

// 2. Get available Lab Staff members for coordinator assignment
export async function getAvailableStaff() {
  try {
    await requireSuperAdmin();
    
    const staff = await prisma.user.findMany({
      where: {
        role: {
          in: ['LAB_STAFF', 'SUPER_ADMIN'], // <-- Include all relevant staff roles
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return { success: true, data: staff };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// 3. Create a new Lab
export async function createLab(name: string, description?: string) {
  try {
    await requireSuperAdmin();
    if (!name.trim()) return { success: false, error: 'Lab name is required.' };

    const newLab = await prisma.lab.create({
      data: { name: name.trim() },
    });

    revalidatePath('/dashboard/labs');
    return { success: true, data: newLab };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create laboratory.' };
  }
}

// 4. Assign a Coordinator to a Lab
export async function assignCoordinator(labId: string, userId: string) {
  try {
    await requireSuperAdmin();

    // 1. Get current lab to check existing coordinators
    const lab = await prisma.lab.findUnique({
      where: { id: labId },
      select: { coordinators: true },
    });

    if (!lab) {
      return { success: false, error: 'Laboratory not found.' };
    }

    // 2. Prevent duplicate entries
    if (lab.coordinators.includes(userId)) {
      return { success: false, error: 'User is already a coordinator for this lab.' };
    }

    // 3. Update using Prisma's `push` array operator
    await prisma.lab.update({
      where: { id: labId },
      data: {
        coordinators: {
          push: userId,
        },
      },
    });

    revalidatePath('/dashboard/labs');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to assign coordinator.' };
  }
}

// 5. Remove a Coordinator from a Lab
export async function removeCoordinator(labId: string, userId: string) {
  try {
    await requireSuperAdmin();

    const lab = await prisma.lab.findUnique({
      where: { id: labId },
      select: { coordinators: true },
    });

    if (!lab) return { success: false, error: 'Laboratory not found.' };

    const updatedCoordinators = lab.coordinators.filter((id) => id !== userId);


    await prisma.lab.update({
      where: { id: labId },
      data: {
        coordinators: {
          set: updatedCoordinators,
        },
      },
    });

    revalidatePath('/dashboard/labs');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to remove coordinator.' };
  }
}

// 6. Delete a Lab
export async function deleteLab(labId: string) {
  try {
    await requireSuperAdmin();

    // Check if lab contains registered equipment before deleting
    const equipmentCount = await prisma.equipment.count({ where: { labId } });
    if (equipmentCount > 0) {
      return {
        success: false,
        error: `Cannot delete laboratory containing ${equipmentCount} registered equipment items. Move or delete the equipment first.`,
      };
    }

    await prisma.lab.delete({ where: { id: labId } });

    revalidatePath('/dashboard/labs');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete laboratory.' };
  }
}