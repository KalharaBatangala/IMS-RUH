'use server';

import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { toActionError } from '@/lib/errors';

// Read-only view of the append-only audit trail (Super Admin only).
// There is intentionally no action to edit or delete audit rows.
export async function getAuditLog(filters: { action?: string; page?: number } = {}) {
  try {
    await requireSuperAdmin();
    const pageSize = 50;
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const where = filters.action ? { action: String(filters.action) } : {};
    const [rows, total, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);
    return {
      success: true as const,
      data: rows,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      actions: actions.map((a) => a.action),
    };
  } catch (error) {
    return toActionError(error, 'Failed to load the audit log.');
  }
}
