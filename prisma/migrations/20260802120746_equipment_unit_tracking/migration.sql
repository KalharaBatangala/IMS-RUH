-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'ISSUED');

-- AlterTable
ALTER TABLE "BorrowLog" ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "EquipmentUnit" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "ItemCondition" NOT NULL DEFAULT 'WORKING',
    "assetStatus" "AssetStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUnit_serialNumber_key" ON "EquipmentUnit"("serialNumber");

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EquipmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUnit" ADD CONSTRAINT "EquipmentUnit_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
