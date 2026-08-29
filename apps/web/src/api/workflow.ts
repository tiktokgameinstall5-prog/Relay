/**
 * Workflow API functions for tasks and relay step forwarding (CLAUDE.md §2).
 */
import { request } from './client';
import type { CreateTaskInput, ForwardStepInput, TaskResponse } from './types';

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

/** POST /api/tasks/:id/forward — Active assignee forwards sequentially or hands off to a peer */
export function forwardStep(taskId: string, input?: ForwardStepInput): Promise<TaskResponse> {
  return request<TaskResponse>(`/tasks/${taskId}/forward`, { method: 'POST', body: input });
}

/** GET /api/tasks/:id/attachments — list attachments for a task */
export function listAttachments(taskId: string): Promise<import('./types').TaskAttachment[]> {
  return request<import('./types').TaskAttachment[]>(`/tasks/${taskId}/attachments`);
}

/** POST /api/tasks/:id/attachments — upload a file or master video to a task */
export function uploadAttachment(taskId: string, file: File): Promise<import('./types').TaskAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  return request<import('./types').TaskAttachment>(`/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: formData,
  });
}

/** DELETE /api/tasks/:taskId/attachments/:attachmentId — delete an attachment */
export function deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
  return request<void>(`/tasks/${taskId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}

/** Get direct download URL for an attachment */
export function getAttachmentDownloadUrl(taskId: string, attachmentId: string): string {
  return `/api/tasks/${taskId}/attachments/${attachmentId}/download`;
}


