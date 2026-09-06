import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { StorageDriver, StoredFileMetadata } from './storage.interface';
import { LocalStorageDriver } from './local-storage.driver';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly localDriver: StorageDriver;
  private readonly supabase: SupabaseClient | null = null;
  private readonly supabaseUrl: string | null = null;
  private readonly bucketName: string;

  constructor() {
    this.localDriver = new LocalStorageDriver();
    const supabaseUrl = process.env.SUPABASE_URL || 'https://dabmedriievifpotgzho.supabase.co';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'task-attachments';

    if (supabaseUrl && serviceRoleKey) {
      try {
        this.supabase = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false },
        });
        this.supabaseUrl = supabaseUrl;
        this.logger.log(`Supabase Storage initialized for bucket "${this.bucketName}".`);
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Supabase Storage: ${err.message}`);
      }
    }
  }

  isSupabaseEnabled(): boolean {
    return this.supabase !== null;
  }

  generateKey(orgId: string, taskId: string, originalName: string): string {
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${orgId}/${taskId}/${randomUUID()}_${sanitizedName}`;
  }

  async createSignedUploadUrl(storageKey: string): Promise<{ signedUrl: string; token: string; path: string }> {
    if (!this.supabase) {
      throw new Error('Supabase Storage is not configured on this server.');
    }
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUploadUrl(storageKey);

    if (error) {
      this.logger.error(`createSignedUploadUrl failed for ${storageKey}: ${error.message}`);
      throw error;
    }

    const signedUrl = data.signedUrl.startsWith('http')
      ? data.signedUrl
      : `${this.supabaseUrl}/storage/v1/${data.signedUrl}`;

    return {
      signedUrl,
      token: data.token,
      path: data.path,
    };
  }

  async createSignedDownloadUrl(storageKey: string, expiresIn = 3600): Promise<string> {
    if (!this.supabase) {
      throw new Error('Supabase Storage is not configured on this server.');
    }
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUrl(storageKey, expiresIn);

    if (error) {
      this.logger.error(`createSignedUrl failed for ${storageKey}: ${error.message}`);
      throw error;
    }

    return data.signedUrl.startsWith('http')
      ? data.signedUrl
      : `${this.supabaseUrl}/storage/v1/${data.signedUrl}`;
  }

  async put(storageKey: string, buffer: Buffer, mimeType: string): Promise<StoredFileMetadata> {
    if (this.supabase) {
      try {
        const { error } = await this.supabase.storage
          .from(this.bucketName)
          .upload(storageKey, buffer, {
            contentType: mimeType,
            upsert: true,
          });
        if (!error) {
          return {
            size: buffer.length,
            checksumSha256: createHash('sha256').update(buffer).digest('hex'),
            mimeType,
          };
        }
      } catch (err: any) {
        this.logger.warn(`Supabase put failed, falling back to local driver: ${err.message}`);
      }
    }
    return this.localDriver.put(storageKey, buffer, mimeType);
  }

  async get(storageKey: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.storage
          .from(this.bucketName)
          .download(storageKey);
        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuffer),
            mimeType: data.type || 'application/octet-stream',
          };
        }
      } catch (err: any) {
        this.logger.warn(`Supabase get failed, falling back to local driver: ${err.message}`);
      }
    }
    return this.localDriver.get(storageKey);
  }

  async delete(storageKey: string): Promise<void> {
    if (this.supabase) {
      try {
        await this.supabase.storage.from(this.bucketName).remove([storageKey]);
      } catch (err: any) {
        this.logger.warn(`Supabase delete failed: ${err.message}`);
      }
    }
    return this.localDriver.delete(storageKey);
  }
}
