/**
 * In-App Notification Bell & Popover Component (CLAUDE.md §2, §9).
 *
 * Features:
 *   - Live unread badge count with 30s short polling.
 *   - Dropdown popover list with "All" vs "Unread" filter.
 *   - Mark individual notification as read on click or button.
 *   - Mark all notifications as read in bulk.
 *   - Click-to-navigate: navigates directly to the referenced task board.
 *   - Click outside / Escape key handler to close popover.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  Clock,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications';
import type { NotificationResponse, NotificationType } from '../api/types';
import { timeAgo } from '../lib/format';

/** Short-polling interval for notification count (30 seconds) */
const POLL_INTERVAL_MS = 30000;

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case 'task_assigned':
      return <ClipboardList size={14} className="text-active" />;
    case 'step_activated':
      return <Layers size={14} className="text-signal" />;
    case 'task_completed':
      return <Sparkles size={14} className="text-done" />;
    case 'task_scheduled_live':
      return <Clock size={14} className="text-active" />;
    case 'reporter_prompt':
    default:
      return <Bell size={14} className="text-amber" />;
  }
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fetch unread count for badge
  const refreshUnreadCount = async () => {
    try {
      const res = await getUnreadCount();
      setUnreadCount(res.count);
    } catch {
      // Ignore background poll errors
    }
  };

  // 30s background poll
  useEffect(() => {
    refreshUnreadCount();
    const timer = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Fetch full notification list whenever popover opens or filter changes
  const loadNotifications = async (filterUnread = unreadOnly) => {
    setLoading(true);
    try {
      const res = await listNotifications({ unreadOnly: filterUnread, limit: 30 });
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      // Ignore transient errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadNotifications(unreadOnly);
    }
  }, [isOpen, unreadOnly]);

  // Click outside & escape key handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const updated = await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: updated.readAt } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore failure
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch {
      // Ignore failure
    }
  };

  const handleNotificationClick = async (notif: NotificationResponse) => {
    if (!notif.readAt) {
      await handleMarkAsRead(notif.id);
    }
    setIsOpen(false);
    // Navigate to tasks board (or specific task if taskId in data)
    navigate('/tasks');
  };

  return (
    <div className="relative inline-block">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={isOpen}
        data-testid="notification-bell-btn"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#7B8098] transition-colors hover:bg-[#2A2D3A] hover:text-white md:text-[#7B8098] max-md:text-[#68707C] max-md:hover:bg-slate-100 max-md:hover:text-ink"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="bg-signal absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-xs"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-popover"
          className="border-hairline dark:border-[#222738] absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-xl border bg-white dark:bg-[#151821] text-ink dark:text-slate-100 shadow-xl ring-1 ring-black/5"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline dark:border-[#222738] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-ink dark:text-slate-100">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-[11px] font-medium text-active dark:text-blue-400">
                  {unreadCount} unread
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="flex items-center gap-1 text-[11px] font-medium text-active dark:text-blue-400 hover:underline"
                  data-testid="mark-all-read-btn"
                >
                  <CheckCheck size={13} />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close notifications"
                className="text-faint dark:text-slate-400 hover:text-ink dark:hover:text-white"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-hairline dark:border-[#222738] bg-wash/50 dark:bg-slate-900/50 px-4 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => setUnreadOnly(false)}
              className={`mr-3 py-1 font-medium transition-colors ${
                !unreadOnly ? 'border-b-2 border-signal font-semibold text-signal' : 'text-muted dark:text-slate-400 hover:text-ink dark:hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setUnreadOnly(true)}
              className={`py-1 font-medium transition-colors ${
                unreadOnly ? 'border-b-2 border-signal font-semibold text-signal' : 'text-muted dark:text-slate-400 hover:text-ink dark:hover:text-white'
              }`}
            >
              Unread only
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-hairline dark:divide-[#222738]">
            {loading && notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted dark:text-slate-400">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center" data-testid="empty-notifications">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-muted dark:text-slate-400">
                  <Check size={18} />
                </div>
                <p className="mt-2 text-xs font-medium text-ink dark:text-slate-200">
                  {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="mt-0.5 text-[11px] text-faint dark:text-slate-400">
                  {unreadOnly
                    ? "You've read all your recent notifications."
                    : 'Workflow updates and step hand-offs will appear here.'}
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.readAt;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    data-testid={`notification-item-${n.id}`}
                    className={`flex cursor-pointer items-start gap-3 p-3 text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                      isUnread ? 'bg-blue-50/40 dark:bg-blue-950/30' : 'bg-white dark:bg-[#151821]'
                    }`}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <NotificationIcon type={n.type} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`truncate font-medium ${
                            isUnread ? 'text-ink dark:text-slate-100 font-semibold' : 'text-muted dark:text-slate-400'
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint dark:text-slate-500 font-mono">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-muted dark:text-slate-400 leading-relaxed">
                        {n.body}
                      </p>
                    </div>

                    {isUnread && (
                      <div className="flex shrink-0 flex-col items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-active" title="Unread" />
                        <button
                          type="button"
                          onClick={(e) => handleMarkAsRead(n.id, e)}
                          title="Mark as read"
                          aria-label={`Mark "${n.title}" as read`}
                          className="text-faint dark:text-slate-400 hover:text-active dark:hover:text-blue-400"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
