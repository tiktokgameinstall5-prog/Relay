/**
 * Password sign-in. Owner AND Manager use this same route.
 *
 * The role is never part of the request — LoginDto carries only email and
 * password, and the server reads the role from the user row. A Manager reaches
 * here only after /invite has set their password; before that they have a
 * passcode, not a password.
 *
 * Note there is no @MinLength on the password field, matching login.dto.ts.
 * A length rule would answer "too short" for a short password and "not
 * accepted" for a wrong one, splitting a response space the API keeps uniform
 * on purpose.
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../layout/AuthLayout';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Alert } from '../components/Alert';

export function Login() {
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login({ email, password });
      await completeSignIn(result);
      navigate(from ?? '/', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Owners and Managers sign in here."
      footer={
        <>
          Invited by email?{' '}
          <Link to="/invite" className="text-signal font-medium">
            Use your passcode
          </Link>
          {' · '}
          <Link to="/forgot-passcode" className="text-signal font-medium">
            Forgot passcode?
          </Link>
          <br />
          <span className="text-[#9AA1AC]">
            Creating a new organization? <Link to="/signup" className="text-signal">Sign up</Link>
          </span>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        {error !== null && <Alert>{error}</Alert>}

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={72}
          required
        />

        <Button type="submit" full disabled={busy} className="mt-2">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
