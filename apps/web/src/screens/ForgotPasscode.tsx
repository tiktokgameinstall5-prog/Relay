import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestPasscodeReset } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthLayout } from '../layout/AuthLayout';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Alert } from '../components/Alert';
import { KeyRound, CheckCircle2 } from 'lucide-react';

export function ForgotPasscode() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setBusy(true);

    try {
      const res = await requestPasscodeReset(email);
      setSuccessMessage(res.message);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot Passcode"
      subtitle="Request a fresh passcode for your invited manager or member account."
      footer={
        <>
          Remember your password?{' '}
          <Link to="/login" className="text-signal font-medium">
            Sign in
          </Link>
          <br />
          Have an invite passcode?{' '}
          <Link to="/first-login" className="text-signal font-medium">
            First-time sign in
          </Link>
        </>
      }
    >
      {successMessage ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs text-green-800">
            {successMessage}
          </div>
          <p className="text-muted text-xs">
            Check your inbox (or development console log) for the dispatch notice.
          </p>
          <div className="pt-2">
            <Link to="/first-login">
              <Button type="button" full>
                Enter Passcode
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          {error !== null && <Alert>{error}</Alert>}

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="member@company.com"
            required
          />

          <Button type="submit" full disabled={busy} className="mt-2">
            {busy ? 'Requesting…' : 'Send Passcode Reset'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
