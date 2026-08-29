export interface StoredFileMetadata {
  size: number;
  checksumSha256: string;
  mimeType: string;
}

export interface StorageDriver {
  put(storageKey: string, buffer: Buffer, mimeType: string): Promise<StoredFileMetadata>;
  get(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
  delete(storageKey: string): Promise<void>;
}
