-- AlterTable
ALTER TABLE "User" ADD COLUMN     "indexNumber" TEXT,
ADD COLUMN     "rosterVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudentRoster" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRosterEntry" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "indexNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "StudentRosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentRosterEntry_email_idx" ON "StudentRosterEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRosterEntry_rosterId_email_key" ON "StudentRosterEntry"("rosterId", "email");

-- AddForeignKey
ALTER TABLE "StudentRoster" ADD CONSTRAINT "StudentRoster_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRosterEntry" ADD CONSTRAINT "StudentRosterEntry_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "StudentRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
