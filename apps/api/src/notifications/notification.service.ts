import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import { MailerService } from '../mail/mailer.service';
import { appEnv } from '../config/configuration';
import { renderTaskNotificationEmail } from '../mail/templates/task-notification';
import {
  NotificationListResponseDto,
  NotificationQueryDto,
  NotificationResponseDto,
  NotificationType,
} from './dto/notification.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateNotificationInput {
  orgId: string;
  userId: string;
  managerId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  emailTo?: string;
  emailSubject?: string;
  emailBody?: string;
}

interface NotificationDbRow {
  id: string;
  org_id: string;
  user_id: string;
  manager_id: string | null;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(MailerService) private readonly mailer: MailerService,
    @Optional() @Inject(ConfigService) private readonly config?: ConfigService,
  ) {}

  /**
   * Batch insert notifications inside an active transaction.
   */
  async createNotifications(
    c: PoolClient,
    items: CreateNotificationInput[],
  ): Promise<void> {
    if (items.length === 0) return;

    const values: any[] = [];
    const chunks: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const offset = i * 8;
      const notifId = randomUUID();
      chunks.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
      );
      values.push(
        notifId,
        item.orgId,
        item.userId,
        item.managerId ?? null,
        item.type,
        item.title,
        item.body,
        JSON.stringify(item.data ?? {}),
      );

      // Trigger email if email recipient is provided
      if (item.emailTo) {
        const appBaseUrl = this.config
          ? appEnv(this.config).APP_BASE_URL
          : (process.env.APP_BASE_URL || 'http://localhost:5173');
        const actionUrl = `${appBaseUrl}/tasks`;
        const { subject, text, html } = renderTaskNotificationEmail({
          title: item.title,
          body: item.emailBody ?? item.body,
          subject: item.emailSubject,
          actionUrl,
          statusBadge: item.type.replace(/_/g, ' '),
        });

        this.mailer
          .send({
            to: item.emailTo,
            subject,
            text,
            html,
          })
          .catch((err) =>
            this.logger.warn(`Failed to dispatch email to ${item.emailTo}:`, err),
          );
      }
    }

    const sql = `
      INSERT INTO notification (
        id, org_id, user_id, manager_id, type, title, body, data
      ) VALUES ${chunks.join(', ')}
    `;

    await c.query(sql, values);
  }

  /**
   * List caller's notifications and unread badge count.
   */
  async listNotifications(
    actor: CurrentUser,
    query?: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    return await this.db.tx(async (c) => {
      const limit = query?.limit ?? 50;
      const unreadFilter = query?.unreadOnly ? 'AND read_at IS NULL' : '';

      const itemsRes = await c.query<NotificationDbRow>(
        `SELECT id, org_id, user_id, manager_id, type, title, body, data, read_at, created_at
           FROM notification
          WHERE user_id = $1 AND org_id = $2 ${unreadFilter}
          ORDER BY created_at DESC
          LIMIT $3`,
        [actor.userId, actor.orgId, limit],
      );

      const countRes = await c.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM notification
          WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL`,
        [actor.userId, actor.orgId],
      );

      const unreadCount = parseInt(countRes.rows[0]?.count ?? '0', 10);

      return {
        items: itemsRes.rows.map((r) => this.mapToDto(r)),
        unreadCount,
      };
    });
  }

  /**
   * Get unread notification count.
   */
  async getUnreadCount(actor: CurrentUser): Promise<{ count: number }> {
    return await this.db.tx(async (c) => {
      const res = await c.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM notification
          WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL`,
        [actor.userId, actor.orgId],
      );
      return { count: parseInt(res.rows[0]?.count ?? '0', 10) };
    });
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(
    actor: CurrentUser,
    notificationId: string,
  ): Promise<NotificationResponseDto> {
    if (!UUID_RE.test(notificationId)) {
      throw new NotFoundException('Notification not found');
    }

    return await this.db.tx(async (c) => {
      const res = await c.query<NotificationDbRow>(
        `UPDATE notification
            SET read_at = COALESCE(read_at, now())
          WHERE id = $1 AND user_id = $2 AND org_id = $3
          RETURNING id, org_id, user_id, manager_id, type, title, body, data, read_at, created_at`,
        [notificationId, actor.userId, actor.orgId],
      );

      if (res.rows.length === 0) {
        throw new NotFoundException('Notification not found');
      }

      return this.mapToDto(res.rows[0]);
    });
  }

  /**
   * Mark all unread notifications as read for current user.
   */
  async markAllAsRead(actor: CurrentUser): Promise<{ updatedCount: number }> {
    return await this.db.tx(async (c) => {
      const res = await c.query(
        `UPDATE notification
            SET read_at = now()
          WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL`,
        [actor.userId, actor.orgId],
      );
      return { updatedCount: res.rowCount ?? 0 };
    });
  }

  private mapToDto(row: NotificationDbRow): NotificationResponseDto {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      managerId: row.manager_id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data ?? {},
      readAt: row.read_at ? row.read_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }
}
