import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { CurrentUser } from '../db/tenant-context';
import { AttachmentService } from './attachment.service';
import type { TaskAttachmentDto } from './dto/attachment.dto';

interface RequestWithUser extends Request {
  user: CurrentUser;
}

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Post(':taskId/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit for general file/video uploads
      },
    }),
  )
  async upload(
    @Req() req: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<TaskAttachmentDto> {
    return this.attachmentService.uploadAttachment(req.user, taskId, file);
  }

  @Get(':taskId/attachments')
  async list(
    @Req() req: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<TaskAttachmentDto[]> {
    return this.attachmentService.listAttachments(req.user, taskId);
  }

  @Get(':taskId/attachments/:attachmentId/download')
  async download(
    @Req() req: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { attachment, buffer } = await this.attachmentService.getAttachment(
      req.user,
      taskId,
      attachmentId,
    );

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.setHeader('Content-Length', attachment.fileSize);
    res.setHeader('ETag', `"${attachment.checksumSha256}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    res.status(HttpStatus.OK).send(buffer);
  }

  @Delete(':taskId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: RequestWithUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    await this.attachmentService.deleteAttachment(req.user, taskId, attachmentId);
  }
}
