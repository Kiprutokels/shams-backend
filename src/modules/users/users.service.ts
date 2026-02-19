import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(role?: UserRole) {
    const where = role ? { role } : {};

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        isVerified: true,
        specialization: true,
        department: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        address: true,
        role: true,
        isActive: true,
        isVerified: true,
        bloodType: true,
        allergies: true,
        medicalHistory: true,
        specialization: true,
        licenseNumber: true,
        department: true,
        createdAt: true,
        lastLogin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findDoctors(specialization?: string) {
    const where: any = { role: UserRole.DOCTOR, isActive: true };
    if (specialization) {
      where.specialization = { contains: specialization, mode: 'insensitive' };
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        specialization: true,
        department: true,
      },
    });
  }

  async update(id: number, updateUserDto: UpdateUserDto, currentUserId: number, currentUserRole: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Patients can only update their own profile
    if (currentUserRole === 'PATIENT' && id !== currentUserId) {
      throw new ForbiddenException('You can only update your own profile');
    }

    // Doctors can only update their own profile
    if (currentUserRole === 'DOCTOR' && id !== currentUserId) {
      throw new ForbiddenException('You can only update your own profile');
    }

    // Only admin can update isActive
    if (updateUserDto.isActive !== undefined && currentUserRole !== 'ADMIN') {
      delete updateUserDto.isActive;
    }

    const updateData: any = { ...updateUserDto };

    if (updateUserDto.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateUserDto.dateOfBirth);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        gender: true,
        address: true,
        role: true,
        isActive: true,
        bloodType: true,
        allergies: true,
        specialization: true,
        department: true,
      },
    });
  }

  async remove(id: number, currentUserRole: string) {
    if (currentUserRole !== 'ADMIN') {
      throw new ForbiddenException('Only admins can delete users');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete by deactivating
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getProfile(userId: number) {
    return this.findOne(userId);
  }

  async getStats(userId: number, role: string) {
    if (role === 'PATIENT') {
      const [total, upcoming, completed, cancelled] = await Promise.all([
        this.prisma.appointment.count({ where: { patientId: userId } }),
        this.prisma.appointment.count({
          where: {
            patientId: userId,
            status: { in: ['SCHEDULED', 'CONFIRMED'] },
            appointmentDate: { gte: new Date() },
          },
        }),
        this.prisma.appointment.count({
          where: { patientId: userId, status: 'COMPLETED' },
        }),
        this.prisma.appointment.count({
          where: { patientId: userId, status: 'CANCELLED' },
        }),
      ]);

      return { total, upcoming, completed, cancelled };
    }

    if (role === 'DOCTOR') {
      const [total, today, completed, pending] = await Promise.all([
        this.prisma.appointment.count({ where: { doctorId: userId } }),
        this.prisma.appointment.count({
          where: {
            doctorId: userId,
            appointmentDate: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(23, 59, 59, 999)),
            },
          },
        }),
        this.prisma.appointment.count({
          where: { doctorId: userId, status: 'COMPLETED' },
        }),
        this.prisma.appointment.count({
          where: {
            doctorId: userId,
            status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
          },
        }),
      ]);

      return { total, today, completed, pending };
    }

    return {};
  }
}