import {
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLogListResponseDto, AuditLogQueryDto } from './dto/audit.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  @Roles('owner')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated audit logs for the organization (Owner only)' })
  @ApiOkResponse({ type: AuditLogListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Owner role required' })
  async getAuditLogs(
    @CurrentUser() actor: CurrentUserType,
    @Query() query: AuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    return this.auditService.getAuditLogs(actor, query);
  }
}
