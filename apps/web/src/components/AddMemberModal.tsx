import { useState, type FormEvent } from 'react';
import { Users, Crown } from 'lucide-react';
import { createMember } from '../api/auth';
import { ApiError } from '../api/client';
import type { MemberProvisioned, TeamListRow } from '../api/types';
import { ModalShell } from './ModalShell';
import { Field } from './Field';
import { Button } from './Button';
import { Alert } from './Alert';

export interface AddMemberModalProps {
  onClose: () => void;
  onCreated: (member: MemberProvisioned) => void;
  /** Optional pre-selected team (when adding from TeamDetail or MyTeam) */
  preselectedTeam?: { id: string; managerId: string; name: string } | null;
  /** Optional list of teams for the Owner to choose from (when adding from Teams directory) */
  teams?: TeamListRow[];
}

export function AddMemberModal({
  onClose,
  onCreated,
  preselectedTeam,
  teams,
}: AddMemberModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    preselectedTeam?.id || (teams && teams.length > 0 ? teams[0].id : ''),
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Find the selected team if teams array was supplied
  const effectiveTeam =
    preselectedTeam ||
    (teams ? teams.find((t) => t.id === selectedTeamId) : null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const teamToTarget = effectiveTeam;
    if (!teamToTarget && (!teams || teams.length === 0)) {
      setError('No target team selected.');
      return;
    }

    setBusy(true);
    try {
      const payload: {
        name: string;
        email: string;
        teamId?: string;
        managerId?: string;
        roleTitle?: string;
      } = {
        name: name.trim(),
        email: email.trim(),
      };

      if (teamToTarget) {
        payload.teamId = teamToTarget.id;
        payload.managerId = teamToTarget.managerId;
      }
      if (roleTitle.trim()) {
        payload.roleTitle = roleTitle.trim();
      }

      const result = await createMember(payload);
      onCreated(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
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
    <ModalShell
      title={preselectedTeam ? `Add member to ${preselectedTeam.name}` : 'Add member to team'}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3.5">
        {error !== null && <Alert tone="error">{error}</Alert>}

        {/* Team Selection dropdown for Owner when teams array is provided without a preselection */}
        {!preselectedTeam && teams && teams.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5">
              Select target team & manager
            </label>
            <div className="relative">
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-sm text-ink shadow-2xs focus:border-signal focus:outline-hidden focus:ring-1 focus:ring-signal transition-colors"
                required
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (Manager: {t.managerName})
                  </option>
                ))}
              </select>
            </div>
            {effectiveTeam && (
              <p className="mt-1.5 text-xs text-muted flex items-center gap-1">
                <Crown size={12} className="text-amber shrink-0" />
                <span>Managed by {effectiveTeam.managerName}</span>
              </p>
            )}
          </div>
        )}

        {preselectedTeam && (
          <div className="rounded-xl border border-hairline bg-cool-slate/70 p-3 flex items-center gap-2.5 text-xs text-muted">
            <Users size={15} className="text-signal shrink-0" />
            <div>
              <span className="font-semibold text-ink">{preselectedTeam.name}</span>
            </div>
          </div>
        )}

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
          hint="The single-use invite passcode will be emailed here. No password is set until they activate."
          required
        />

        <Field
          label="Role / Title (Optional)"
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder="e.g. Lead Designer, Frontend Dev, Copywriter"
          maxLength={120}
        />

        <Button type="submit" full disabled={busy} className="mt-2.5 justify-center py-2.5 font-medium">
          {busy ? 'Adding member…' : 'Add member & send invite'}
        </Button>
      </form>
    </ModalShell>
  );
}
