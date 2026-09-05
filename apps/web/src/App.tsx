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
import { BootSplash } from './components/BootSplash';
import { Landing } from './screens/landing/Landing';
import { Signup } from './screens/Signup';
import { Login } from './screens/Login';
import { Invite } from './screens/Invite';
import { Managers } from './screens/Managers';
import { Overview } from './screens/Overview';
import { Teams } from './screens/Teams';
import { TeamDetail } from './screens/TeamDetail';
import { MyTeam } from './screens/MyTeam';
import { Tasks } from './screens/Tasks';
import { Rankings } from './screens/Rankings';
import { Reports } from './screens/Reports';
import { AuditLogs } from './screens/AuditLogs';
import { ForgotPasscode } from './screens/ForgotPasscode';
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
  if (status === 'loading') {
    // Session restore in flight: don't flash the marketing Landing to a user who
    // is about to be redirected to their dashboard (nor the reverse).
    return <BootSplash />;
  }
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
          <Route path="/first-login" element={<Invite />} />
          <Route path="/forgot-passcode" element={<ForgotPasscode />} />

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
            <Route path="/tasks" element={<Tasks />} />
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
            <Route path="/rankings" element={<Rankings />} />
            <Route path="/reports" element={<Reports />} />
            <Route
              path="/audit-logs"
              element={
                <RequireRole role="owner">
                  <AuditLogs />
                </RequireRole>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
