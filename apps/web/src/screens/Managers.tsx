/**
 * Manager provisioning + the owner's manager directory.
 *
 * CLAUDE.md §1: a Manager NEVER self-signs up. The Owner enters name + email,
 * the system generates a single-use passcode, and the invite is emailed. This
 * screen is that flow, and no public form anywhere duplicates it.
 *
 * The list is the real GET /api/auth/managers read — owner-only by design: a
 * manager's own "user" RLS slice is {self} ∪ {their members}, so the same query
 * as a manager would return a one-row list they already hold from /api/me, and
 * the server 403s them instead. After a create the list is reloaded, so a
 * provisioned manager shows up as a persisted row, not a session-only echo.
 *
 * The one thing the list read cannot show is the passcode expiry: that lives
 * only on the create response (the API never returns the passcode itself —
 * api-response.dto.ts:102-104 — and never re-returns its expiry on a read). So
 * the success alert below is where the expiry surfaces, once, right after
 * creation; the standing row afterwards is the plain directory entry.
 */
import { useState, type FormEvent } from 'react';
import { Crown } from 'lucide-react';
import { createManager, listManagers } from '../api/auth';
import { ApiError } from '../api/client';
import type { ManagerListRow, ManagerProvisioned } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Alert } from '../components/Alert';
import { InviteResult } from '../components/InviteResult';
import { ModalShell } from '../components/ModalShell';
import { StatusChip } from '../components/StatusChip';
import { fmtDateTime } from '../lib/format';

export function Managers() {
  const [showForm, setShowForm] = useState(false);
  const [lastCreated, setLastCreated] = useState<ManagerProvisioned | null>(null);
  const { state, reload } = useAsync(() => listManagers());

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold">Managers</h1>
          <p className="text-muted mt-0.5 text-sm">
            Managers cannot sign themselves up — you create the account and Relay emails
            them a single-use passcode.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>Add a manager</Button>
      </div>

      {lastCreated !== null && (
        <div className="mb-4">
          <InviteResult
            name={lastCreated.name}
            inviteEmailSent={lastCreated.inviteEmailSent}
            passcodeExpiresAt={lastCreated.passcodeExpiresAt}
          />
        </div>
      )}

      <AsyncView state={state}>
        {(managers) =>
          managers.length === 0 ? <EmptyState /> : <ManagerList managers={managers} />
        }
      </AsyncView>

      {showForm && (
        <CreateManagerModal
          onClose={() => setShowForm(false)}
          onCreated={(manager) => {
            setLastCreated(manager);
            setShowForm(false);
            // Refetch so the new manager appears from the authoritative read,
            // not as a locally-appended optimistic row that a refresh would lose.
            reload();
          }}
        />
      )}
    </div>
  );
}

function ManagerList({ managers }: { managers: ManagerListRow[] }) {
  return (
    <div className="border-hairline overflow-hidden rounded-xl border bg-white">
      <div className="border-hairline flex items-center gap-2 border-b px-4 py-3">
        <Crown size={15} className="text-signal" />
        <h2 className="font-display text-[14px] font-semibold">
          All managers · {managers.length}
        </h2>
      </div>
      <ul>
        {managers.map((manager) => (
          <li
            key={manager.id}
            className="border-hairline flex items-center gap-3 border-b px-4 py-3 last:border-0"
          >
            <Avatar name={manager.name} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{manager.name}</div>
              <div className="text-muted truncate text-[12px]">{manager.email}</div>
            </div>
            {/* Which team they run — or that they have not built one yet, which is
                worth seeing at a glance in the owner's directory. */}
            <div className="hidden text-right sm:block">
              {manager.teamName !== null ? (
                <span className="text-ink text-[12px]">{manager.teamName}</span>
              ) : (
                <span className="text-faint text-[12px] italic">No team yet</span>
              )}
            </div>
            <div className="text-faint hidden font-mono text-[11px] md:block">
              {fmtDateTime(manager.createdAt)}
            </div>
            <ManagerChip manager={manager} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Account state as a chip, same precedence as the roster's MemberChip so the
 *  two directories read identically: a not-yet-activated invite → amber
 *  "Pending", a deactivated account → grey "Deactivated", otherwise blue
 *  "Active". (StatusChip reuses `pending` for a pending invite — see its note.) */
function ManagerChip({ manager }: { manager: ManagerListRow }) {
  if (manager.pendingInvite) return <StatusChip status="pending" />;
  if (manager.status === 'inactive') return <StatusChip status="inactive" />;
  return <StatusChip status="active" />;
}

function EmptyState() {
  return (
    <div className="border-hairline rounded-xl border bg-white p-10 text-center">
      <div className="bg-signal-soft mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
        <Crown size={22} className="text-signal" />
      </div>
      <h2 className="font-display mt-4 text-base font-semibold">No managers yet</h2>
      <p className="text-muted mx-auto mt-1.5 max-w-md text-sm">
        Managers can’t sign themselves up. Create the first account — Relay emails them a
        single-use passcode to activate and build their own team.
      </p>
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
