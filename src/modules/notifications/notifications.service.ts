import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationStatus } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private smsService: SmsService,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: createNotificationDto,
    });

    // Send notification immediately
    await this.send(notification.id);

    return notification;
  }

  async send(id: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    try {
      if (notification.notificationType === 'EMAIL' && notification.recipientEmail) {
        await this.mailService.sendMail(
          notification.recipientEmail,
          notification.title,
          `<div style="font-family: Arial, sans-serif;">${notification.message}</div>`,
        );

        await this.prisma.notification.update({
          where: { id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
      }

      if (notification.notificationType === 'SMS' && notification.recipientPhone) {
        await this.smsService.sendSms(notification.recipientPhone, notification.message);

        await this.prisma.notification.update({
          where: { id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
      }

      if (notification.notificationType === 'IN_APP') {
        await this.prisma.notification.update({
          where: { id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
      }

      return { success: true };
    } catch (error) {
      await this.prisma.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.FAILED,
          failedAt: new Date(),
          errorMessage: error.message,
          retryCount: notification.retryCount + 1,
        },
      });

      throw error;
    }
  }

  async findAll(userId: number) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUnread(userId: number) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        isRead: false,
        notificationType: 'IN_APP',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(id: number, userId: number) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: number) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }
}