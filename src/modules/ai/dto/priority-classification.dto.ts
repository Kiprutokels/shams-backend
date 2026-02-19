import { IsInt, IsOptional, IsString, IsNumber } from "class-validator";

export class PriorityClassificationRequest {
  @IsInt()
  patient_id: number;

  @IsInt()
  @IsOptional()
  appointment_id?: number;

  @IsString()
  chief_complaint: string;

  @IsString()
  @IsOptional()
  symptoms?: string;

  @IsString()
  @IsOptional()
  vital_signs?: string;

  @IsString()
  @IsOptional()
  medical_history?: string;

  @IsNumber()
  @IsOptional()
  patient_age?: number;
}

export class PriorityClassificationResponse {
  priority_level: string;
  priority_score: number;
  urgency_factors: string[];
  recommendation: string;
}