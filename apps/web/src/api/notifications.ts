/**
 * Notification API functions (CLAUDE.md §2).
 */
import { request } from './client';
import type { NotificationListResponse, NotificationResponse } from './types';

export interface ListNotificationsParams {
  unreadOnly?: boolean;
  limit?: number;
}

/** GET /api/notifications — list current user's notifications */
export function listNotifications(
  params?: ListNotificationsParams,
): Promise<NotificationListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.unreadOnly !== undefined) {
    searchParams.set('unreadOnly', String(params.unreadOnly));
  }
  if (params?.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  const qs = searchParams.toString();
  return request<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ''}`);
}

/** GET /api/notifications/unread-count — fast badge count query */
export function getUnreadCount(): Promise<{ count: number }> {
  return request<{ count: number }>('/notifications/unread-count');
}

/** PATCH /api/notifications/:id/read — mark single notification read */
export function markNotificationRead(id: string): Promise<NotificationResponse> {
  return request<NotificationResponse>(`/notifications/${id}/read`, {
    method: 'PATCH',
  });
}

/** POST /api/notifications/read-all — mark all notifications as read */
export function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  return request<{ updatedCount: number }>('/notifications/read-all', {
    method: 'POST',
    body: {},
  });
}
