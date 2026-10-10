import { PrismaClient, Role, ItemCondition } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  const adminUser = await prisma.user.upsert({
    where: { email: 'kalhara.b@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'kalhara.b@eie.ruh.ac.lk', name: 'Kalhara Batangala', role: Role.SUPER_ADMIN },
  });
  console.log(`✅ Created Super Admin: ${adminUser.email}`);

  const drSubodha = await prisma.user.upsert({
    where: { email: 'subodha.g@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'subodha.g@eie.ruh.ac.lk', name: 'Dr. Subodha Gunawardana', role: Role.LAB_STAFF, isApproved: true },
  });
  console.log(`✅ Created Coordinator: ${drSubodha.name}`);

  const drUdayanga = await prisma.user.upsert({
    where: { email: 'udayanga.n@eie.ruh.ac.lk' },
    update: {},
    create: { email: 'udayanga.n@eie.ruh.ac.lk', name: 'Dr. Niranjan Udayanga', role: Role.LAB_STAFF, isApproved: true },
  });
  console.log(`✅ Created Coordinator: ${drUdayanga.name}`);

  const roboticsLab = await prisma.lab.upsert({
    where: { name: 'Robotics Laboratory' },
    update: {},
    create: {
      name: 'Robotics Laboratory',
      coordinators: [drSubodha.id],
      instructors: ['Mr. Kamalanath'],
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
  console.log(`✅ Seeded Lab: ${roboticsLab.name}`);

  const arVrLab = await prisma.lab.upsert({
    where: { name: 'AR/VR Laboratory' },
    update: {},
    create: {
      name: 'AR/VR Laboratory',
      coordinators: [drUdayanga.id],
      instructors: ['Ms. Dilini'],
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
  console.log(`✅ Seeded Lab: ${arVrLab.name}`);

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