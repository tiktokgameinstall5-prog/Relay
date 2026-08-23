/**
 * Routing.
 *
 * "/" is PUBLIC — RootGate shows the marketing Landing to anonymous visitors and
 * redirects signed-in users to their dashboard. Signup / login / invite are the
 * other public routes; everything else sits behind RequireAuth inside the
 * AppShell. Route-level role gating is ergonomics only — RolesGuard on the server
 * is what enforces CLAUDE.md §1 (see RequireRole).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AppShell } from './layout/AppShell';
import { Landing } from './screens/landing/Landing';
import { Signup } from './screens/Signup';
import { Login } from './screens/Login';
import { Invite } from './screens/Invite';
import { Managers } from './screens/Managers';
import { Overview } from './screens/Overview';
import { Teams } from './screens/Teams';
import { TeamDetail } from './screens/TeamDetail';
import { MyTeam } from './screens/MyTeam';
import { Phase2Stub } from './screens/Phase2Stub';
import type { UserRole } from './api/types';

/** The dashboard a signed-in user lands on, by role. Every target is a route
 *  that exists — a home pointing at a missing route would bounce off the "*"
 *  catch-all back to "/" and loop. */
function homeFor(role: UserRole): string {
  switch (role) {
    case 'owner':
      return '/overview';
    case 'manager':
      return '/team';
    case 'member':
      return '/tasks';
  }
}

/** "/" — the public front door. Anonymous → the marketing Landing (URL stays
 *  "/", not a redirect to /login); signed-in → their role's dashboard. */
function RootGate() {
  const { status, user } = useAuth();
  if (status === 'authed' && user !== null) {
    return <Navigate to={homeFor(user.role)} replace />;
  }
  return <Landing />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootGate />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/invite" element={<Invite />} />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route
              path="/overview"
              element={
                <RequireRole role="owner">
                  <Overview />
                </RequireRole>
              }
            />
            <Route
              path="/managers"
              element={
                <RequireRole role="owner">
                  <Managers />
                </RequireRole>
              }
            />
            <Route
              path="/tasks"
              element={
                <Phase2Stub
                  title="Task board"
                  what="The relay chain: tasks split into ordered steps, one active at a time, with a live 'currently with X' indicator."
                  task="Phase 2 — the workflow engine"
                />
              }
            />
            <Route
              path="/teams"
              element={
                <RequireRole role="owner">
                  <Teams />
                </RequireRole>
              }
            />
            <Route
              path="/teams/:teamId"
              element={
                <RequireRole role="owner">
                  <TeamDetail />
                </RequireRole>
              }
            />
            <Route
              path="/team"
              element={
                <RequireRole role="manager">
                  <MyTeam />
                </RequireRole>
              }
            />
            <Route
              path="/rankings"
              element={
                <Phase2Stub
                  title="Rankings"
                  what="The per-team leaderboard, with every ranking change logged for audit."
                  task="Phase 5 — rankings and the reporter workflow"
                />
              }
            />
            <Route
              path="/reports"
              element={
                <Phase2Stub
                  title="Reports"
                  what="Completion reports written by a team's reporter when a task's final step finishes."
                  task="Phase 5 — rankings and the reporter workflow"
                />
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
