import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { StorageDriver, StoredFileMetadata } from './storage.interface';

export class LocalStorageDriver implements StorageDriver {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolve(baseDir || process.env.STORAGE_LOCAL_DIR || './.storage');
  }

  private resolvePath(storageKey: string): string {
    // Sanitize storageKey to prevent path traversal
    const safeKey = storageKey.replace(/\\/g, '/').replace(/\.\./g, '');
    return join(this.baseDir, safeKey);
  }

  async put(storageKey: string, buffer: Buffer, mimeType: string): Promise<StoredFileMetadata> {
    const fullPath = this.resolvePath(storageKey);
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    const hash = createHash('sha256').update(buffer).digest('hex');
    return {
      size: buffer.length,
      checksumSha256: hash,
      mimeType,
    };
  }

  async get(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const fullPath = this.resolvePath(storageKey);
    try {
      const buffer = await fs.readFile(fullPath);
      return { buffer, mimeType: 'application/octet-stream' };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const fullPath = this.resolvePath(storageKey);
    try {
      await fs.unlink(fullPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
