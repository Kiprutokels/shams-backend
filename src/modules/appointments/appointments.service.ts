import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { FilterAppointmentDto } from './dto/filter-appointment.dto';
import { AppointmentStatus } from '@prisma/client';
import { format } from 'date-fns';

// ─── Shared include shapes ────────────────────────────────────────────────────
const PATIENT_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
} as const;

const PATIENT_FULL_SELECT = {
  ...PATIENT_SELECT,
  bloodType: true,
  allergies: true,
  medicalHistory: true,
} as const;

const DOCTOR_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  specialization: true,
} as const;

const DOCTOR_FULL_SELECT = {
  ...DOCTOR_SELECT,
  department: true,
} as const;

const DEFAULT_INCLUDE = {
  patient: { select: PATIENT_SELECT },
  doctor: { select: DOCTOR_SELECT },
} as const;

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private smsService: SmsService,
  ) {}

  // ─── Create ────────────────────────────────────────────────────────────────
  async create(patientId: number, dto: CreateAppointmentDto) {
    const appointmentDate = new Date(dto.appointmentDate);

    if (dto.doctorId) {
      const doctor = await this.prisma.user.findUnique({
        where: { id: dto.doctorId },
      });
      if (!doctor || doctor.role !== 'DOCTOR') {
        throw new BadRequestException('Invalid doctor ID');
      }

      const duration = dto.durationMinutes ?? 30;
      const conflicts = await this.prisma.appointment.findMany({
        where: {
          doctorId: dto.doctorId,
          appointmentDate: {
            gte: appointmentDate,
            lt: new Date(appointmentDate.getTime() + duration * 60_000),
          },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
        },
      });

      if (conflicts.length > 0) {
        throw new BadRequestException('Doctor is not available at this time');
      }
    }

    const appointment = await this.prisma.appointment.create({
      data: {
        patientId,
        doctorId: dto.doctorId ?? null,
        appointmentDate,
        appointmentType: dto.appointmentType,
        priority: dto.priority ?? 'MEDIUM',
        durationMinutes: dto.durationMinutes ?? 30,
        chiefComplaint: dto.chiefComplaint,
        symptoms: dto.symptoms,
        notes: dto.notes,
      },
      include: DEFAULT_INCLUDE,
    });

    // Notify patient of booking
    try {
      const doctorName = appointment.doctor
        ? `Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`
        : 'To be assigned';

      await this.mailService.sendAppointmentReminderEmail(
        appointment.patient.email,
        {
          patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
          doctorName,
          date: format(appointmentDate, 'MMMM dd, yyyy'),
          time: format(appointmentDate, 'hh:mm a'),
          type: appointment.appointmentType,
          location: 'Main Building',
        },
      );

      await this.smsService.sendAppointmentReminder(appointment.patient.phone, {
        doctorName,
        date: format(appointmentDate, 'MMM dd, yyyy'),
        time: format(appointmentDate, 'hh:mm a'),
      });
    } catch (error) {
      console.error('Booking notification failed:', error);
    }

    return appointment;
  }

  // ─── Confirm (ADMIN / NURSE) ───────────────────────────────────────────────
  async confirmAppointment(id: number, confirmedBy: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: PATIENT_SELECT },
        doctor: { select: DOCTOR_SELECT },
      },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    const confirmableStatuses: AppointmentStatus[] = [
      AppointmentStatus.SCHEDULED,
      AppointmentStatus.RESCHEDULED,
    ];

    if (!confirmableStatuses.includes(appointment.status)) {
      throw new BadRequestException(
        `Cannot confirm an appointment with status "${appointment.status}". Only SCHEDULED or RESCHEDULED appointments can be confirmed.`,
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
      include: DEFAULT_INCLUDE,
    });

    // Notify patient of confirmation
    try {
      const doctorName = updated.doctor
        ? `Dr. ${updated.doctor.firstName} ${updated.doctor.lastName}`
        : 'To be assigned';

      await this.mailService.sendAppointmentReminderEmail(
        updated.patient.email,
        {
          patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
          doctorName,
          date: format(updated.appointmentDate, 'MMMM dd, yyyy'),
          time: format(updated.appointmentDate, 'hh:mm a'),
          type: updated.appointmentType,
          location: 'Main Building',
        },
      );

      await this.smsService.sendAppointmentReminder(updated.patient.phone, {
        doctorName,
        date: format(updated.appointmentDate, 'MMM dd, yyyy'),
        time: format(updated.appointmentDate, 'hh:mm a'),
      });
    } catch (error) {
      console.error('Confirmation notification failed:', error);
    }

    return updated;
  }

  // ─── Find All ──────────────────────────────────────────────────────────────
  async findAll(
    filterDto: FilterAppointmentDto,
    userId: number,
    userRole: string,
  ) {
    const { page = 1, limit = 10, ...filters } = filterDto;
    const skip = (page - 1) * limit;
    const where: any = {};

    // Role-based scoping
    if (userRole === 'PATIENT') {
      where.patientId = userId;
    } else if (userRole === 'DOCTOR') {
      where.doctorId = userId;
    } else {
      // ADMIN / NURSE — free filter
      if (filters.patientId) where.patientId = filters.patientId;
      if (filters.doctorId) where.doctorId = filters.doctorId;
    }

    if (filters.status) where.status = filters.status;
    if (filters.appointmentType)
      where.appointmentType = filters.appointmentType;

    if (filters.startDate || filters.endDate) {
      where.appointmentDate = {};
      if (filters.startDate)
        where.appointmentDate.gte = new Date(filters.startDate);
      if (filters.endDate)
        where.appointmentDate.lte = new Date(filters.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        skip,
        take: limit,
        include: DEFAULT_INCLUDE,
        orderBy: { appointmentDate: 'asc' },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Find One ─────────────────────────────────────────────────────────────
  async findOne(id: number, userId: number, userRole: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: PATIENT_FULL_SELECT },
        doctor: { select: DOCTOR_FULL_SELECT },
      },
    });

    if (!appointment) throw new NotFoundException('Appointment not found');

    if (userRole === 'PATIENT' && appointment.patientId !== userId) {
      throw new ForbiddenException('You can only view your own appointments');
    }
    if (userRole === 'DOCTOR' && appointment.doctorId !== userId) {
      throw new ForbiddenException('You can only view your own appointments');
    }

    return appointment;
  }

  // ─── Update ───────────────────────────────────────────────────────────────
  async update(
    id: number,
    dto: UpdateAppointmentDto,
    userId: number,
    userRole: string,
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    const isAdminLike = userRole === 'ADMIN' || userRole === 'NURSE';

    if (!isAdminLike) {
      if (userRole === 'PATIENT' && appointment.patientId !== userId) {
        throw new ForbiddenException(
          'You can only update your own appointments',
        );
      }
      if (userRole === 'DOCTOR' && appointment.doctorId !== userId) {
        throw new ForbiddenException(
          'You can only update your own appointments',
        );
      }

      if (userRole === 'PATIENT' && dto.status) {
        if (
          !(
            [
              AppointmentStatus.CANCELLED,
              AppointmentStatus.RESCHEDULED,
            ] as string[]
          ).includes(dto.status)
        ) {
          throw new ForbiddenException(
            'Patients can only cancel or reschedule appointments',
          );
        }
      }

      if (dto.doctorId !== undefined) {
        throw new ForbiddenException('Only admin or nurse can assign a doctor');
      }
    }

    // Validate doctor assignment
    if (dto.doctorId) {
      const doctor = await this.prisma.user.findUnique({
        where: { id: dto.doctorId },
      });
      if (!doctor || doctor.role !== 'DOCTOR') {
        throw new BadRequestException('Invalid doctor ID');
      }
    }

    const updateData: any = { ...dto };

    if (dto.appointmentDate) {
      updateData.appointmentDate = new Date(dto.appointmentDate);
    }

    // Auto-timestamps
    if (
      dto.status === AppointmentStatus.CONFIRMED &&
      !appointment.confirmedAt
    ) {
      updateData.confirmedAt = new Date();
    }
    if (
      dto.status === AppointmentStatus.IN_PROGRESS &&
      !appointment.actualStartTime
    ) {
      updateData.actualStartTime = new Date();
    }
    if (
      dto.status === AppointmentStatus.COMPLETED &&
      !appointment.actualEndTime
    ) {
      updateData.actualEndTime = new Date();
    }
    if (dto.checkedIn && !appointment.checkedIn) {
      updateData.checkInTime = new Date();
    }

    return this.prisma.appointment.update({
      where: { id },
      data: updateData,
      include: DEFAULT_INCLUDE,
    });
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────
  async cancel(id: number, userId: number, userRole: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    const isAdminLike = userRole === 'ADMIN' || userRole === 'NURSE';

    if (
      !isAdminLike &&
      userRole === 'PATIENT' &&
      appointment.patientId !== userId
    ) {
      throw new ForbiddenException('You can only cancel your own appointments');
    }

    if (
      appointment.status === AppointmentStatus.COMPLETED ||
      appointment.status === AppointmentStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot cancel this appointment');
    }

    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED },
      include: DEFAULT_INCLUDE,
    });
  }

  // ─── Upcoming ─────────────────────────────────────────────────────────────
  async getUpcoming(userId: number, userRole: string) {
    const where: any = {
      appointmentDate: { gte: new Date() },
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
      },
    };

    if (userRole === 'PATIENT') where.patientId = userId;
    else if (userRole === 'DOCTOR') where.doctorId = userId;

    return this.prisma.appointment.findMany({
      where,
      include: DEFAULT_INCLUDE,
      orderBy: { appointmentDate: 'asc' },
      take: 10,
    });
  }

  // ─── History ──────────────────────────────────────────────────────────────
  async getHistory(userId: number, userRole: string) {
    const where: any = {
      status: {
        in: [
          AppointmentStatus.COMPLETED,
          AppointmentStatus.CANCELLED,
          AppointmentStatus.NO_SHOW,
        ],
      },
    };

    if (userRole === 'PATIENT') where.patientId = userId;
    else if (userRole === 'DOCTOR') where.doctorId = userId;

    return this.prisma.appointment.findMany({
      where,
      include: DEFAULT_INCLUDE,
      orderBy: { appointmentDate: 'desc' },
      take: 50,
    });
  }
}
