import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { FilterAppointmentDto } from './dto/filter-appointment.dto';
import { AppointmentStatus } from '@prisma/client';
import { format } from 'date-fns';

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private smsService: SmsService,
  ) {}

  async create(patientId: number, createAppointmentDto: CreateAppointmentDto) {
    // Check if doctor exists
    const doctor = await this.prisma.user.findUnique({
      where: { id: createAppointmentDto.doctorId },
    });

    if (!doctor || doctor.role !== 'DOCTOR') {
      throw new BadRequestException('Invalid doctor ID');
    }

    // Check for conflicts
    const appointmentDate = new Date(createAppointmentDto.appointmentDate);
    const conflicts = await this.prisma.appointment.findMany({
      where: {
        doctorId: createAppointmentDto.doctorId,
        appointmentDate: {
          gte: appointmentDate,
          lt: new Date(appointmentDate.getTime() + (createAppointmentDto.durationMinutes || 30) * 60000),
        },
        status: {
          in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
        },
      },
    });

    if (conflicts.length > 0) {
      throw new BadRequestException('Doctor is not available at this time');
    }

    // Create appointment
    const appointment = await this.prisma.appointment.create({
      data: {
        patientId,
        doctorId: createAppointmentDto.doctorId,
        appointmentDate,
        appointmentType: createAppointmentDto.appointmentType,
        priority: createAppointmentDto.priority || 'MEDIUM',
        durationMinutes: createAppointmentDto.durationMinutes || 30,
        chiefComplaint: createAppointmentDto.chiefComplaint,
        symptoms: createAppointmentDto.symptoms,
        notes: createAppointmentDto.notes,
      },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
        doctor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });

    // Send confirmation email & SMS
    try {
      await this.mailService.sendAppointmentReminderEmail(appointment.patient.email, {
        patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
        doctorName: `${appointment.doctor.firstName} ${appointment.doctor.lastName}`,
        date: format(appointmentDate, 'MMMM dd, yyyy'),
        time: format(appointmentDate, 'hh:mm a'),
        type: appointment.appointmentType,
        location: 'Main Building',
      });

      await this.smsService.sendAppointmentReminder(appointment.patient.phone, {
        doctorName: `${appointment.doctor.firstName} ${appointment.doctor.lastName}`,
        date: format(appointmentDate, 'MMM dd, yyyy'),
        time: format(appointmentDate, 'hh:mm a'),
      });
    } catch (error) {
      console.error('Failed to send notifications:', error);
    }

    return appointment;
  }

  async findAll(filterDto: FilterAppointmentDto) {
    const { page = 1, limit = 10, ...filters } = filterDto;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.doctorId) where.doctorId = filters.doctorId;
    if (filters.status) where.status = filters.status;
    if (filters.appointmentType) where.appointmentType = filters.appointmentType;

    if (filters.startDate || filters.endDate) {
      where.appointmentDate = {};
      if (filters.startDate) where.appointmentDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.appointmentDate.lte = new Date(filters.endDate);
    }

    const [appointments, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip,
        take: limit,
        include: {
          patient: {
            select: {
              id: true,
              email: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
          doctor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
        },
        orderBy: {
          appointmentDate: 'asc',
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      appointments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, userId: number, userRole: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            bloodType: true,
            allergies: true,
            medicalHistory: true,
          },
        },
        doctor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            specialization: true,
            department: true,
          },
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    // Check access permissions
    if (userRole === 'PATIENT' && appointment.patientId !== userId) {
      throw new ForbiddenException('You can only view your own appointments');
    }

    if (userRole === 'DOCTOR' && appointment.doctorId !== userId) {
      throw new ForbiddenException('You can only view your own appointments');
    }

    return appointment;
  }

  async update(id: number, updateAppointmentDto: UpdateAppointmentDto, userId: number, userRole: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    // Check permissions
    if (userRole === 'PATIENT' && appointment.patientId !== userId) {
      throw new ForbiddenException('You can only update your own appointments');
    }

    if (userRole === 'DOCTOR' && appointment.doctorId !== userId) {
      throw new ForbiddenException('You can only update your own appointments');
    }

    // Patients can only reschedule or cancel
    if (userRole === 'PATIENT' && updateAppointmentDto.status) {
      if (!['CANCELLED', 'RESCHEDULED'].includes(updateAppointmentDto.status)) {
        throw new ForbiddenException('Patients can only cancel or reschedule appointments');
      }
    }

    const updateData: any = { ...updateAppointmentDto };

    if (updateAppointmentDto.appointmentDate) {
      updateData.appointmentDate = new Date(updateAppointmentDto.appointmentDate);
    }

    if (updateAppointmentDto.status === 'IN_PROGRESS' && !appointment.actualStartTime) {
      updateData.actualStartTime = new Date();
    }

    if (updateAppointmentDto.status === 'COMPLETED' && !appointment.actualEndTime) {
      updateData.actualEndTime = new Date();
    }

    if (updateAppointmentDto.checkedIn && !appointment.checkedIn) {
      updateData.checkInTime = new Date();
    }

    return this.prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
          },
        },
        doctor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
    });
  }

  async cancel(id: number, userId: number, userRole: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (userRole === 'PATIENT' && appointment.patientId !== userId) {
      throw new ForbiddenException('You can only cancel your own appointments');
    }

    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new BadRequestException('Cannot cancel this appointment');
    }

    return this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
      },
    });
  }

  async getUpcoming(userId: number, userRole: string) {
    const where: any = {
      appointmentDate: {
        gte: new Date(),
      },
      status: {
        in: ['SCHEDULED', 'CONFIRMED'],
      },
    };

    if (userRole === 'PATIENT') {
      where.patientId = userId;
    } else if (userRole === 'DOCTOR') {
      where.doctorId = userId;
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
      orderBy: {
        appointmentDate: 'asc',
      },
      take: 10,
    });
  }

  async getHistory(userId: number, userRole: string) {
    const where: any = {
      appointmentDate: {
        lt: new Date(),
      },
      status: {
        in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
      },
    };

    if (userRole === 'PATIENT') {
      where.patientId = userId;
    } else if (userRole === 'DOCTOR') {
      where.doctorId = userId;
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
          },
        },
      },
      orderBy: {
        appointmentDate: 'desc',
      },
      take: 50,
    });
  }
}