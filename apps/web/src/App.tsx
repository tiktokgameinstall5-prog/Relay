/**
 * Routing.
 *
 * Three public routes (signup / login / invite) and everything else behind
 * RequireAuth inside the AppShell. Route-level role gating is ergonomics only —
 * RolesGuard on the server is what enforces CLAUDE.md §1 (see RequireRole).
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AppShell } from './layout/AppShell';
import { Signup } from './screens/Signup';
import { Login } from './screens/Login';
import { Invite } from './screens/Invite';
import { Managers } from './screens/Managers';
import { Phase2Stub } from './screens/Phase2Stub';

/** Where "/" lands, by role — an Owner's first job is provisioning managers. */
function HomeRedirect() {
  const { user } = useAuth();
  if (user === null) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'owner' ? '/managers' : '/tasks'} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
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
            <Route path="/" element={<HomeRedirect />} />
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
                <Phase2Stub
                  title="All teams"
                  what="Every manager's team across the organization — the Owner's full-visibility view."
                  task="task #7 — team creation and member provisioning"
                />
              }
            />
            <Route
              path="/team"
              element={
                <Phase2Stub
                  title="My team"
                  what="Your team's members, their role titles, and their workflow step numbers."
                  task="task #7 — team creation and member provisioning"
                />
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
