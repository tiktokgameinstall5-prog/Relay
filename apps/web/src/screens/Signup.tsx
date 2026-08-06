/**
 * Owner sign-up — the only self-service registration in the product.
 *
 * CLAUDE.md §1: "First sign-up auto-creates the Organization." Managers and
 * Members never reach this screen; they arrive through /invite instead. There
 * is deliberately no role selector here — the API hardcodes 'owner' on this
 * route, so one could not do anything anyway.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ownerSignup } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../layout/AuthLayout';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Alert } from '../components/Alert';

export function Signup() {
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await ownerSignup({ organizationName, name, email, password });
      await completeSignIn(result);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Signing up creates the organization and makes you its Owner."
      footer={
        <>
          Already have an account? <Link to="/login" className="text-signal font-medium">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        {error !== null && <Alert>{error}</Alert>}

        <Field
          label="Organization name"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Acme Industries"
          autoComplete="organization"
          required
        />
        <Field
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ada Owner"
          autoComplete="name"
          required
        />
        <Field
          label="Work email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ada@acme.test"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          // Mirrors the server rule (OwnerSignupDto: 12-72). Stating it up front
          // is fine here — it is a published policy, not a secret's length, and
          // unlike on the login form there is no wrong-vs-short distinction to
          // leak, since nothing is being checked against an existing account.
          hint="At least 12 characters — this account has full org visibility."
          minLength={12}
          maxLength={72}
          required
        />

        <Button type="submit" full disabled={busy} className="mt-2">
          {busy ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </AuthLayout>
  );
}
