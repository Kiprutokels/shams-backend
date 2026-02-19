import { Injectable } from '@nestjs/common';
import { PriorityClassificationRequest, PriorityClassificationResponse } from '../dto';

@Injectable()
export class PriorityClassifierService {
  // Placeholder - Replace with your actual ML model
  async classify(request: PriorityClassificationRequest): Promise<PriorityClassificationResponse> {
    const urgencyKeywords = {
      EMERGENCY: ['chest pain', 'severe', 'bleeding', 'unconscious', 'accident', 'trauma', 'emergency'],
      HIGH: ['high fever', 'difficulty breathing', 'severe pain', 'infection', 'urgent'],
      MEDIUM: ['moderate pain', 'fever', 'cough', 'headache', 'follow-up'],
      LOW: ['checkup', 'routine', 'minor', 'consultation', 'preventive'],
    };

    const text = `${request.chief_complaint} ${request.symptoms || ''}`.toLowerCase();

    let priorityLevel = 'MEDIUM';
    let priorityScore = 2.0;
    const urgencyFactors: string[] = [];

    // Check for emergency keywords
    for (const keyword of urgencyKeywords.EMERGENCY) {
      if (text.includes(keyword)) {
        priorityLevel = 'EMERGENCY';
        priorityScore = 4.0;
        urgencyFactors.push(`Emergency keyword detected: ${keyword}`);
        break;
      }
    }

    // Check for high priority
    if (priorityLevel !== 'EMERGENCY') {
      for (const keyword of urgencyKeywords.HIGH) {
        if (text.includes(keyword)) {
          priorityLevel = 'HIGH';
          priorityScore = 3.0;
          urgencyFactors.push(`High priority symptom: ${keyword}`);
          break;
        }
      }
    }

    // Check for low priority
    if (priorityLevel === 'MEDIUM') {
      for (const keyword of urgencyKeywords.LOW) {
        if (text.includes(keyword)) {
          priorityLevel = 'LOW';
          priorityScore = 1.0;
          urgencyFactors.push(`Routine or non-urgent case`);
          break;
        }
      }
    }

    // Age factor
    if (request.patient_age) {
      if (request.patient_age < 5 || request.patient_age > 65) {
        priorityScore += 0.5;
        urgencyFactors.push('Patient in vulnerable age group');
      }
    }

    // Vital signs factor
    if (request.vital_signs) {
      urgencyFactors.push('Vital signs available for assessment');
      priorityScore += 0.2;
    }

    // Medical history factor
    if (request.medical_history && request.medical_history.includes('chronic')) {
      urgencyFactors.push('Chronic condition history');
      priorityScore += 0.3;
    }

    let recommendation = '';
    if (priorityLevel === 'EMERGENCY') {
      recommendation = 'Immediate medical attention required. Fast-track to emergency bay.';
    } else if (priorityLevel === 'HIGH') {
      recommendation = 'Priority appointment. Schedule within 24 hours.';
    } else if (priorityLevel === 'MEDIUM') {
      recommendation = 'Standard scheduling. Monitor for any changes.';
    } else {
      recommendation = 'Routine care. Can be scheduled within 1-2 weeks.';
    }

    return {
      priority_level: priorityLevel,
      priority_score: Math.round(priorityScore * 100) / 100,
      urgency_factors: urgencyFactors,
      recommendation,
    };
  }
}