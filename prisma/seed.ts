import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // 1. Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@shams.com' },
    update: {},
    create: {
      email: 'admin@shams.com',
      phone: '+1234567890',
      hashedPassword: adminPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isVerified: true,
      isActive: true,
    },
  });

  // 2. Create sample doctor
  const doctorPassword = await bcrypt.hash('doctor123', 10);
  await prisma.user.upsert({
    where: { email: 'doctor@shams.com' },
    update: {},
    create: {
      email: 'doctor@shams.com',
      phone: '+1234567891',
      hashedPassword: doctorPassword,
      firstName: 'Dr. John',
      lastName: 'Smith',
      role: 'DOCTOR',
      specialization: 'General Medicine',
      department: 'General',
      licenseNumber: 'DOC123456',
      isVerified: true,
      isActive: true,
    },
  });

  // 3. Create sample PATIENT
  const patientPassword = await bcrypt.hash('patient123', 10);
  const patient = await prisma.user.upsert({
    where: { email: 'patient@shams.com' },
    update: {},
    create: {
      email: 'patient@shams.com',
      phone: '+1234567892',
      hashedPassword: patientPassword,
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'PATIENT', // Changed role
      isVerified: true,
      isActive: true,
      // Patients typically don't have licenseNumbers, 
      // but they might have things like 'bloodGroup' if your schema allows it.
    },
  });

  console.log('✅ Seed data (Admin, Doctor, and Patient) created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });