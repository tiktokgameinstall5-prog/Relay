/**
 * The manager's own team screen.
 *
 * A manager runs exactly one team (CLAUDE.md §1). GET /api/auth/teams is
 * RLS-scoped, so for a manager it returns just that one team — teams[0], or
 * nothing at all before they have created it. That `undefined` branch is not an
 * error; it is the first-run state, and the screen answers it by prompting the
 * manager to create their team before anyone can be added.
 *
 * Once the team exists this is the mirror of the owner's TeamDetail drill-down —
 * the same two tiles and the same shared MemberRoster, so a member renders
 * identically whether the owner or their own manager is looking. The two things
 * only the team's manager does live here: create the team, and add members
 * (name + email → the same single-use-passcode invite managers themselves get).
 */
import { useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { createMember, createTeam, deactivateMember, listTeamMembers, listTeams } from '../api/auth';
import { ApiError } from '../api/client';
import type { MemberProvisioned, MemberRow, TeamListRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AsyncView } from '../components/AsyncView';
import { StatTile } from '../components/StatTile';
import { MemberRoster } from '../components/MemberRoster';
import { InviteResult } from '../components/InviteResult';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { Alert } from '../components/Alert';
import { ModalShell } from '../components/ModalShell';
import { fmtDateTime } from '../lib/format';

export function MyTeam() {
  // showAdd and lastAdded live HERE, in the parent, not in TeamBody — because a
  // successful add calls reload(), which drops useAsync back to `loading` and so
  // unmounts everything inside AsyncView. State kept in TeamBody would be reset by
  // that remount, and the invite-success alert (the one place a member's passcode
  // expiry ever surfaces) would vanish before it could be read. The parent stays
  // mounted across the reload. This mirrors Managers.tsx exactly.
  const [showAdd, setShowAdd] = useState(false);
  const [lastAdded, setLastAdded] = useState<MemberProvisioned | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const { state, reload } = useAsync(async () => {
    const teams = await listTeams();
    // A manager's RLS-scoped team list is at most one row; teams[0] is
    // `TeamListRow | undefined` under noUncheckedIndexedAccess, and undefined
    // (no team yet) is a first-class state below, not a bug.
    const team = teams[0] ?? null;
    const members = team ? await listTeamMembers(team.id) : [];
    return { team, members };
  });

  const handleDeactivate = async (member: MemberRow) => {
    setDeactivateError(null);
    if (!window.confirm(`Are you sure you want to deactivate ${member.name}?`)) return;
    try {
      await deactivateMember(member.id);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeactivateError(
          'Cannot deactivate member with active task steps. Please reassign their active steps first.',
        );
      } else {
        setDeactivateError((err as Error).message || 'Failed to deactivate member.');
      }
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-xl font-semibold">My team</h1>
      <p className="text-muted mt-0.5 text-sm">The one team you run.</p>

      {deactivateError !== null && (
        <div className="mt-4">
          <Alert>{deactivateError}</Alert>
        </div>
      )}

      {lastAdded !== null && (
        <div className="mt-5">
          <InviteResult
            name={lastAdded.name}
            inviteEmailSent={lastAdded.inviteEmailSent}
            passcodeExpiresAt={lastAdded.passcodeExpiresAt}
            action="added"
          />
        </div>
      )}

      <div className="mt-5">
        <AsyncView state={state}>
          {({ team, members }) =>
            team === null ? (
              <CreateTeamCard onCreated={reload} />
            ) : (
              <TeamBody
                team={team}
                members={members}
                onAdd={() => setShowAdd(true)}
                onDeactivate={handleDeactivate}
              />
            )
          }
        </AsyncView>
      </div>

      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onCreated={(member) => {
            setLastAdded(member);
            setShowAdd(false);
            // Refetch so the new member appears from the authoritative roster
            // read, not a locally-appended row a reload would lose.
            reload();
          }}
        />
      )}
    </div>
  );
}

/** First-run: the manager has no team yet. An inline card, not a modal — there is
 *  nothing behind it to dismiss back to. On success the parent reloads and the
 *  team body takes over. */
function CreateTeamCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createTeam({ name });
      onCreated();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // Server enforces one active team per manager. We only render this card
        // when there is no team, so a 409 means another session got there first.
        setError('You already have a team — each manager runs exactly one. Refresh to see it.');
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Something went wrong. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="border-hairline rounded-xl border bg-white p-8">
      <div className="bg-signal-soft mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
        <Building2 size={22} className="text-signal" />
      </div>
      <h2 className="font-display mt-4 text-center text-base font-semibold">Create your team</h2>
      <p className="text-muted mx-auto mt-1.5 max-w-md text-center text-sm">
        You run exactly one team. Name it, then invite your members — each gets a single-use
        passcode by email, the same way you were invited.
      </p>
      <form onSubmit={onSubmit} className="mx-auto mt-5 max-w-sm space-y-3">
        {error !== null && <Alert>{error}</Alert>}
        <Field
          label="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Content Team"
          minLength={2}
          maxLength={120}
          required
        />
        <Button type="submit" full disabled={busy}>
          {busy ? 'Creating…' : 'Create team'}
        </Button>
      </form>
    </div>
  );
}

function TeamBody({
  team,
  members,
  onAdd,
  onDeactivate,
}: {
  team: TeamListRow;
  members: MemberRow[];
  onAdd: () => void;
  onDeactivate?: (member: MemberRow) => void;
}) {
  // Matches TeamDetail: a deactivated member still appears (CLAUDE.md §5), so the
  // Members tile counts only active ones; pending = invites not yet activated.
  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.pendingInvite).length;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display truncate text-lg font-semibold">{team.name}</h2>
          <p className="text-faint text-sm">Created {fmtDateTime(team.createdAt)}</p>
        </div>
        <Button onClick={onAdd}>Add member</Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <StatTile label="Members" value={activeCount} />
        <StatTile label="Pending invites" value={pendingCount} />
      </div>

      <h3 className="font-display mt-8 mb-3 text-[15px] font-semibold">Roster</h3>
      {members.length === 0 ? (
        <Panel title="No members yet">
          <p>
            Add your first member with the button above. They’ll get a single-use passcode by email
            to activate their account and join this team.
          </p>
        </Panel>
      ) : (
        <MemberRoster members={members} onDeactivate={onDeactivate} />
      )}
    </>
  );
}

function AddMemberModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (member: MemberProvisioned) => void;
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
      onCreated(await createMember({ name, email }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // Per-(org_id, email) uniqueness — the same address in another org is
        // legitimate, so the wording names the scope.
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
    <ModalShell title="Add a member" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        {error !== null && <Alert>{error}</Alert>}

        <Field
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sam Member"
          minLength={2}
          maxLength={120}
          required
        />
        <Field
          label="Work email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="sam@company.com"
          maxLength={254}
          hint="The invite goes here. No password is set — they choose one when they activate."
          required
        />

        <Button type="submit" full disabled={busy} className="mt-2">
          {busy ? 'Adding…' : 'Add member & send invite'}
        </Button>
      </form>
    </ModalShell>
  );
}
