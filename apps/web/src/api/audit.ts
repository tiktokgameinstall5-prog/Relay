import { request } from './client';
import type { AuditLogListResponse } from './types';

export interface AuditLogQueryParams {
  page?: number;
  limit?: number;
  action?: string;
  actorId?: string;
  startDate?: string;
  endDate?: string;
}

export function getAuditLogs(params?: AuditLogQueryParams): Promise<AuditLogListResponse> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.action) query.set('action', params.action);
  if (params?.actorId) query.set('actorId', params.actorId);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);

  const qs = query.toString();
  return request<AuditLogListResponse>(`/audit-logs${qs ? `?${qs}` : ''}`);
}
