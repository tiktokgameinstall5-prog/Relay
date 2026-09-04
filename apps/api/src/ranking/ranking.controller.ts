import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import {
  LeaderboardUserDto,
  RankingEventResponseDto,
  SetReporterDto,
  UpdateRankingDto,
} from './dto/ranking.dto';
import { RankingService } from './ranking.service';

@ApiTags('rankings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rankings')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  @Get('leaderboard')
  @ApiOperation({
    summary: 'View team or org leaderboard',
    description:
      'Returns active members ranked by performance score within caller’s tenant slice.',
  })
  @ApiResponse({ status: 200, type: [LeaderboardUserDto] })
  async getLeaderboard(
    @CurrentUser() actor: CurrentUserType,
  ): Promise<LeaderboardUserDto[]> {
    return await this.rankingService.getLeaderboard(actor);
  }

  @Patch(':userId')
  @Roles('owner', 'manager')
  @ApiOperation({
    summary: 'Update member ranking score',
    description:
      'Manager or Owner updates a team member ranking score and creates an audit history entry with reason.',
  })
  @ApiResponse({ status: 200, type: LeaderboardUserDto })
  async updateRanking(
    @Param('userId') userId: string,
    @Body() dto: UpdateRankingDto,
    @CurrentUser() actor: CurrentUserType,
  ): Promise<LeaderboardUserDto> {
    return await this.rankingService.updateRanking(userId, dto, actor);
  }

  @Get(':userId/history')
  @ApiOperation({
    summary: 'View ranking audit history',
    description: 'Lists historical ranking changes and reasons for a member.',
  })
  @ApiResponse({ status: 200, type: [RankingEventResponseDto] })
  async getRankingHistory(
    @Param('userId') userId: string,
    @CurrentUser() actor: CurrentUserType,
  ): Promise<RankingEventResponseDto[]> {
    return await this.rankingService.getRankingHistory(userId, actor);
  }

  @Patch(':userId/reporter')
  @Roles('owner', 'manager')
  @ApiOperation({
    summary: 'Set designated task reporter status',
    description:
      'Designates or removes reporter permissions for a team member.',
  })
  @ApiResponse({ status: 200 })
  async setReporterStatus(
    @Param('userId') userId: string,
    @Body() dto: SetReporterDto,
    @CurrentUser() actor: CurrentUserType,
  ): Promise<{ id: string; isReporter: boolean }> {
    return await this.rankingService.setReporterStatus(userId, dto, actor);
  }
}
