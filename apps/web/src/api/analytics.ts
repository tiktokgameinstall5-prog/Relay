/**
 * Analytics API functions (CLAUDE.md §2).
 */
import { request } from './client';
import type { AnalyticsOverview, BottlenecksResponse } from './types';

/** GET /api/analytics/overview — aggregate operational metrics */
export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>('/analytics/overview');
}

/** GET /api/analytics/bottlenecks — task step duration metrics and bottlenecks */
export function getBottlenecks(): Promise<BottlenecksResponse> {
  return request<BottlenecksResponse>('/analytics/bottlenecks');
}
