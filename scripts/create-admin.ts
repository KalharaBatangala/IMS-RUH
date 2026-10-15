// Bootstrap / recover a Super Admin from the server console (needs server access,
// so it cannot be abused from the web). Prints a one-time temporary password.
//
//   npm run admin:create -- name@eie.ruh.ac.lk "Full Name"
//
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  const name = nameParts.join(' ').trim();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run admin:create -- <email> "<Full Name>"');
    process.exit(1);
  }

  const temporaryPassword = randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const active = await prisma.labAssignment.count({ where: { userId: existing.id, unassignedAt: null } });
    if (active > 0 && existing.role !== 'SUPER_ADMIN') {
      console.error(`${email} has ${active} active lab assignment(s). Remove them before making this account a Super Admin.`);
      process.exit(1);
    }
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: 'SUPER_ADMIN',
      isApproved: true,
      isActive: true,
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: { increment: 1 },
    },
    create: { email, name: name || email, role: 'SUPER_ADMIN', isApproved: true, passwordHash },
  });
  await prisma.auditLog.create({
    data: { actorId: null, action: 'ADMIN_BOOTSTRAPPED_FROM_CONSOLE', entityType: 'User', entityId: user.id },
  });

  console.log(`Super Admin ready: ${user.email}`);
  console.log(`Temporary password (shown once): ${temporaryPassword}`);
  console.log('Sign in and change it under My Account.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
