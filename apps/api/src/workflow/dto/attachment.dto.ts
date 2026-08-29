export interface TaskAttachmentDto {
  id: string;
  taskId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  checksumSha256: string;
  uploadedByUserId: string;
  createdAt: string;
  updatedAt: string;
}
