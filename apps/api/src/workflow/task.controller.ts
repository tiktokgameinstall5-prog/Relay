import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { WorkflowService } from './workflow.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { OwnedResource } from '../auth/decorators/owned-resource.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUser as CurrentUserType } from '../db/tenant-context';

@ApiTags('workflow')
@Controller('tasks')
export class TaskController {
  constructor(@Inject(WorkflowService) private readonly workflow: WorkflowService) {}

  /**
   * Manager assigns an ordered relay to their own team (CLAUDE.md §2).
   * Restricted to @Roles('manager') in this first cut.
   */
  @ApiOperation({
    summary: 'Assign a team relay task (Manager only)',
    description:
      'Manager creates a task split into an ordered chain of task steps, one per assigned member. ' +
      'Step 1 goes active immediately. Owner assignment and member handoffs are deferred to a fast-follow.',
  })
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: TaskResponseDto })
  @ApiBadRequestResponse({
    description:
      'Manager has no active team, or one or more memberIds do not belong to the manager’s active team.',
  })
  @ApiForbiddenResponse({ description: 'Caller is not a Manager.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @Roles('manager')
  @SkipThrottle({ login: true, signup: true })
  @Post()
  async createTask(
    @CurrentUser() actor: CurrentUserType,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    return await this.workflow.assignTeamRelay(actor, dto);
  }

  /**
   * List all tasks visible to the caller's tenant slice.
   * Owner → all tasks in org; Manager → own team tasks; Member → own team tasks.
   */
  @ApiOperation({
    summary: 'List tasks in tenant slice',
    description:
      'Owner sees all tasks across the org; Manager and Member see tasks in their own team. ' +
      'RLS automatically scopes the results.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: TaskResponseDto, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @Get()
  async listTasks(): Promise<TaskResponseDto[]> {
    return await this.workflow.listTasks();
  }

  /**
   * Get single task with its relay steps by ID.
   * Guarded with @OwnedResource to ensure uniform 404 on cross-tenant ID guessing.
   */
  @ApiOperation({
    summary: 'Get task by ID in tenant slice',
    description: 'Fetch task and its ordered steps. Returns 404 if the task is outside caller’s tenant slice.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: TaskResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found or outside caller’s tenant slice.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'id' })
  @Get(':id')
  async getTask(@Param('id') id: string): Promise<TaskResponseDto> {
    return await this.workflow.getTask(id);
  }

  /**
   * Forward / complete the active step in a task's relay chain.
   * Only the member holding the active step can forward it.
   */
  @ApiOperation({
    summary: 'Forward / complete active step in task relay',
    description:
      'Completes the active step and advances the relay chain to the next step. ' +
      'When the final step completes, the task status becomes completed. ' +
      'Write authorization requires caller to be the active step assignee.',
  })
  @ApiBearerAuth()
  @ApiOkResponse({ type: TaskResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found or outside tenant slice.' })
  @ApiForbiddenResponse({ description: 'Caller is not the assignee holding the active step.' })
  @ApiConflictResponse({ description: 'Task is already completed or has no active step.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token.' })
  @OwnedResource({ table: 'task', param: 'id' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/forward')
  async forwardStep(
    @CurrentUser() actor: CurrentUserType,
    @Param('id') id: string,
  ): Promise<TaskResponseDto> {
    return await this.workflow.forwardStep(actor, id);
  }
}
