import { IsEnum, IsOptional, IsString, IsDateString, IsInt, IsBoolean, Min } from 'class-validator';
import { AppointmentStatus, PriorityLevel } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateAppointmentDto {
  @IsDateString()
  @IsOptional()
  appointmentDate?: string;

  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @IsEnum(PriorityLevel)
  @IsOptional()
  priority?: PriorityLevel;

  @IsInt()
  @Min(15)
  @IsOptional()
  @Type(() => Number)
  durationMinutes?: number;

  // Admin/Nurse can assign doctor via PATCH
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  doctorId?: number;

  @IsString()
  @IsOptional()
  chiefComplaint?: string;

  @IsString()
  @IsOptional()
  symptoms?: string;

  @IsString()
  @IsOptional()
  vitalSigns?: string;

  @IsString()
  @IsOptional()
  diagnosis?: string;

  @IsString()
  @IsOptional()
  prescription?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  checkedIn?: boolean;
}