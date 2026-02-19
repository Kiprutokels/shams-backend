import { IsOptional, IsInt, IsDateString, IsEnum } from 'class-validator';
import { AppointmentStatus, AppointmentType } from '@prisma/client';

export class FilterAppointmentDto {
  @IsInt()
  @IsOptional()
  patientId?: number;

  @IsInt()
  @IsOptional()
  doctorId?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @IsEnum(AppointmentType)
  @IsOptional()
  appointmentType?: AppointmentType;

  @IsInt()
  @IsOptional()
  page?: number;

  @IsInt()
  @IsOptional()
  limit?: number;
}