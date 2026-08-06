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
import { NavLink, Outlet } from 'react-router-dom';
import {
  Building2,
  ClipboardList,
  Crown,
  Eye,
  Layers,
  LogOut,
  MessageSquare,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import type { UserRole } from '../api/types';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** The prototype's own three lists (lines 389-405), by role. */
const NAV: Record<UserRole, NavItem[]> = {
  owner: [
    { to: '/managers', label: 'Managers', icon: Crown },
    { to: '/teams', label: 'All teams', icon: Building2 },
    { to: '/tasks', label: 'All tasks', icon: ClipboardList },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
  ],
  manager: [
    { to: '/tasks', label: 'Task board', icon: ClipboardList },
    { to: '/team', label: 'My team', icon: Users },
    { to: '/rankings', label: 'Rankings', icon: Trophy },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
  ],
  member: [
    { to: '/tasks', label: 'Task board', icon: ClipboardList },
    { to: '/rankings', label: 'Rankings', icon: Trophy },
    { to: '/reports', label: 'Reports', icon: MessageSquare },
  ],
};

export function AppShell() {
  const { user, signOut } = useAuth();
  if (user === null) return null; // RequireAuth has already redirected.

  const nav = NAV[user.role];

  return (
    <div className="bg-cool-slate text-ink flex min-h-screen">
      {/* ---- Dark workspace sidebar — md and up ---- */}
      <aside className="bg-sidebar-bg hidden w-60 shrink-0 md:flex md:flex-col">
        <div className="flex items-center gap-2 border-b border-[#2A2D3A] px-4 py-4">
          <div className="bg-signal flex h-7 w-7 items-center justify-center rounded-lg">
            <Layers size={15} color="white" />
          </div>
          <span className="font-display text-[15px] font-bold text-white">Relay</span>
        </div>

        <div className="px-4 pt-4">
          <div className="text-[10px] tracking-wide text-[#5C6178] uppercase">Organization</div>
          <div className="truncate text-[13px] font-medium text-white">
            {user.organizationName}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium ${
                  isActive
                    ? 'bg-sidebar-bg-active text-white'
                    : 'text-sidebar-text hover:text-white'
                }`
              }
            >
              <item.icon size={15} /> {item.label}
            </NavLink>
          ))}
        </nav>

        {user.role === 'owner' && (
          <div className="m-3 rounded-lg bg-[#22242F] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#9BB0FF]">
              <Eye size={12} /> Full visibility
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-[#7B8098]">
              You see every manager's team. Managers never see each other's teams.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-[#2A2D3A] px-3 py-3">
          <Avatar name={user.name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white">{user.name}</div>
            <div className="truncate text-[11px] text-[#7B8098] capitalize">{user.role}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="text-[#7B8098] hover:text-white"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Mobile header + tab bar — below md, where the sidebar is hidden ---- */}
        <div className="border-hairline flex items-center gap-2 border-b bg-white px-4 py-3 md:hidden">
          <div className="bg-signal flex h-7 w-7 items-center justify-center rounded-lg">
            <Layers size={15} color="white" />
          </div>
          <span className="font-display flex-1 text-[15px] font-bold">Relay</span>
          <Avatar name={user.name} size={26} />
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="text-[#68707C]"
          >
            <LogOut size={16} />
          </button>
        </div>
        <div className="border-hairline flex gap-2 overflow-x-auto border-b bg-white px-4 py-2 md:hidden">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                  isActive ? 'bg-signal text-white' : 'bg-cool-slate text-[#68707C]'
                }`
              }
            >
              <item.icon size={13} /> {item.label}
            </NavLink>
          ))}
        </div>

        {/*
          The in-memory-token trade, stated rather than sprung on anyone. The
          token is held only in a JS variable so an XSS payload cannot read it
          out of storage; the price is that a refresh ends the session. Task #8
          (refresh rotation) removes the price without giving up the property.
        */}
        <div className="border-b border-[#F2D9A8] bg-[#FEF6E7] px-4 py-1.5 text-[11px] text-[#7A5B18]">
          Session is held in memory — refreshing this page signs you out. Persistent
          sessions arrive with refresh tokens (task&nbsp;#8).
        </div>

        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
