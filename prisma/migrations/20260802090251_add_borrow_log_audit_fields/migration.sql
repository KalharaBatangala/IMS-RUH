-- AlterTable
ALTER TABLE "BorrowLog" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "returnedById" TEXT;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowLog" ADD CONSTRAINT "BorrowLog_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
