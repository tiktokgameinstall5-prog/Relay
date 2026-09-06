/**
 * Workflow API functions for tasks and relay step forwarding (CLAUDE.md §2).
 */
import { getAccessToken, request } from './client';
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

const CHUNK_THRESHOLD = 3.5 * 1024 * 1024; // 3.5MB (Vercel payload limit is 4.5MB)
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks

/** POST /api/tasks/:id/attachments — upload a file or master video to a task (direct to Supabase Storage via signed URL) */
export async function uploadAttachment(
  taskId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<import('./types').TaskAttachment> {
  // 1. Primary path: Direct upload to Supabase Storage via Signed URL (0 MB load on NestJS)
  try {
    const signedData = await request<{
      signedUrl: string;
      token: string;
      storageKey: string;
      path: string;
    }>(`/tasks/${taskId}/attachments/signed-upload-url`, {
      method: 'POST',
      body: {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
      },
    });

    if (signedData?.signedUrl) {
      if (onProgress) onProgress(15);

      // Upload directly to Supabase Storage
      const uploadRes = await fetch(signedData.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error(`Supabase direct upload failed (${uploadRes.status})`);
      }

      if (onProgress) onProgress(85);

      // Register attachment metadata in database
      const savedAttachment = await request<import('./types').TaskAttachment>(
        `/tasks/${taskId}/attachments/complete-signed-upload`,
        {
          method: 'POST',
          body: {
            storageKey: signedData.storageKey,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
          },
        },
      );

      if (onProgress) onProgress(100);
      return savedAttachment;
    }
  } catch (err) {
    console.warn('Direct Supabase signed upload failed, falling back to server upload:', err);
  }

  // Fallback: If file is smaller than threshold, do direct single-request upload
  if (file.size <= CHUNK_THRESHOLD) {
    const formData = new FormData();
    formData.append('file', file);
    const result = await request<import('./types').TaskAttachment>(`/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    });
    if (onProgress) onProgress(100);
    return result;
  }

  // Large file (> 3.5MB, e.g. video up to 30MB): use chunked upload to bypass serverless payload limits
  const { uploadId } = await request<{ uploadId: string }>(`/tasks/${taskId}/attachments/chunk-init`, {
    method: 'POST',
  });

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);

    const chunkFormData = new FormData();
    chunkFormData.append('uploadId', uploadId);
    chunkFormData.append('chunkIndex', String(index));
    chunkFormData.append('chunk', chunkBlob, file.name);

    await request<{ success: boolean; chunkIndex: number }>(`/tasks/${taskId}/attachments/chunk-part`, {
      method: 'POST',
      body: chunkFormData,
    });

    if (onProgress) {
      const percent = Math.round(((index + 1) / totalChunks) * 100);
      onProgress(percent);
    }
  }

  // Finalize the upload
  return await request<import('./types').TaskAttachment>(`/tasks/${taskId}/attachments/chunk-complete`, {
    method: 'POST',
    body: {
      uploadId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
    },
  });
}

/** DELETE /api/tasks/:taskId/attachments/:attachmentId — delete an attachment */
export function deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
  return request<void>(`/tasks/${taskId}/attachments/${attachmentId}`, {
    method: 'DELETE',
  });
}

/** Get direct download/preview URL for an attachment with token authentication */
export function getAttachmentDownloadUrl(taskId: string, attachmentId: string): string {
  const token = getAccessToken();
  const base = `/api/tasks/${taskId}/attachments/${attachmentId}/download`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/** Download attachment as a file using authenticated fetch */
export async function downloadAttachmentFile(taskId: string, attachmentId: string, fileName: string): Promise<void> {
  const url = getAttachmentDownloadUrl(taskId, attachmentId);
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to download file (${res.status})`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}


