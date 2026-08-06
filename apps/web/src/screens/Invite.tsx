/**
 * Manager first login — the dedicated passcode screen CLAUDE.md §1 calls for.
 *
 * The invite email links here with ?email= prefilled (mail/templates/invite.ts).
 * The PASSCODE IS NOT IN THE URL and this screen must never put it there:
 * URLs leak through Referer headers, browser history, proxy and CDN logs, and
 * shared screenshots, and a passcode is a login credential rather than a nonce.
 * So the passcode field starts empty and is always typed by hand.
 *
 * One request does both jobs — consume the passcode and set the permanent
 * password. If setting the password were a separate step, a crash between the
 * two would leave the account with its single-use passcode spent and no
 * password: permanently locked out.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { managerFirstLogin } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../layout/AuthLayout';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Alert } from '../components/Alert';

export function Invite() {
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [passcode, setPasscode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await managerFirstLogin({ email, passcode, newPassword });
      await completeSignIn(result);
      navigate('/', { replace: true });
    } catch (caught) {
      // A 401 here is one message for every cause — wrong passcode, expired,
      // already used, unknown email, wrong role. client.ts enforces that; do
      // not add a friendlier per-case message, it rebuilds the oracle the API
      // suppresses.
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Activate your account"
      subtitle="Enter the passcode from your invite email and choose a permanent password."
      footer={
        <>
          Already activated?{' '}
          <Link to="/login" className="text-signal font-medium">
            Sign in with your password
          </Link>
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
          label="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          // Not autoComplete="one-time-code": that hints at an SMS/authenticator
          // code the browser may try to autofill. This one comes from an email
          // and is typed once, so offering to remember it is wrong.
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          placeholder="K7M2XQ9P4B"
          minLength={8}
          maxLength={10}
          hint="Single-use, and it expires. It works only once — if it fails, ask your Owner to reissue it."
          required
        />
        <Field
          label="Choose a password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 12 characters. You'll use this to sign in from now on."
          minLength={12}
          maxLength={72}
          required
        />

        <Button type="submit" full disabled={busy} className="mt-2">
          {busy ? 'Activating…' : 'Activate account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
