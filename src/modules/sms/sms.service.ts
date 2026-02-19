import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class SmsService {
  private client: twilio.Twilio;
  private phoneNumber: string;

  constructor(private configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.phoneNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER') || '';

    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
    }
  }

  async sendSms(to: string, message: string) {
    if (!this.client) {
      console.warn('Twilio client not configured. SMS not sent.');
      return;
    }

    try {
      await this.client.messages.create({
        body: message,
        from: this.phoneNumber,
        to: to,
      });
      console.log(`✅ SMS sent to ${to}`);
    } catch (error) {
      console.error(`❌ Failed to send SMS to ${to}:`, error);
      throw error;
    }
  }

  async sendVerificationCode(phone: string, code: string) {
    const message = `Your SHAMS verification code is: ${code}. Valid for 15 minutes.`;
    await this.sendSms(phone, message);
  }

  async sendAppointmentReminder(phone: string, appointmentDetails: any) {
    const message = `Reminder: You have an appointment with Dr. ${appointmentDetails.doctorName} on ${appointmentDetails.date} at ${appointmentDetails.time}. Please arrive 15 minutes early.`;
    await this.sendSms(phone, message);
  }

  async sendQueueUpdate(phone: string, queueNumber: number, estimatedWait: number) {
    const message = `Your queue number is ${queueNumber}. Estimated wait time: ${estimatedWait} minutes. We'll notify you when it's your turn.`;
    await this.sendSms(phone, message);
  }
}