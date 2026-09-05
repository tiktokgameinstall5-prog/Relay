import { request } from './client';
import type { QuotaUsage } from './types';

export function getQuotas(): Promise<QuotaUsage> {
  return request<QuotaUsage>('/quotas');
}
