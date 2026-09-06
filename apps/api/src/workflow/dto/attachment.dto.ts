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

export interface SignedUploadUrlRequestDto {
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface SignedUploadUrlResponseDto {
  signedUrl: string;
  token: string;
  storageKey: string;
  path: string;
}

export interface CompleteSignedUploadDto {
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksumSha256?: string;
}

