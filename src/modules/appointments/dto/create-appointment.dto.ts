import { IsInt, IsDateString, IsEnum, IsOptional, IsString, Min } from 'class-validator';
import { AppointmentType, PriorityLevel } from '@prisma/client';

export class CreateAppointmentDto {
  @IsInt()
  doctorId: number;

  @IsDateString()
  appointmentDate: string;

  @IsEnum(AppointmentType)
  appointmentType: AppointmentType;

  @IsEnum(PriorityLevel)
  @IsOptional()
  priority?: PriorityLevel;

  @IsInt()
  @Min(15)
  @IsOptional()
  durationMinutes?: number;

  @IsString()
  @IsOptional()
  chiefComplaint?: string;

  @IsString()
  @IsOptional()
  symptoms?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}