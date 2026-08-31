import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import {
  NotificationListResponseDto,
  NotificationQueryDto,
  NotificationResponseDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(
    @Inject(NotificationService)
    private readonly notificationService: NotificationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List user notifications',
    description: 'Fetch current user notifications and unread badge count.',
  })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  async list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    return await this.notificationService.listNotifications(user, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Fast count query for client header badge short-polling.',
  })
  @ApiResponse({ status: 200, schema: { properties: { count: { type: 'number' } } } })
  async getUnreadCount(@CurrentUser() user: CurrentUserType): Promise<{ count: number }> {
    return await this.notificationService.getUnreadCount(user);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark single notification as read',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    return await this.notificationService.markAsRead(user, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all unread notifications as read',
  })
  @ApiResponse({ status: 200, schema: { properties: { updatedCount: { type: 'number' } } } })
  async markAllAsRead(@CurrentUser() user: CurrentUserType): Promise<{ updatedCount: number }> {
    return await this.notificationService.markAllAsRead(user);
  }
}
