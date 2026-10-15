import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  actorId: string | null;
  action: string; // e.g. 'REQUEST_RECOMMENDED'
  entityType: string; // e.g. 'BorrowLog'
  entityId?: string | null;
  labId?: string | null;
  details?: Prisma.InputJsonValue;
}

// Append-only. Pass the transaction client so the audit row commits (or rolls back)
// together with the change it describes. Never put passwords, tokens or codes in `details`.
export async function audit(db: Db, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      labId: entry.labId ?? null,
      details: entry.details,
    },
  });
}
