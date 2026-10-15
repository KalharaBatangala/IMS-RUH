-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('COORDINATOR', 'TECHNICAL_OFFICER');

-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('HANDOVER', 'RETURN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "RequestStatus" ADD VALUE 'EXPIRED';

-- AlterEnum (hand-edited): rename LAB_STAFF -> COORDINATOR in place, so existing
-- LAB_STAFF users become Coordinators (agreed decision), then add TECHNICAL_OFFICER.
ALTER TYPE "Role" RENAME VALUE 'LAB_STAFF' TO 'COORDINATOR';
ALTER TYPE "Role" ADD VALUE 'TECHNICAL_OFFICER';

-- AlterEnum
ALTER TYPE "UnitStatus" ADD VALUE 'RESERVED';

-- AlterTable
ALTER TABLE "BorrowLog" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "expiredAt" TIMESTAMP(3),
ADD COLUMN     "issueNotes" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reservationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "returnAckOverrideById" TEXT,
ADD COLUMN     "returnAckOverrideReason" TEXT,
ADD COLUMN     "returnAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "returnCondition" "ItemCondition",
ADD COLUMN     "returnInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "returnInitiatedById" TEXT,
ADD COLUMN     "returnNotes" TEXT;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EquipmentUnit" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "currentLogId" TEXT,
ADD COLUMN     "unavailableReason" TEXT;

-- AlterTable
ALTER TABLE "Lab" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LabAssignment" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "unassignedAt" TIMESTAMP(3),
    "unassignedById" TEXT,

    CONSTRAINT "LabAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmationCode" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "labId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabAssignment_labId_unassignedAt_idx" ON "LabAssignment"("labId", "unassignedAt");

-- CreateIndex
CREATE INDEX "LabAssignment_userId_unassignedAt_idx" ON "LabAssignment"("userId", "unassignedAt");

-- CreateIndex
CREATE INDEX "ConfirmationCode_logId_purpose_idx" ON "ConfirmationCode"("logId", "purpose");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "BorrowLog_status_idx" ON "BorrowLog"("status");

-- CreateIndex
CREATE INDEX "BorrowLog_userId_idx" ON "BorrowLog"("userId");

-- CreateIndex
CREATE INDEX "BorrowLog_equipmentId_idx" ON "BorrowLog"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUnit_currentLogId_key" ON "EquipmentUnit"("currentLogId");

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_unassignedById_fkey" FOREIGN KEY ("unassignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_returnInitiatedById_fkey" FOREIGN KEY ("returnInitiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_returnAckOverrideById_fkey" FOREIGN KEY ("returnAckOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUnit" ADD CONSTRAINT "EquipmentUnit_currentLogId_fkey" FOREIGN KEY ("currentLogId") REFERENCES "BorrowLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmationCode" ADD CONSTRAINT "ConfirmationCode_logId_fkey" FOREIGN KEY ("logId") REFERENCES "BorrowLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfirmationCode" ADD CONSTRAINT "ConfirmationCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data migration (hand-written): copy legacy Lab.coordinators (array of User IDs) into
-- LabAssignment rows. Only users whose role is now COORDINATOR are copied. IDs that point
-- at other roles stay in the legacy column (kept, unused) and must be re-assigned manually.
INSERT INTO "LabAssignment" ("id", "labId", "userId", "role", "assignedAt")
SELECT gen_random_uuid()::text, l."id", u."id", 'COORDINATOR'::"AssignmentRole", CURRENT_TIMESTAMP
FROM "Lab" l
CROSS JOIN LATERAL unnest(l."coordinators") AS c("userId")
JOIN "User" u ON u."id" = c."userId" AND u."role" = 'COORDINATOR';
