import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, catchError, of } from 'rxjs';
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
  private readonly logger = new Logger(AiService.name);
  private readonly mlBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private httpService: HttpService,
    private configService: ConfigService,
    private noShowPredictor: NoShowPredictorService,
    private waitTimeEstimator: WaitTimeEstimatorService,
    private priorityClassifier: PriorityClassifierService,
  ) {
    this.mlBaseUrl = this.configService.get<string>(
      'AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Helper: call Python FastAPI
  // ─────────────────────────────────────────────────────────────────
  private async callPythonML<T>(
    endpoint: string,
    payload: any,
  ): Promise<T | null> {
    const url = `${this.mlBaseUrl}/api/v1${endpoint}`;
    try {
      const response = await firstValueFrom(
        this.httpService
          .post<T>(url, payload, {
            headers: {
              Authorization: `Bearer ${this.configService.get('ML_SERVICE_API_KEY')}`,
            },
          })
          .pipe(
            catchError((err) => {
              const status = err?.response?.status;

              // 401/403 = auth problem — fail loud, don't silently fallback
              if (status === 401 || status === 403) {
                throw new Error(
                  `ML service auth failed (${status}): check ML_SERVICE_API_KEY`,
                );
              }

              // Network down, 500, timeout etc → safe to fallback locally
              this.logger.warn(
                `ML service unavailable (${endpoint}): ${err.message}`,
              );
              return of(null as any);
            }),
          ),
      );
      return response?.data ?? null;
    } catch (err) {
      // Re-throw auth errors so callers know
      if (err.message?.includes('auth failed')) throw err;
      this.logger.warn(`ML service call failed: ${err}`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // No-show prediction
  // ─────────────────────────────────────────────────────────────────
  async predictNoShow(request: NoShowPredictionRequest, _userId?: number) {
    // Enrich from DB if appointment_id provided
    if (request.appointment_id) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: request.appointment_id },
        include: { patient: true },
      });
      if (appointment) {
        request.patient_id = appointment.patientId;
        request.appointment_date = appointment.appointmentDate.toISOString();
        request.appointment_type = appointment.appointmentType as string;
        const [prevTotal, prevNoShow] = await Promise.all([
          this.prisma.appointment.count({
            where: { patientId: appointment.patientId },
          }),
          this.prisma.appointment.count({
            where: { patientId: appointment.patientId, status: 'NO_SHOW' },
          }),
        ]);
        request.previous_appointments = prevTotal;
        request.previous_no_shows = prevNoShow;
      }
    }

    // 1. Try Python ML service
    const mlResult = await this.callPythonML<any>(
      '/ai/predict-noshow',
      request,
    );
    const prediction =
      mlResult ?? (await this.noShowPredictor.predict(request));

    // 2. Persist to DB
    if (
      request.appointment_id &&
      prediction?.no_show_probability !== undefined
    ) {
      await this.prisma.appointment
        .update({
          where: { id: request.appointment_id },
          data: { noShowProbability: prediction.no_show_probability },
        })
        .catch(() => {});
    }

    return prediction;
  }

  // ─────────────────────────────────────────────────────────────────
  // Wait time estimation
  // ─────────────────────────────────────────────────────────────────
  async estimateWaitTime(request: WaitTimePredictionRequest) {
    if (!request.current_queue_length) {
      const appointmentDate = new Date(request.appointment_date);
      request.current_queue_length = await this.prisma.appointment.count({
        where: {
          doctorId: request.doctor_id,
          appointmentDate: {
            gte: new Date(new Date(appointmentDate).setHours(0, 0, 0, 0)),
            lte: new Date(new Date(appointmentDate).setHours(23, 59, 59, 999)),
          },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] },
        },
      });
    }

    if (!request.time_of_day) {
      const h = new Date(request.appointment_date).getHours();
      request.time_of_day =
        h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    }
    if (!request.day_of_week) {
      request.day_of_week = new Date(
        request.appointment_date,
      ).toLocaleDateString('en-US', { weekday: 'long' });
    }

    const mlResult = await this.callPythonML<any>(
      '/ai/estimate-wait-time',
      request,
    );
    const estimation =
      mlResult ?? (await this.waitTimeEstimator.predict(request));

    if (
      request.appointment_id &&
      estimation?.estimated_wait_time !== undefined
    ) {
      await this.prisma.appointment
        .update({
          where: { id: request.appointment_id },
          data: {
            estimatedWaitTime: estimation.estimated_wait_time,
            queuePosition: estimation.queue_position,
          },
        })
        .catch(() => {});
    }

    return estimation;
  }

  // ─────────────────────────────────────────────────────────────────
  // Priority classification
  // ─────────────────────────────────────────────────────────────────
  async classifyPriority(request: PriorityClassificationRequest) {
    const mlResult = await this.callPythonML<any>(
      '/ai/classify-priority',
      request,
    );
    const classification =
      mlResult ?? (await this.priorityClassifier.classify(request));

    if (
      request.appointment_id &&
      classification?.priority_score !== undefined
    ) {
      await this.prisma.appointment
        .update({
          where: { id: request.appointment_id },
          data: {
            aiPriorityScore: classification.priority_score,
            priority: classification.priority_level?.toUpperCase() as any,
          },
        })
        .catch(() => {});
    }

    return classification;
  }

  // ─────────────────────────────────────────────────────────────────
  // Queue optimization
  // ─────────────────────────────────────────────────────────────────
  async optimizeQueue(request: QueueOptimizationRequest) {
    // Try Python first
    const mlResult = await this.callPythonML<any>(
      '/ai/optimize-queue',
      request,
    );
    if (mlResult) return mlResult;

    // Fallback: local scoring
    const date = new Date(request.date);
    const where: any = {
      appointmentDate: {
        gte: new Date(new Date(date).setHours(0, 0, 0, 0)),
        lte: new Date(new Date(date).setHours(23, 59, 59, 999)),
      },
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    };
    if (request.doctor_id) where.doctorId = request.doctor_id;

    const appointments = await this.prisma.appointment.findMany({ where });

    const weights: Record<string, number> = {
      EMERGENCY: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };
    const scored = appointments
      .map((apt) => ({
        appointment_id: apt.id,
        patient_id: apt.patientId,
        priority_score:
          (weights[apt.priority] || 2) +
          (apt.noShowProbability ? (1 - apt.noShowProbability) * 0.5 : 0),
        priority_level: apt.priority,
        no_show_probability: apt.noShowProbability,
        appointment_time: apt.appointmentDate.toISOString(),
        original_position: apt.queuePosition || 0,
        new_position: 0,
      }))
      .sort((a, b) => b.priority_score - a.priority_score);

    let changes = 0;
    for (let i = 0; i < scored.length; i++) {
      scored[i].new_position = i + 1;
      if (scored[i].original_position !== i + 1) {
        changes++;
        await this.prisma.appointment
          .update({
            where: { id: scored[i].appointment_id },
            data: { queuePosition: i + 1 },
          })
          .catch(() => {});
      }
    }

    const totalMin = appointments.reduce(
      (s, a) => s + (a.durationMinutes || 30),
      0,
    );
    return {
      optimized_queue: scored,
      total_appointments: scored.length,
      estimated_completion_time: new Date(
        Date.now() + totalMin * 60000,
      ).toISOString(),
      efficiency_score: scored.length > 0 ? 1 - changes / scored.length : 0,
      changes_made: changes,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Batch prediction
  // ─────────────────────────────────────────────────────────────────
  async batchPredict(request: BatchPredictionRequest) {
    const mlResult = await this.callPythonML<any>('/ai/batch-predict', request);
    if (mlResult) return mlResult;

    const predictions: any[] = [];
    const failed: number[] = [];

    for (const aptId of request.appointment_ids) {
      try {
        const apt = await this.prisma.appointment.findUnique({
          where: { id: aptId },
        });
        if (!apt) {
          failed.push(aptId);
          continue;
        }

        if (request.prediction_type === 'no_show') {
          const r = await this.predictNoShow({
            appointment_id: aptId,
            patient_id: apt.patientId,
            appointment_date: apt.appointmentDate.toISOString(),
            appointment_type: apt.appointmentType as string,
          });
          predictions.push({
            appointment_id: aptId,
            type: 'no_show',
            result: r,
          });
        } else if (request.prediction_type === 'wait_time') {
          // ✅ doctor is required for wait time; if unassigned -> fail safely
          if (apt.doctorId === null) {
            failed.push(aptId);
            continue;
          }

          const r = await this.estimateWaitTime({
            appointment_id: aptId,
            doctor_id: apt.doctorId,
            appointment_date: apt.appointmentDate.toISOString(),
            appointment_type: apt.appointmentType as string,
          });
          predictions.push({
            appointment_id: aptId,
            type: 'wait_time',
            result: r,
          });
        } else {
          failed.push(aptId);
        }
      } catch {
        failed.push(aptId);
      }
    }

    return {
      predictions,
      total_processed: predictions.length,
      failed_predictions: failed,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────────
  async healthCheck() {
    let mlServiceOnline = false;
    try {
      const res = await firstValueFrom(
        this.httpService
          .get(`${this.mlBaseUrl}/health`)
          .pipe(catchError(() => of(null))),
      );
      mlServiceOnline = res?.status === 200;
    } catch {
      /* offline */
    }

    return {
      no_show_predictor: true,
      wait_time_estimator: true,
      priority_classifier: true,
      ml_service_online: mlServiceOnline,
      ml_service_url: this.mlBaseUrl,
      status: 'healthy',
    };
  }
}
