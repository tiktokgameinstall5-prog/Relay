import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StorageDriver, StoredFileMetadata } from './storage.interface';
import { LocalStorageDriver } from './local-storage.driver';

@Injectable()
export class StorageService {
  private readonly driver: StorageDriver;

  constructor() {
    this.driver = new LocalStorageDriver();
  }

  generateKey(orgId: string, taskId: string, originalName: string): string {
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${orgId}/${taskId}/${randomUUID()}_${sanitizedName}`;
  }

  async put(storageKey: string, buffer: Buffer, mimeType: string): Promise<StoredFileMetadata> {
    return this.driver.put(storageKey, buffer, mimeType);
  }

  async get(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return this.driver.get(storageKey);
  }

  async delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }
}
