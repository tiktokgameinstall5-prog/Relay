import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import { AnalyticsOverviewDto, BottlenecksResponseDto } from './dto/analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Operational overview analytics',
    description:
      'Aggregated operational metrics including completion rates and ranking averages scoped to tenant slice.',
  })
  @ApiResponse({ status: 200, type: AnalyticsOverviewDto })
  async getOverview(
    @CurrentUser() actor: CurrentUserType,
  ): Promise<AnalyticsOverviewDto> {
    return await this.analyticsService.getOverview(actor);
  }

  @Get('bottlenecks')
  @ApiOperation({
    summary: 'Step bottleneck analytics',
    description: 'Identifies steps whose duration exceeds average duration.',
  })
  @ApiResponse({ status: 200, type: BottlenecksResponseDto })
  async getBottlenecks(
    @CurrentUser() actor: CurrentUserType,
  ): Promise<BottlenecksResponseDto> {
    return await this.analyticsService.getBottlenecks(actor);
  }
}
