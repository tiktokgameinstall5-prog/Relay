import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { CurrentUser } from '../db/tenant-context';
import type { TaskType } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import type { TaskAttachmentDto } from './dto/attachment.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BLOCKED_EXTENSIONS = /\.(exe|dll|bat|cmd|sh|ps1|vbs|js|scr|com|pif|app|jar|bin)$/i;
const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/x-dosexec',
  'application/javascript',
  'text/javascript',
]);

function validateAttachmentMimeType(taskType: TaskType, fileName: string, mimeType: string) {
  // Always reject executable and script formats
  if (BLOCKED_EXTENSIONS.test(fileName) || BLOCKED_MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new BadRequestException('Executable and script files are not permitted as attachments');
  }

  const normalizedMime = mimeType.toLowerCase();

  if (taskType === 'video') {
    const isVideoMime =
      normalizedMime.startsWith('video/') ||
      normalizedMime === 'application/mp4' ||
      normalizedMime === 'application/ogg' ||
      normalizedMime === 'application/x-matroska';
    if (!isVideoMime) {
      throw new BadRequestException('Only video files can be attached to a video task');
    }
  } else if (taskType === 'text') {
    const isTextMime =
      normalizedMime.startsWith('text/') ||
      normalizedMime === 'application/json' ||
      normalizedMime === 'application/pdf' ||
      normalizedMime === 'application/msword' ||
      normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      normalizedMime === 'application/rtf' ||
      normalizedMime === 'application/xml';
    if (!isTextMime) {
      throw new BadRequestException('Only text and document files can be attached to a text task');
    }
  }
}

interface AttachmentDbRow {
  id: string;
  org_id: string;
  manager_id: string;
  task_id: string;
  uploaded_by_user_id: string;
  file_name: string;
  file_size: string | number;
  mime_type: string;
  storage_key: string;
  checksum_sha256: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async uploadAttachment(
    actor: CurrentUser,
    taskId: string,
    file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<TaskAttachmentDto> {
    if (!UUID_RE.test(taskId)) {
      throw new NotFoundException();
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('File is required');
    }

    return this.db.tx(async (c) => {
      // 1. Task lookup under caller's tenant slice
      const taskRes = await c.query<{ id: string; org_id: string; manager_id: string; type: TaskType }>(
        `SELECT id, org_id, manager_id, type FROM task WHERE id = $1`,
        [taskId],
      );

      if (taskRes.rowCount === 0) {
        throw new NotFoundException('Task not found');
      }

      const task = taskRes.rows[0];

      // Validate MIME type against task.type
      validateAttachmentMimeType(task.type, file.originalname, file.mimetype || 'application/octet-stream');

      // 2. Put file into storage
      const storageKey = this.storage.generateKey(actor.orgId, taskId, file.originalname);
      const stored = await this.storage.put(storageKey, file.buffer, file.mimetype);

      // 3. Insert record in task_attachment
      const insertRes = await c.query<AttachmentDbRow>(
        `INSERT INTO task_attachment (
           org_id, manager_id, task_id, uploaded_by_user_id,
           file_name, file_size, mime_type, storage_key, checksum_sha256
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          actor.orgId,
          task.manager_id,
          taskId,
          actor.userId,
          file.originalname,
          stored.size,
          file.mimetype || 'application/octet-stream',
          storageKey,
          stored.checksumSha256,
        ],
      );

      const row = insertRes.rows[0];

      await this.writeAudit(c, {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'task_attachment.uploaded',
        targetType: 'task_attachment',
        targetId: row.id,
        metadata: {
          taskId,
          fileName: file.originalname,
          fileSize: stored.size,
          checksumSha256: stored.checksumSha256,
        },
      });

      return this.mapToDto(row);
    });
  }

  async listAttachments(actor: CurrentUser, taskId: string): Promise<TaskAttachmentDto[]> {
    if (!UUID_RE.test(taskId)) {
      throw new NotFoundException();
    }

    return this.db.tx(async (c) => {
      const taskRes = await c.query<{ id: string }>(
        `SELECT id FROM task WHERE id = $1`,
        [taskId],
      );

      if (taskRes.rowCount === 0) {
        throw new NotFoundException('Task not found');
      }

      const res = await c.query<AttachmentDbRow>(
        `SELECT * FROM task_attachment WHERE task_id = $1 ORDER BY created_at ASC`,
        [taskId],
      );

      return res.rows.map((row) => this.mapToDto(row));
    });
  }

  async getAttachment(
    actor: CurrentUser,
    taskId: string,
    attachmentId: string,
  ): Promise<{ attachment: TaskAttachmentDto; buffer: Buffer }> {
    if (!UUID_RE.test(taskId) || !UUID_RE.test(attachmentId)) {
      throw new NotFoundException();
    }

    return this.db.tx(async (c) => {
      const res = await c.query<AttachmentDbRow>(
        `SELECT * FROM task_attachment WHERE id = $1 AND task_id = $2`,
        [attachmentId, taskId],
      );

      if (res.rowCount === 0) {
        throw new NotFoundException('Attachment not found');
      }

      const row = res.rows[0];
      const stored = await this.storage.get(row.storage_key);
      if (!stored) {
        throw new NotFoundException('File data not found');
      }

      return {
        attachment: this.mapToDto(row),
        buffer: stored.buffer,
      };
    });
  }

  async deleteAttachment(
    actor: CurrentUser,
    taskId: string,
    attachmentId: string,
  ): Promise<void> {
    if (!UUID_RE.test(taskId) || !UUID_RE.test(attachmentId)) {
      throw new NotFoundException();
    }

    return this.db.tx(async (c) => {
      const res = await c.query<AttachmentDbRow>(
        `SELECT * FROM task_attachment WHERE id = $1 AND task_id = $2`,
        [attachmentId, taskId],
      );

      if (res.rowCount === 0) {
        throw new NotFoundException('Attachment not found');
      }

      const row = res.rows[0];

      // Authorization: Owner, Manager, or uploader
      if (actor.role === 'member' && row.uploaded_by_user_id !== actor.userId) {
        throw new ForbiddenException('Members can only delete attachments they uploaded');
      }

      await c.query(`DELETE FROM task_attachment WHERE id = $1 AND task_id = $2`, [
        attachmentId,
        taskId,
      ]);

      await this.storage.delete(row.storage_key);

      await this.writeAudit(c, {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'task_attachment.deleted',
        targetType: 'task_attachment',
        targetId: row.id,
        metadata: {
          taskId,
          fileName: row.file_name,
        },
      });
    });
  }

  private mapToDto(row: AttachmentDbRow): TaskAttachmentDto {
    return {
      id: row.id,
      taskId: row.task_id,
      fileName: row.file_name,
      fileSize: Number(row.file_size),
      mimeType: row.mime_type,
      checksumSha256: row.checksum_sha256,
      uploadedByUserId: row.uploaded_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async writeAudit(
    c: PoolClient,
    entry: {
      orgId: string;
      actorUserId: string;
      action: string;
      targetType: string;
      targetId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await c.query('SAVEPOINT audit_write');
    try {
      await c.query(
        `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.orgId,
          entry.actorUserId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        ],
      );
      await c.query('RELEASE SAVEPOINT audit_write');
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT audit_write');
      this.logger.error(`Audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
