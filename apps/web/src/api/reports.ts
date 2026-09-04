/**
 * Reports API functions (CLAUDE.md §4).
 */
import { request } from './client';
import type {
  CreateTaskReportInput,
  TaskReportResponse,
} from './types';

/** GET /api/reports — list completion reports in caller's slice */
export function listReports(): Promise<TaskReportResponse[]> {
  return request<TaskReportResponse[]>('/reports');
}

/** GET /api/tasks/:taskId/report — get report for specific task */
export function getTaskReport(taskId: string): Promise<TaskReportResponse> {
  return request<TaskReportResponse>(`/tasks/${taskId}/report`);
}

/** POST /api/tasks/:taskId/report — submit task completion report */
export function createReport(
  taskId: string,
  input: CreateTaskReportInput,
): Promise<TaskReportResponse> {
  return request<TaskReportResponse>(`/tasks/${taskId}/report`, {
    method: 'POST',
    body: input,
  });
}
