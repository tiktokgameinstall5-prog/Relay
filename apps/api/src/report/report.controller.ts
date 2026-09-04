import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';
import {
  CreateTaskReportDto,
  TaskReportResponseDto,
} from './dto/report.dto';
import { ReportService } from './report.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('tasks/:taskId/report')
  @ApiOperation({
    summary: 'Submit task completion report',
    description:
      'Designated reporter, manager, or owner submits a final completion report for a completed task.',
  })
  @ApiResponse({ status: 201, type: TaskReportResponseDto })
  async createReport(
    @Param('taskId') taskId: string,
    @Body() dto: CreateTaskReportDto,
    @CurrentUser() actor: CurrentUserType,
  ): Promise<TaskReportResponseDto> {
    return await this.reportService.createReport(taskId, dto, actor);
  }

  @Get('tasks/:taskId/report')
  @ApiOperation({
    summary: 'Get report for a task',
    description: 'Retrieves the completion report for a task if within caller’s slice.',
  })
  @ApiResponse({ status: 200, type: TaskReportResponseDto })
  async getReportByTaskId(
    @Param('taskId') taskId: string,
    @CurrentUser() actor: CurrentUserType,
  ): Promise<TaskReportResponseDto> {
    return await this.reportService.getReportByTaskId(taskId, actor);
  }

  @Get('reports')
  @ApiOperation({
    summary: 'List all task reports',
    description: 'Lists all completion reports within caller’s tenant slice.',
  })
  @ApiResponse({ status: 200, type: [TaskReportResponseDto] })
  async listReports(
    @CurrentUser() actor: CurrentUserType,
  ): Promise<TaskReportResponseDto[]> {
    return await this.reportService.listReports(actor);
  }
}
