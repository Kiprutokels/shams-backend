import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NoShowPredictorService } from './services/noshow-predictor.service';
import { WaitTimeEstimatorService } from './services/waittime-estimator.service';
import { PriorityClassifierService } from './services/priority-classifier.service';
import {
  NoShowPredictionRequest,
  WaitTimePredictionRequest,
  PriorityClassificationRequest,
  QueueOptimizationRequest,
  BatchPredictionRequest,
} from './dto';

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private noShowPredictor: NoShowPredictorService,
    private waitTimeEstimator: WaitTimeEstimatorService,
    private priorityClassifier: PriorityClassifierService,
  ) {}

  async predictNoShow(request: NoShowPredictionRequest, userId?: number) {
    // Enrich data from database if appointment_id provided
    if (request.appointment_id) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: request.appointment_id },
        include: { patient: true },
      });

      if (appointment) {
        request.patient_id = appointment.patientId;
        request.appointment_date = appointment.appointmentDate.toISOString();
        request.appointment_type = appointment.appointmentType;

        // Get patient's appointment history
        const previousAppointments = await this.prisma.appointment.count({
          where: { patientId: appointment.patientId },
        });

        const previousNoShows = await this.prisma.appointment.count({
          where: { patientId: appointment.patientId, status: 'NO_SHOW' },
        });

        request.previous_appointments = previousAppointments;
        request.previous_no_shows = previousNoShows;
      }
    }

    const prediction = await this.noShowPredictor.predict(request);

    // Update appointment with prediction
    if (request.appointment_id) {
      await this.prisma.appointment.update({
        where: { id: request.appointment_id },
        data: { noShowProbability: prediction.no_show_probability },
      });
    }

    return prediction;
  }

  async estimateWaitTime(request: WaitTimePredictionRequest) {
    // Get current queue length
    if (!request.current_queue_length) {
      const appointmentDate = new Date(request.appointment_date);
      request.current_queue_length = await this.prisma.appointment.count({
        where: {
          doctorId: request.doctor_id,
          appointmentDate: {
            gte: new Date(appointmentDate.setHours(0, 0, 0, 0)),
            lt: new Date(appointmentDate.setHours(23, 59, 59, 999)),
          },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
        },
      });
    }

    const estimation = await this.waitTimeEstimator.predict(request);

    // Update appointment
    if (request.appointment_id) {
      await this.prisma.appointment.update({
        where: { id: request.appointment_id },
        data: {
          estimatedWaitTime: estimation.estimated_wait_time,
          queuePosition: estimation.queue_position,
        },
      });
    }

    return estimation;
  }

  async classifyPriority(request: PriorityClassificationRequest) {
    const classification = await this.priorityClassifier.classify(request);

    // Update appointment
    if (request.appointment_id) {
      await this.prisma.appointment.update({
        where: { id: request.appointment_id },
        data: {
          aiPriorityScore: classification.priority_score,
          priority: classification.priority_level as any,
        },
      });
    }

    return classification;
  }

  async optimizeQueue(request: QueueOptimizationRequest) {
    const date = new Date(request.date);

    const where: any = {
      appointmentDate: {
        gte: new Date(date.setHours(0, 0, 0, 0)),
        lt: new Date(date.setHours(23, 59, 59, 999)),
      },
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    };

    if (request.doctor_id) {
      where.doctorId = request.doctor_id;
    }

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    });

    // Priority scoring
    const priorityWeights = {
      EMERGENCY: 4.0,
      HIGH: 3.0,
      MEDIUM: 2.0,
      LOW: 1.0,
    };

    const scoredAppointments = appointments.map((apt) => {
      let score = priorityWeights[apt.priority] || 2.0;

      // Add no-show probability factor
      if (apt.noShowProbability !== null) {
        score += (1.0 - apt.noShowProbability) * 0.5;
      }

      // Add AI priority score
      if (apt.aiPriorityScore !== null) {
        score += apt.aiPriorityScore * 2.0;
      }

      return {
        appointment_id: apt.id,
        patient_id: apt.patientId,
        priority_score: score,
        priority_level: apt.priority,
        no_show_probability: apt.noShowProbability,
        appointment_time: apt.appointmentDate.toISOString(),
        original_position: apt.queuePosition || 0,
        new_position: 0,
      };
    });

    // Sort by priority score
    scoredAppointments.sort((a, b) => b.priority_score - a.priority_score);

    // Update queue positions
    let changesMade = 0;
    for (let idx = 0; idx < scoredAppointments.length; idx++) {
      const newPosition = idx + 1;
      scoredAppointments[idx].new_position = newPosition;

      if (scoredAppointments[idx].original_position !== newPosition) {
        changesMade++;
        await this.prisma.appointment.update({
          where: { id: scoredAppointments[idx].appointment_id },
          data: { queuePosition: newPosition },
        });
      }
    }

    const totalDuration = appointments.reduce((sum, apt) => sum + (apt.durationMinutes || 30), 0);
    const estimatedCompletion = new Date(Date.now() + totalDuration * 60000);
    const efficiencyScore = scoredAppointments.length > 0 ? 1.0 - changesMade / scoredAppointments.length : 0;

    return {
      optimized_queue: scoredAppointments,
      total_appointments: scoredAppointments.length,
      estimated_completion_time: estimatedCompletion.toISOString(),
      efficiency_score: efficiencyScore,
      changes_made: changesMade,
    };
  }

  async batchPredict(request: BatchPredictionRequest) {
    const predictions = [];
    const failedPredictions = [];

    for (const appointmentId of request.appointment_ids) {
      try {
        const appointment = await this.prisma.appointment.findUnique({
          where: { id: appointmentId },
        });

        if (!appointment) {
          failedPredictions.push(appointmentId);
          continue;
        }

        if (request.prediction_type === 'no_show') {
          const result = await this.predictNoShow(
            {
              appointment_id: appointmentId,
              patient_id: appointment.patientId,
              appointment_date: appointment.appointmentDate.toISOString(),
              appointment_type: appointment.appointmentType,
            },
          );

          predictions.push({
            appointment_id: appointmentId,
            type: 'no_show',
            result,
          });
        } else if (request.prediction_type === 'wait_time') {
          const result = await this.estimateWaitTime({
            appointment_id: appointmentId,
            doctor_id: appointment.doctorId,
            appointment_date: appointment.appointmentDate.toISOString(),
            appointment_type: appointment.appointmentType,
          });

          predictions.push({
            appointment_id: appointmentId,
            type: 'wait_time',
            result,
          });
        }
      } catch (error) {
        failedPredictions.push(appointmentId);
      }
    }

    return {
      predictions,
      total_processed: predictions.length,
      failed_predictions: failedPredictions,
    };
  }

  async healthCheck() {
    return {
      no_show_predictor: true,
      wait_time_estimator: true,
      priority_classifier: true,
      status: 'healthy',
    };
  }
}