import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
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

  // Create sample doctor
  const doctorPassword = await bcrypt.hash('doctor123', 10);
  const doctor = await prisma.user.create({
    data: {
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

  console.log('✅ Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });