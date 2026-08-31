/**
 * Component tests for NotificationBell (CLAUDE.md §2, §9).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import * as notifApi from '../api/notifications';
import type { NotificationResponse } from '../api/types';

vi.mock('../api/notifications', () => ({
  getUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
const mockedNotif = vi.mocked(notifApi);

const mockNotifications: NotificationResponse[] = [
  {
    id: 'n-1',
    orgId: 'o1',
    userId: 'u1',
    managerId: 'm1',
    type: 'step_activated',
    title: 'Your turn on Launch Video Clip',
    body: 'Step 1 was activated. You are now the active assignee.',
    data: { taskId: 't-1' },
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n-2',
    orgId: 'o1',
    userId: 'u1',
    managerId: 'm1',
    type: 'task_completed',
    title: 'Task Brand Assets Completed',
    body: 'All steps have been completed.',
    data: { taskId: 't-2' },
    readAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

describe('NotificationBell Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedNotif.getUnreadCount.mockResolvedValue({ count: 1 });
    mockedNotif.listNotifications.mockResolvedValue({
      items: mockNotifications,
      unreadCount: 1,
    });
  });

  it('renders bell button and unread count badge', async () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    expect(bellBtn).toBeInTheDocument();

    const badge = await screen.findByTestId('notification-badge');
    expect(badge).toHaveTextContent('1');
  });

  it('opens popover on click and renders notification items', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    await user.click(bellBtn);

    expect(await screen.findByTestId('notification-popover')).toBeInTheDocument();
    expect(screen.getByText('Your turn on Launch Video Clip')).toBeInTheDocument();
    expect(screen.getByText('Task Brand Assets Completed')).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('filters notifications by unread only when tab clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    await user.click(bellBtn);

    mockedNotif.listNotifications.mockResolvedValueOnce({
      items: [mockNotifications[0]!],
      unreadCount: 1,
    });

    const unreadTab = screen.getByRole('button', { name: 'Unread only' });
    await user.click(unreadTab);

    expect(mockedNotif.listNotifications).toHaveBeenCalledWith({ unreadOnly: true, limit: 30 });
  });

  it('marks a single notification as read when clicking the mark-read checkmark', async () => {
    const user = userEvent.setup();
    mockedNotif.markNotificationRead.mockResolvedValueOnce({
      ...mockNotifications[0]!,
      readAt: new Date().toISOString(),
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    await user.click(bellBtn);

    const markBtn = await screen.findByLabelText('Mark "Your turn on Launch Video Clip" as read');
    await user.click(markBtn);

    expect(mockedNotif.markNotificationRead).toHaveBeenCalledWith('n-1');
  });

  it('marks all notifications as read when clicking Mark all read button', async () => {
    const user = userEvent.setup();
    mockedNotif.markAllNotificationsRead.mockResolvedValueOnce({ updatedCount: 1 });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    await user.click(bellBtn);

    const markAllBtn = await screen.findByTestId('mark-all-read-btn');
    await user.click(markAllBtn);

    expect(mockedNotif.markAllNotificationsRead).toHaveBeenCalled();
  });

  it('shows empty state when no notifications are returned', async () => {
    const user = userEvent.setup();
    mockedNotif.getUnreadCount.mockResolvedValueOnce({ count: 0 });
    mockedNotif.listNotifications.mockResolvedValueOnce({
      items: [],
      unreadCount: 0,
    });

    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    const bellBtn = await screen.findByTestId('notification-bell-btn');
    await user.click(bellBtn);

    expect(await screen.findByTestId('empty-notifications')).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
  });
});
