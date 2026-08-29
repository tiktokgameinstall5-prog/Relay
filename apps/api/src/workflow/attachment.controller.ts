import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OwnedResource } from '../auth/decorators/owned-resource.decorator';
import type { CurrentUser } from '../db/tenant-context';
import { AttachmentService } from './attachment.service';
import type { TaskAttachmentDto } from './dto/attachment.dto';

interface RequestWithUser extends Request {
  user: CurrentUser;
}

@ApiTags('workflow')
@Controller('tasks')
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @ApiOperation({
    summary: 'Upload attachment to task',
    description:
      'Uploads a file or video attachment to a task within the caller’s tenant slice. ' +
      'MIME types are validated against task.type (e.g. video tasks accept only video files). ' +
      'Returns 404 if the task is not found or outside caller’s tenant slice.',
  })
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ description: 'Attachment uploaded successfully.' })
  @ApiNotFoundResponse({ description: 'Task not found or outside tenant slice.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'taskId' })
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
    @Param('taskId') taskId: string,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<TaskAttachmentDto> {
    return this.attachmentService.uploadAttachment(req.user, taskId, file);
  }

  @ApiOperation({
    summary: 'List attachments for a task',
    description: 'Lists all attachments for a task within caller’s tenant slice.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'List of task attachments.' })
  @ApiNotFoundResponse({ description: 'Task not found or outside tenant slice.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'taskId' })
  @Get(':taskId/attachments')
  async list(
    @Req() req: RequestWithUser,
    @Param('taskId') taskId: string,
  ): Promise<TaskAttachmentDto[]> {
    return this.attachmentService.listAttachments(req.user, taskId);
  }

  @ApiOperation({
    summary: 'Download attachment stream (lossless)',
    description:
      'Downloads the exact, bit-for-bit lossless original attachment with SHA-256 integrity verification.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Binary stream of the attachment.' })
  @ApiNotFoundResponse({ description: 'Attachment or task not found or outside tenant slice.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'taskId' })
  @Get(':taskId/attachments/:attachmentId/download')
  async download(
    @Req() req: RequestWithUser,
    @Param('taskId') taskId: string,
    @Param('attachmentId') attachmentId: string,
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

  @ApiOperation({
    summary: 'Delete attachment from task',
    description:
      'Deletes an attachment. Members can delete own uploads; Managers and Owners have supervisory delete.',
  })
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Attachment deleted.' })
  @ApiNotFoundResponse({ description: 'Attachment or task not found or outside tenant slice.' })
  @ApiForbiddenResponse({ description: 'Caller not authorized to delete this attachment.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'taskId' })
  @Delete(':taskId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: RequestWithUser,
    @Param('taskId') taskId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachmentService.deleteAttachment(req.user, taskId, attachmentId);
  }
}
