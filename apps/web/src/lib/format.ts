/**
 * Date / duration formatting helpers, ported from workspace-relay-prototype.jsx:82-101.
 *
 * The prototype computed everything against a fixed module-level `NOW`; here the
 * "now" reference is read at call time (Date.now()) so relative labels stay live.
 * Inputs are ISO date strings — what the API returns — or null/undefined; every
 * helper renders an em dash for an absent input, matching the prototype exactly.
 */

/** "5m ago" / "3h ago" / "2d ago" for an ISO timestamp; em dash when absent. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Elapsed time between two ISO timestamps as "45m" / "3h 20m" / "2d 4h".
 * `endIso` defaults to now when omitted or null (an in-progress step). Em dash
 * when there is no start.
 */
export function duration(startIso: string | null | undefined, endIso?: string | null): string {
  if (!startIso) return '—';
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const mins = Math.round((end - new Date(startIso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

/** Compact "22 Aug, 14:30" date+time (en-GB, 24h); em dash when absent. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
