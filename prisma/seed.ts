import { PrismaClient, Role, ItemCondition, type AssignmentRole } from '@prisma/client';

// Development seed. Users are created WITHOUT passwords: a Super Admin sets a temporary
// password from the Users page (or run `npm run admin:create` for the first admin).
// upsert + nested create only runs when a row is first created; re-seeding an existing
// database does not add nested equipment/units again.

const prisma = new PrismaClient();

async function ensureAssignment(labId: string, userId: string, role: AssignmentRole) {
  const existing = await prisma.labAssignment.findFirst({ where: { labId, userId, unassignedAt: null } });
  if (!existing) await prisma.labAssignment.create({ data: { labId, userId, role } });
}

async function main() {
  console.log('🌱 Starting database seeding...');

  const adminUser = await prisma.user.upsert({
    where: { email: 'kalhara.b@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'kalhara.b@eie.ruh.ac.lk', name: 'Kalhara Batangala', role: Role.SUPER_ADMIN, isApproved: true },
  });
  console.log(`✅ Super Admin: ${adminUser.email}`);

  const drSubodha = await prisma.user.upsert({
    where: { email: 'subodha.g@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'subodha.g@eie.ruh.ac.lk', name: 'Dr. Subodha Gunawardana', role: Role.COORDINATOR, isApproved: true },
  });
  const drUdayanga = await prisma.user.upsert({
    where: { email: 'udayanga.n@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'udayanga.n@eie.ruh.ac.lk', name: 'Dr. Niranjan Udayanga', role: Role.COORDINATOR, isApproved: true },
  });
  const technicalOfficer = await prisma.user.upsert({
    where: { email: 'to.robotics@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'to.robotics@eie.ruh.ac.lk', name: 'Sample Technical Officer', role: Role.TECHNICAL_OFFICER, isApproved: true },
  });
  console.log('✅ Coordinators and Technical Officer');

  const roboticsLab = await prisma.lab.upsert({
    where: { name: 'Robotics Laboratory' },
    update: {},
    create: {
      name: 'Robotics Laboratory',
      equipment: {
        create: [
          {
            name: 'Franka Emika Production Robot Arm',
            brand: 'Franka Robotics',
            model: 'PANDA-7DOF',
            remarks: 'Procured under 200M Grant',
            units: { create: [{ serialNumber: 'FRANKA-0001', condition: ItemCondition.WORKING }] },
          },
          {
            name: 'Stereo Vision & Depth Sensing Camera',
            brand: 'Intel RealSense',
            model: 'D455f',
            units: {
              create: [
                { serialNumber: 'REALSENSE-0001', condition: ItemCondition.WORKING },
                { serialNumber: 'REALSENSE-0002', condition: ItemCondition.WORKING },
              ],
            },
          },
        ],
      },
    },
  });

  const arVrLab = await prisma.lab.upsert({
    where: { name: 'AR/VR Laboratory' },
    update: {},
    create: {
      name: 'AR/VR Laboratory',
      equipment: {
        create: [
          {
            name: 'Meta Quest 3 Headset (512GB)',
            brand: 'Meta',
            model: 'Quest 3',
            units: {
              create: [
                { serialNumber: 'MQ3-0001', condition: ItemCondition.WORKING },
                { serialNumber: 'MQ3-0002', condition: ItemCondition.WORKING },
                { serialNumber: 'MQ3-0003', condition: ItemCondition.WORKING },
                { serialNumber: 'MQ3-0004', condition: ItemCondition.WORKING },
              ],
            },
          },
          {
            name: 'Haptic Feedback Gloves Pair',
            brand: 'SenseGlove',
            model: 'Nova 2',
            remarks: 'Awaiting shipping clearance',
            units: { create: [{ serialNumber: 'SENSEGLOVE-0001', condition: ItemCondition.WORKING }] },
          },
        ],
      },
    },
  });

  // Assignments only for users whose role matches (an existing DB may hold other roles).
  const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).role;
  if ((await roleOf(drSubodha.id)) === 'COORDINATOR') await ensureAssignment(roboticsLab.id, drSubodha.id, 'COORDINATOR');
  if ((await roleOf(drUdayanga.id)) === 'COORDINATOR') await ensureAssignment(arVrLab.id, drUdayanga.id, 'COORDINATOR');
  if ((await roleOf(technicalOfficer.id)) === 'TECHNICAL_OFFICER') {
    await ensureAssignment(roboticsLab.id, technicalOfficer.id, 'TECHNICAL_OFFICER');
    await ensureAssignment(arVrLab.id, technicalOfficer.id, 'TECHNICAL_OFFICER');
  }
  console.log(`✅ Seeded Labs: ${roboticsLab.name}, ${arVrLab.name}`);

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
