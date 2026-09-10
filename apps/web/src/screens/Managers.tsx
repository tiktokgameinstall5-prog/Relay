/**
 * Manager provisioning + the owner's manager directory.
 *
 * CLAUDE.md §1 & §5:
 * 1. A Manager NEVER self-signs up. The Owner provisions with single-use passcode.
 * 2. Two-step confirmation for Manager deletion (pre-deletion impact stats + type-to-confirm manager name).
 * 3. 30-day recoverable "Recently Deleted" window with 1-click restore.
 */
import { useState, useEffect, type FormEvent } from 'react';
import { Crown, Trash2, RotateCcw, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import {
  createManager,
  listManagers,
  getManagerImpact,
  deleteManager,
  getDeletedManagers,
  restoreManager,
} from '../api/auth';
import { ApiError } from '../api/client';
import type {
  ManagerListRow,
  ManagerProvisioned,
  DeletedManager,
  ManagerImpactStats,
} from '../api/types';
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
  const [activeTab, setActiveTab] = useState<'active' | 'deleted'>('active');
  const [showForm, setShowForm] = useState(false);
  const [lastCreated, setLastCreated] = useState<ManagerProvisioned | null>(null);
  const [impactTarget, setImpactTarget] = useState<ManagerListRow | null>(null);

  const { state, reload } = useAsync(() => listManagers());

  const [deletedList, setDeletedList] = useState<DeletedManager[]>([]);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [deletedError, setDeletedError] = useState<string | null>(null);

  const loadDeleted = async () => {
    setLoadingDeleted(true);
    setDeletedError(null);
    try {
      const res = await getDeletedManagers();
      setDeletedList(res);
    } catch (err) {
      setDeletedError((err as Error).message || 'Failed to load deleted managers.');
    } finally {
      setLoadingDeleted(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'deleted') {
      loadDeleted();
    }
  }, [activeTab]);

  const handleRestore = async (id: string) => {
    try {
      await restoreManager(id);
      await loadDeleted();
      reload();
    } catch (err) {
      alert((err as Error).message || 'Failed to restore manager.');
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold">Managers</h1>
          <p className="text-muted mt-0.5 text-sm">
            Managers are invited with single-use passcodes. Soft-deleted managers remain recoverable for 30 days.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>Add a manager</Button>
      </div>

      {/* Tabs */}
      <div className="mb-5 border-b border-gray-200 dark:border-[#222738]">
        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`whitespace-nowrap pb-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'active'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:border-slate-700'
            }`}
          >
            Active Managers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('deleted')}
            className={`whitespace-nowrap pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'deleted'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:border-slate-700'
            }`}
          >
            <span>Recently Deleted</span>
            {deletedList.length > 0 && (
              <span className="rounded-full bg-red-100 dark:bg-red-950/40 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400">
                {deletedList.length}
              </span>
            )}
          </button>
        </nav>
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

      {activeTab === 'active' ? (
        <AsyncView state={state}>
          {(managers) =>
            managers.length === 0 ? (
              <EmptyState />
            ) : (
              <ManagerList
                managers={managers}
                onDeleteClick={(m) => setImpactTarget(m)}
              />
            )
          }
        </AsyncView>
      ) : (
        <RecentlyDeletedView
          items={deletedList}
          loading={loadingDeleted}
          error={deletedError}
          onRestore={handleRestore}
          onRefresh={loadDeleted}
        />
      )}

      {showForm && (
        <CreateManagerModal
          onClose={() => setShowForm(false)}
          onCreated={(manager) => {
            setLastCreated(manager);
            setShowForm(false);
            reload();
          }}
        />
      )}

      {impactTarget && (
        <DeleteImpactModal
          manager={impactTarget}
          onClose={() => setImpactTarget(null)}
          onDeleted={() => {
            setImpactTarget(null);
            reload();
            if (activeTab === 'deleted') loadDeleted();
          }}
        />
      )}
    </div>
  );
}

function ManagerList({
  managers,
  onDeleteClick,
}: {
  managers: ManagerListRow[];
  onDeleteClick: (manager: ManagerListRow) => void;
}) {
  return (
    <div className="border-hairline overflow-hidden rounded-xl border bg-white dark:bg-[#151821] dark:border-[#222738] shadow-sm">
      <div className="border-hairline flex items-center gap-2 border-b px-4 py-3 bg-gray-50/50 dark:bg-[#181c27] dark:border-[#222738]">
        <Crown size={15} className="text-signal" />
        <h2 className="font-display text-[14px] font-semibold text-gray-900 dark:text-slate-100">
          All managers · {managers.length}
        </h2>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-[#222738]">
        {managers.map((manager) => (
          <li
            key={manager.id}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-50/75 dark:hover:bg-[#181c27]/75"
          >
            <Avatar name={manager.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{manager.name}</div>
              <div className="text-muted truncate text-[12px]">{manager.email}</div>
            </div>
            <div className="hidden text-right sm:block">
              {manager.teamName !== null ? (
                <span className="text-ink text-[12px] font-medium">{manager.teamName}</span>
              ) : (
                <span className="text-faint text-[12px] italic">No team yet</span>
              )}
            </div>
            <div className="text-faint hidden font-mono text-[11px] md:block">
              {fmtDateTime(manager.createdAt)}
            </div>
            <ManagerChip manager={manager} />
            {manager.status === 'active' && (
              <button
                type="button"
                onClick={() => onDeleteClick(manager)}
                title="Delete manager"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 transition"
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentlyDeletedView({
  items,
  loading,
  error,
  onRestore,
  onRefresh,
}: {
  items: DeletedManager[];
  loading: boolean;
  error: string | null;
  onRestore: (id: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (loading && items.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">
        <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-primary" />
        Loading recently deleted managers...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="border-hairline rounded-xl border bg-white dark:bg-[#151821] dark:border-[#222738] p-10 text-center">
        <Clock className="mx-auto h-8 w-8 text-gray-300 dark:text-slate-600" />
        <h2 className="font-display mt-3 text-base font-semibold text-gray-800 dark:text-slate-100">No recently deleted managers</h2>
        <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
          Soft-deleted managers appear here for 30 days before permanent cleanup, and can be restored with a single click.
        </p>
      </div>
    );
  }

  return (
    <div className="border-hairline overflow-hidden rounded-xl border bg-white dark:bg-[#151821] dark:border-[#222738] shadow-sm">
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3 bg-gray-50/50 dark:bg-[#181c27] dark:border-[#222738]">
        <div className="flex items-center gap-2">
          <Clock size={15} className="text-amber-500" />
          <h2 className="font-display text-[14px] font-semibold text-gray-800 dark:text-slate-100">
            30-Day Recovery Queue · {items.length}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-[#222738]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-gray-50/50 dark:hover:bg-[#181c27]/50">
            <Avatar name={item.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{item.name}</div>
              <div className="text-muted truncate text-xs">{item.email}</div>
              {item.teamName && (
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Team: <span className="font-medium text-gray-700 dark:text-slate-200">{item.teamName}</span></div>
              )}
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
                <Clock size={11} />
                {item.expiresInDays}d left to restore
              </span>
              <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 font-mono">
                Deleted {fmtDateTime(item.deletedAt)}
              </div>
            </div>
            <div>
              <button
                type="button"
                disabled={restoringId === item.id}
                onClick={async () => {
                  setRestoringId(item.id);
                  try {
                    await onRestore(item.id);
                  } finally {
                    setRestoringId(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-white transition disabled:opacity-50"
              >
                <RotateCcw size={13} className={restoringId === item.id ? 'animate-spin' : ''} />
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManagerChip({ manager }: { manager: ManagerListRow }) {
  if (manager.pendingInvite) return <StatusChip status="pending" />;
  if (manager.status === 'inactive') return <StatusChip status="inactive" />;
  return <StatusChip status="active" />;
}

function EmptyState() {
  return (
    <div className="border-hairline rounded-xl border bg-white dark:bg-[#151821] dark:border-[#222738] p-10 text-center">
      <div className="bg-signal-soft mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
        <Crown size={22} className="text-signal" />
      </div>
      <h2 className="font-display mt-4 text-base font-semibold text-gray-900 dark:text-slate-100">No managers yet</h2>
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

function DeleteImpactModal({
  manager,
  onClose,
  onDeleted,
}: {
  manager: ManagerListRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loadingImpact, setLoadingImpact] = useState(true);
  const [impact, setImpact] = useState<ManagerImpactStats | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getManagerImpact(manager.id)
      .then((res) => {
        if (!cancelled) {
          setImpact(res);
          setLoadingImpact(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to analyze manager impact.');
          setLoadingImpact(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manager.id]);

  const isConfirmed = confirmName.trim().toLowerCase() === manager.name.trim().toLowerCase();

  const handleDelete = async () => {
    if (!isConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      await deleteManager(manager.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete manager.');
      setBusy(false);
    }
  };

  return (
    <ModalShell title="Delete Manager — Confirmation Required" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-800 dark:text-red-300 flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-900 dark:text-red-200">Cascading Soft-Delete Warning</div>
            <div className="mt-0.5">
              Deleting this manager will deactivate their account, their team, and all team members.
              This can be restored within 30 days from the "Recently Deleted" tab.
            </div>
          </div>
        </div>

        {loadingImpact ? (
          <div className="py-6 text-center text-xs text-gray-500 dark:text-slate-400">
            <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin text-primary" />
            Analyzing team dependencies and impact...
          </div>
        ) : error && !impact ? (
          <Alert>{error}</Alert>
        ) : impact ? (
          <div className="rounded-xl border border-gray-200 dark:border-[#222738] bg-gray-50 dark:bg-[#0e1118] p-4 space-y-2.5">
            <div className="text-xs font-semibold text-gray-700 dark:text-slate-300">Affected Resources:</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white dark:bg-[#151821] p-2.5 border border-gray-200 dark:border-[#222738]">
                <span className="text-muted block text-[11px]">Team Name</span>
                <span className="font-semibold text-gray-900 dark:text-slate-100">{impact.teamName}</span>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#151821] p-2.5 border border-gray-200 dark:border-[#222738]">
                <span className="text-muted block text-[11px]">Members</span>
                <span className="font-semibold text-gray-900 dark:text-slate-100">{impact.memberCount} active member(s)</span>
              </div>
              <div className="rounded-lg bg-white dark:bg-[#151821] p-2.5 border border-gray-200 dark:border-[#222738] col-span-2">
                <span className="text-muted block text-[11px]">Active Tasks</span>
                <span className="font-semibold text-gray-900 dark:text-slate-100">{impact.activeTaskCount} scheduled / in-progress task(s)</span>
              </div>
            </div>
          </div>
        ) : null}

        {error && impact && <Alert>{error}</Alert>}

        <div className="space-y-1.5 pt-1">
          <label className="block text-xs font-medium text-gray-700 dark:text-slate-300">
            Type <span className="font-bold text-gray-900 dark:text-slate-100 select-all">{manager.name}</span> to confirm deletion:
          </label>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={manager.name}
            className="w-full rounded-lg border border-gray-300 dark:border-[#222738] bg-white dark:bg-[#0e1118] px-3 py-2 text-xs text-gray-900 dark:text-slate-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-[#222738]">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <button
            type="button"
            disabled={!isConfirmed || busy}
            onClick={handleDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : 'I understand the consequences, delete this manager'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
