/**
 * Workflow API functions for tasks and relay step forwarding (CLAUDE.md §2).
 */
import { request } from './client';
import type { CreateTaskInput, TaskResponse } from './types';

/** GET /api/tasks — list tasks visible in the caller's tenant slice */
export function listTasks(): Promise<TaskResponse[]> {
  return request<TaskResponse[]>('/tasks');
}

/** GET /api/tasks/:id — get a single task with all ordered steps */
export function getTask(id: string): Promise<TaskResponse> {
  return request<TaskResponse>(`/tasks/${id}`);
}

/** POST /api/tasks — Manager assigns an ordered relay to their team */
export function createTask(input: CreateTaskInput): Promise<TaskResponse> {
  return request<TaskResponse>('/tasks', { method: 'POST', body: input });
}

/** POST /api/tasks/:id/forward — Active assignee forwards / completes their step */
export function forwardStep(taskId: string): Promise<TaskResponse> {
  return request<TaskResponse>(`/tasks/${taskId}/forward`, { method: 'POST' });
}
