import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { NoShowPredictorService } from './services/noshow-predictor.service';
import { WaitTimeEstimatorService } from './services/waittime-estimator.service';
import { PriorityClassifierService } from './services/priority-classifier.service';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [AppointmentsModule],
  controllers: [AiController],
  providers: [AiService, NoShowPredictorService, WaitTimeEstimatorService, PriorityClassifierService],
  exports: [AiService],
})
export class AiModule {}