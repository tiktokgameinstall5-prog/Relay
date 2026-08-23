/**
 * The one-time confirmation shown right after provisioning a manager or a member.
 * Shared so both invite flows read identically — same passcode-expiry line, same
 * "the API never returns the passcode" note.
 *
 * Why it carries the expiry at all: the list-reads can never show it. POST
 * /api/auth/{managers,members} has no passcode field (api-response.dto.ts:102-104)
 * — the plaintext exists in exactly one place, the invite email — and the expiry
 * is returned only on the create response, never re-returned on a read. So this
 * alert, shown once immediately after creation, is the only place it surfaces.
 */
import { MailCheck, MailWarning, Terminal } from 'lucide-react';
import { Alert } from './Alert';
import { fmtDateTime } from '../lib/format';

export function InviteResult({
  name,
  inviteEmailSent,
  passcodeExpiresAt,
  action = 'created',
}: {
  name: string;
  inviteEmailSent: boolean;
  /** ISO 8601 from the create response. */
  passcodeExpiresAt: string;
  /** The verb for this flow — a manager is "created", a member "added". */
  action?: string;
}) {
  return (
    <Alert tone={inviteEmailSent ? 'success' : 'error'}>
      <div className="flex items-start gap-2">
        {inviteEmailSent ? (
          <MailCheck size={16} className="mt-0.5 shrink-0" />
        ) : (
          <MailWarning size={16} className="mt-0.5 shrink-0" />
        )}
        <div>
          <strong>{name}</strong> was {action}.{' '}
          {inviteEmailSent
            ? 'The invite email was sent.'
            : 'The invite email FAILED to send — the account exists and the passcode can be reissued.'}
          <div className="mt-1">
            Passcode expires <strong>{fmtDateTime(passcodeExpiresAt)}</strong>.
          </div>
          <div className="mt-1 flex items-start gap-1.5 text-[12px]">
            <Terminal size={13} className="mt-0.5 shrink-0" />
            <span>
              The passcode is never returned by the API. In development the console mail driver
              prints the whole email to the API log — read it there.
            </span>
          </div>
        </div>
      </div>
    </Alert>
  );
}
