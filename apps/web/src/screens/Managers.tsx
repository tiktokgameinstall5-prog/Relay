/**
 * Manager provisioning — the only screen wired to a real data endpoint.
 *
 * CLAUDE.md §1: a Manager NEVER self-signs up. The Owner enters name + email,
 * the system generates a single-use passcode, and the invite is emailed. This
 * screen is that flow, and there is no public form anywhere that duplicates it.
 *
 * WHAT THIS SCREEN CANNOT DO YET, AND WHY IT SAYS SO
 *
 * There is no GET /api/auth/managers. The list below therefore holds only what
 * this browser session provisioned, and it is labelled as such. Showing an
 * unlabelled list would be the most believable lie in the app: it looks
 * persisted, survives no refresh, and would be discovered in a demo.
 */
import { useState, type FormEvent } from 'react';
import { Crown, MailCheck, MailWarning, Terminal } from 'lucide-react';
import { createManager } from '../api/auth';
import { ApiError } from '../api/client';
import type { ManagerProvisioned } from '../api/types';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Alert } from '../components/Alert';
import { ModalShell } from '../components/ModalShell';
import { StatusChip } from '../components/StatusChip';

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Managers() {
  const [provisioned, setProvisioned] = useState<ManagerProvisioned[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [lastCreated, setLastCreated] = useState<ManagerProvisioned | null>(null);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold">Managers</h1>
          <p className="mt-0.5 text-sm text-[#68707C]">
            Managers cannot sign themselves up — you create the account and Relay emails
            them a single-use passcode.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>Add a manager</Button>
      </div>

      {lastCreated !== null && (
        <div className="mb-4">
          <Alert tone={lastCreated.inviteEmailSent ? 'success' : 'error'}>
            <div className="flex items-start gap-2">
              {lastCreated.inviteEmailSent ? (
                <MailCheck size={16} className="mt-0.5 shrink-0" />
              ) : (
                <MailWarning size={16} className="mt-0.5 shrink-0" />
              )}
              <div>
                <strong>{lastCreated.name}</strong> was created.{' '}
                {lastCreated.inviteEmailSent
                  ? 'The invite email was sent.'
                  : 'The invite email FAILED to send — the account exists and the passcode can be reissued.'}
                <div className="mt-1">
                  Passcode expires <strong>{formatExpiry(lastCreated.passcodeExpiresAt)}</strong>.
                </div>
                {/*
                  Not a UI limitation: POST /api/auth/managers has no passcode
                  field at all (api-response.dto.ts:102-104). The plaintext
                  exists in exactly one place — the invite email.
                */}
                <div className="mt-1 flex items-start gap-1.5 text-[12px]">
                  <Terminal size={13} className="mt-0.5 shrink-0" />
                  <span>
                    The passcode is never returned by the API. In development the console
                    mail driver prints the whole email to the API log — read it there.
                  </span>
                </div>
              </div>
            </div>
          </Alert>
        </div>
      )}

      <div className="border-hairline overflow-hidden rounded-xl border bg-white">
        <div className="border-hairline flex items-center gap-2 border-b px-4 py-3">
          <Crown size={15} className="text-signal" />
          <h2 className="font-display text-[14px] font-semibold">
            Provisioned in this session
          </h2>
        </div>

        {provisioned.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#9AA1AC]">
            Nothing provisioned yet in this session.
          </p>
        ) : (
          <ul>
            {provisioned.map((manager) => (
              <li
                key={manager.id}
                className="border-hairline flex items-center gap-3 border-b px-4 py-3 last:border-0"
              >
                <Avatar name={manager.name} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{manager.name}</div>
                  <div className="truncate text-[12px] text-[#68707C]">{manager.email}</div>
                </div>
                <div className="font-mono hidden text-[11px] text-[#9AA1AC] sm:block">
                  expires {formatExpiry(manager.passcodeExpiresAt)}
                </div>
                <StatusChip status="active" />
              </li>
            ))}
          </ul>
        )}

        <p className="border-hairline border-t bg-[#FAFAFC] px-4 py-2.5 text-[11px] text-[#9AA1AC]">
          This list is session-only — there is no endpoint to read managers back yet. A
          persisted list arrives with the team endpoints (task&nbsp;#7).
        </p>
      </div>

      {showForm && (
        <CreateManagerModal
          onClose={() => setShowForm(false)}
          onCreated={(manager) => {
            setProvisioned((current) => [manager, ...current]);
            setLastCreated(manager);
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function CreateManagerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (manager: ManagerProvisioned) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onCreated(await createManager({ name, email }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // Per-(org_id, email) uniqueness: the same address in a different
        // organization is legitimate and returns 201, so the wording is
        // specific about the scope.
        setError('That email already has an account in this organization.');
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Something went wrong. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Add a manager" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        {error !== null && <Alert>{error}</Alert>}

        <Field
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morgan Manager"
          minLength={2}
          maxLength={120}
          required
        />
        <Field
          label="Work email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="morgan@company.com"
          maxLength={254}
          hint="The invite goes here. No password is set — they choose one when they activate."
          required
        />

        <Button type="submit" full disabled={busy} className="mt-2">
          {busy ? 'Creating…' : 'Create manager & send invite'}
        </Button>
      </form>
    </ModalShell>
  );
}
