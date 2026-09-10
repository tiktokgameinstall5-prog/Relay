/**
 * The authenticated shell — dark sidebar on desktop, horizontal tab bar below
 * `md`. Rebuilt from workspace-relay-prototype.jsx:413-500.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE PROTOTYPE
 *
 * 1. The "Viewing as owner/manager/member" switcher is GONE. In the prototype
 *    it flips a local variable to demo three layouts. In a real client it would
 *    imply a role switch exists — it does not, and could not: the role comes
 *    from /api/me, which the server derives from the user row on every request.
 *
 * 2. Everything shown about the user is real (/api/me), not seed data.
 *
 * CLAUDE.md §9 calls the vanishing-sidebar case out by name as a bug that
 * actually shipped once: below `md` the sidebar must not simply disappear, it
 * must become the scrollable tab bar below. The check is "resize to ~390px and
 * confirm every nav tab is still reachable".
 */
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  ClipboardList,
  Crown,
  Eye,
  Layers,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ShieldAlert,
  Trophy,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { NotificationBell } from '../components/NotificationBell';
import type { UserRole } from '../api/types';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The prototype's own three lists (lines 389-405), by role — with an Overview
 *  home added for the owner now that the dashboard exists. */
const NAV: Record<UserRole, NavItem[]> = {
  owner: [
    { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/managers', label: 'Managers', icon: Crown },
    { to: '/teams', label: 'All teams', icon: Building2 },
    { to: '/tasks', label: 'All tasks', icon: ClipboardList },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
    { to: '/audit-logs', label: 'Audit Logs', icon: ShieldAlert },
    { to: '/profile', label: 'Profile', icon: User },
  ],
  manager: [
    { to: '/team', label: 'My team', icon: Users },
    { to: '/tasks', label: 'Task board', icon: ClipboardList },
    { to: '/rankings', label: 'Rankings', icon: Trophy },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
    { to: '/profile', label: 'Profile', icon: User },
  ],
  member: [
    { to: '/tasks', label: 'Task board', icon: ClipboardList },
    { to: '/rankings', label: 'Rankings', icon: Trophy },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
    { to: '/profile', label: 'Profile', icon: User },
  ],
};

export function AppShell() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  if (user === null) return null; // RequireAuth has already redirected.

  const nav = NAV[user.role];
  const currentNavLabel = nav.find((i) => i.to === location.pathname)?.label ?? 'Workspace';

  return (
    <div className="bg-[#f8fafc] text-ink flex min-h-screen">
      {/* ---- Dark workspace sidebar — md and up (Linear / Hive inspired) ---- */}
      <aside className="bg-[#0f1117] border-r border-slate-800/80 hidden shrink-0 md:flex md:flex-col md:w-56 lg:w-64 select-none">
        {/* Brand header */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 lg:px-5 py-4">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 flex h-7 w-7 items-center justify-center rounded-lg shadow-sm shadow-blue-500/20">
            <Layers size={15} color="white" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-[15px] font-bold tracking-tight text-white leading-none">Relay</span>
            <span className="text-[10px] text-slate-400 font-mono mt-0.5">Enterprise Workflows</span>
          </div>
        </div>

        {/* Organization switcher pill */}
        <div className="px-2.5 lg:px-3 pt-3.5 pb-1">
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] border border-white/[0.06] p-2.5 text-left">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/20 text-blue-400 font-bold text-xs border border-blue-500/30">
                {user.organizationName ? user.organizationName.charAt(0).toUpperCase() : 'O'}
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Organization</div>
                <div className="truncate text-xs font-semibold text-slate-200">{user.organizationName}</div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-slate-300 capitalize border border-white/[0.06]">
              {user.role}
            </span>
          </div>
        </div>

        {/* Sidebar Nav */}
        <nav
          aria-label="Primary"
          data-testid="sidebar-nav"
          className="flex-1 space-y-1 px-2.5 lg:px-3 py-3"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-2xs font-semibold'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100 border border-transparent'
                }`
              }
            >
              <item.icon size={15} className="shrink-0 transition-transform group-hover:scale-110" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Owner full visibility badge */}
        {user.role === 'owner' && (
          <div className="m-2.5 lg:m-3 rounded-xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/20 p-3 shadow-2xs">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300">
              <Eye size={12} className="text-indigo-400" /> Full visibility
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-slate-400">
              You see every manager's team. Managers never see each other's teams.
            </p>
          </div>
        )}

        {/* User profile card & sign out */}
        <div className="flex items-center gap-2 border-t border-white/[0.08] p-2.5 lg:p-3">
          <Link
            to="/profile"
            title="View profile"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-white/[0.06]"
          >
            <Avatar name={user.name} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{user.name}</div>
              <div className="truncate text-[10.5px] text-slate-400 capitalize">{user.role}</div>
            </div>
          </Link>
          <NotificationBell />
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Global Workspace Top Bar (Desktop & Tablet) ---- */}
        <header className="hidden md:flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 lg:px-6 backdrop-blur-md">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-400">Relay</span>
            <ChevronRight size={12} className="text-slate-300" />
            <span className="font-semibold text-slate-800">{currentNavLabel}</span>
          </div>

          {/* Status pill & real-time badge */}
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 border border-emerald-200/70 shadow-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Workspace
            </span>
          </div>
        </header>

        {/* ---- Mobile header + tab bar — below md, where the sidebar is hidden ---- */}
        <div className="border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-2 md:hidden">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 flex h-7 w-7 items-center justify-center rounded-lg">
            <Layers size={15} color="white" />
          </div>
          <span className="font-display flex-1 text-[15px] font-bold text-slate-900">Relay</span>
          <NotificationBell />
          <Link to="/profile" title="View profile" className="flex items-center">
            <Avatar name={user.name} size={26} />
          </Link>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="text-[#68707C] hover:text-slate-900 p-1"
          >
            <LogOut size={16} />
          </button>
        </div>
        <nav
          aria-label="Primary"
          data-testid="mobile-nav"
          className="border-b border-slate-200 flex gap-2 overflow-x-auto no-scrollbar scroll-smooth touch-pan-x bg-white px-4 py-2 md:hidden"
        >
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  isActive ? 'bg-signal text-white shadow-2xs' : 'bg-cool-slate text-[#68707C] hover:text-slate-900'
                }`
              }
            >
              <item.icon size={13} /> {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-3.5 sm:p-5 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
