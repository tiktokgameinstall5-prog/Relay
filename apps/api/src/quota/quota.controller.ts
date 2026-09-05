import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { QuotaService } from './quota.service';
import { QuotaUsageDto } from './dto/quota.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';

@ApiTags('quotas')
@Controller('quotas')
export class QuotaController {
  constructor(@Inject(QuotaService) private readonly quotaService: QuotaService) {}

  @Get()
  @Roles('owner')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get organization quota usage and limits (Owner only)' })
  @ApiOkResponse({ type: QuotaUsageDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Owner role required' })
  async getQuotas(@CurrentUser() actor: CurrentUserType): Promise<QuotaUsageDto> {
    return this.quotaService.getQuotas(actor);
  }
}
