/**
 * §9 mobile-nav regression guard.
 *
 * CLAUDE.md §9 names, by name, a bug that once shipped: below the `md`
 * breakpoint the dark sidebar simply disappeared, leaving no way to navigate.
 * The fix is a horizontal, scrollable tab bar that carries EVERY nav item for
 * the current role. The manual check on file is "resize to ~390px and confirm
 * every nav tab is still reachable"; this is its automated companion.
 *
 * WHAT THIS TEST CAN AND CANNOT PROVE. jsdom applies no CSS and evaluates no
 * media query, and Tailwind's utilities are not compiled here — so `md:hidden` /
 * `hidden … md:flex` are inert class strings, and this test CANNOT prove the
 * visual "which one shows at 390px" behaviour (that stays the browser check
 * recorded in PROGRESS.md). What it DOES prove — and what the shipped bug
 * actually was — is structural: a distinct mobile tab-bar landmark exists and
 * carries a *reachable* link for every nav item of every role. Delete the mobile
 * bar again, or drop an item from it, and this goes red.
 *
 * Inputs are never driven via raw `el.value =` (that desyncs React's value
 * tracker — see the /signup investigation); navigation is driven with userEvent,
 * which dispatches real events, exactly as a user would.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useAuth } from '../auth/AuthContext';
import type { MeResponse, UserRole } from '../api/types';

// AuthContext exports only useAuth/AuthProvider (the context itself is private),
// and its provider runs a network bootstrap on mount — so mock the hook rather
// than wrap the real provider.
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

// Mirror of AppShell's NAV table, kept independently on purpose: if the two ever
// drift, that silent omission is exactly what this test should catch.
const EXPECTED: Record<UserRole, { label: string; path: string }[]> = {
  owner: [
    { label: 'Overview', path: '/overview' },
    { label: 'Managers', path: '/managers' },
    { label: 'All teams', path: '/teams' },
    { label: 'All tasks', path: '/tasks' },
    { label: 'Reports', path: '/reports' },
    { label: 'Audit Logs', path: '/audit-logs' },
    { label: 'Profile', path: '/profile' },
  ],
  manager: [
    { label: 'My team', path: '/team' },
    { label: 'Task board', path: '/tasks' },
    { label: 'Rankings', path: '/rankings' },
    { label: 'Reports', path: '/reports' },
    { label: 'Profile', path: '/profile' },
  ],
  member: [
    { label: 'Task board', path: '/tasks' },
    { label: 'Rankings', path: '/rankings' },
    { label: 'Reports', path: '/reports' },
    { label: 'Profile', path: '/profile' },
  ],
};

const ALL_PATHS = Array.from(
  new Set(Object.values(EXPECTED).flat().map((item) => item.path)),
);

function fakeUser(role: UserRole): MeResponse {
  return {
    id: 'u1',
    orgId: 'o1',
    organizationName: 'Test Org',
    role,
    name: 'Test User',
    email: 't@relay.test',
    managerId: role === 'owner' ? null : 'm1',
    teamId: role === 'owner' ? null : 't1',
    roleTitle: null,
    workflowStep: null,
    ranking: 0,
    isReporter: false,
  };
}

function firstPath(role: UserRole): string {
  const first = EXPECTED[role][0];
  if (first === undefined) throw new Error(`no nav items for ${role}`);
  return first.path;
}

function renderShell(role: UserRole, initialPath = firstPath(role)) {
  mockedUseAuth.mockReturnValue({
    user: fakeUser(role),
    status: 'authed',
    completeSignIn: vi.fn(),
    signOut: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShell />}>
          {/* one panel per known path, so a click's destination is observable */}
          {ALL_PATHS.map((path) => (
            <Route key={path} path={path} element={<div>{`PANEL ${path}`}</div>} />
          ))}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedUseAuth.mockReset();
});

describe('AppShell mobile navigation (CLAUDE.md §9)', () => {
  // The mobile tab bar and the desktop sidebar render the SAME links (responsive
  // CSS hides one). A test must scope to data-testid="mobile-nav" or it would
  // pass off the desktop copy even with the mobile bar deleted — the very
  // regression at stake.
  (['owner', 'manager', 'member'] as const).forEach((role) => {
    it(`renders every ${role} nav item in the mobile tab bar`, () => {
      renderShell(role);
      const mobileNav = screen.getByTestId('mobile-nav');
      const links = within(mobileNav).getAllByRole('link');
      expect(links).toHaveLength(EXPECTED[role].length);
      for (const { label, path } of EXPECTED[role]) {
        const link = within(mobileNav).getByRole('link', { name: label });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', path);
      }
    });
  });

  it('keeps both navs in the DOM — the mobile bar is an addition, not a replacement', () => {
    renderShell('owner');
    // §9's fix is that neither nav is ever the only one present; CSS alone
    // decides which is visible at a given width.
    expect(screen.getByTestId('sidebar-nav')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('every mobile tab is reachable — clicking navigates (userEvent, not raw value)', async () => {
    const user = userEvent.setup();
    renderShell('owner', '/overview');
    const mobileNav = screen.getByTestId('mobile-nav');
    // Walk every tab, incl. the last ("Reports") — the one the manual 390px
    // check confirms is still reachable after horizontal scroll.
    for (const { label, path } of EXPECTED.owner) {
      await user.click(within(mobileNav).getByRole('link', { name: label }));
      expect(screen.getByText(`PANEL ${path}`)).toBeInTheDocument();
    }
  });
});
