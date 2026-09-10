import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Activity,
  Layers,
  Info,
} from 'lucide-react';
import { getAuditLogs } from '../api/audit';
import type { AuditLogItem, AuditLogListResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function AuditLogs() {
  const { session } = useAuth();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AuditLogListResponse>({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
  });

  const [page, setPage] = useState<number>(1);
  const [actionFilter, setActionFilter] = useState<string>('');
  const [actorIdFilter, setActorIdFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogs({
        page,
        limit: 20,
        action: actionFilter ? actionFilter.trim() : undefined,
        actorId: actorIdFilter ? actorIdFilter.trim() : undefined,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
      });
      setData(res);
    } catch (err) {
      setError((err as Error).message || 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, actorIdFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));

  const formatActionBadge = (action: string) => {
    let colorClass = 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
    if (action.includes('deleted') || action.includes('deactivated')) {
      colorClass = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40';
    } else if (action.includes('provisioned') || action.includes('created') || action.includes('restored')) {
      colorClass = 'bg-green-50 text-green-700 border-green-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40';
    } else if (action.includes('ranking') || action.includes('updated')) {
      colorClass = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/40';
    } else if (action.includes('passcode') || action.includes('security')) {
      colorClass = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40';
    }

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}>
        {action}
      </span>
    );
  };

  const handleResetFilters = () => {
    setActionFilter('');
    setActorIdFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-primary h-6 w-6" />
            <h1 className="font-display text-xl font-bold tracking-tight text-gray-900 dark:text-slate-100 sm:text-2xl">
              Audit Logs
            </h1>
          </div>
          <p className="text-muted mt-1 text-sm">
            Immutable organization event log. Scoped strictly to your tenant.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchLogs()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#151821] px-3.5 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 shadow-sm transition hover:bg-gray-50 dark:hover:bg-[#181c27] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#151821] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
            <Filter className="h-3.5 w-3.5" />
            <span>Filter Events</span>
          </div>
          {(actionFilter || actorIdFilter || startDate || endDate) && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-muted block text-xs font-medium mb-1">Action</label>
            <input
              type="text"
              placeholder="e.g. member.deactivated"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#0e1118] px-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-muted block text-xs font-medium mb-1">Actor ID</label>
            <input
              type="text"
              placeholder="UUID string"
              value={actorIdFilter}
              onChange={(e) => {
                setActorIdFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#0e1118] px-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-muted block text-xs font-medium mb-1">From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#0e1118] px-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-muted block text-xs font-medium mb-1">To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#0e1118] px-3 py-1.5 text-xs text-gray-900 dark:text-slate-100 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <div className="font-semibold">Error loading audit trail</div>
          <div>{error}</div>
        </div>
      )}

      {/* Log Table / List */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#151821] shadow-sm">
        <div className="overflow-x-auto no-scrollbar touch-pan-x">
          <table className="w-full text-left text-xs text-gray-600 dark:text-slate-300">
            <thead className="border-b border-gray-200 dark:border-[#222738] bg-gray-50 dark:bg-[#181c27] text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3">Timestamp</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Target Entity</th>
                <th scope="col" className="px-4 py-3">Details / Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-[#222738]">
              {loading && data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      <span>Loading audit logs...</span>
                    </div>
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                    <Info className="mx-auto mb-2 h-6 w-6 text-gray-300 dark:text-slate-600" />
                    No audit log records found for the selected criteria.
                  </td>
                </tr>
              ) : (
                data.items.map((log) => (
                  <tr key={log.id} className="transition hover:bg-gray-50/75 dark:hover:bg-[#181c27]/75">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-gray-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-gray-400 dark:text-slate-500" />
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatActionBadge(log.action)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-slate-100">
                        <User className="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
                        <span>{log.userName || (log.userId ? log.userId.slice(0, 8) + '...' : 'System')}</span>
                      </div>
                      {log.userId && (
                        <div className="font-mono text-[10px] text-gray-400 dark:text-slate-500">{log.userId}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {log.entityType ? (
                        <div className="flex items-center gap-1 text-gray-700 dark:text-slate-300">
                          <span className="font-medium capitalize">{log.entityType}</span>
                          {log.entityId && (
                            <span className="font-mono text-[10px] text-gray-400 dark:text-slate-500">
                              ({log.entityId.slice(0, 8)})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <pre className="max-h-20 max-w-xs overflow-x-auto rounded bg-gray-50 dark:bg-[#0e1118] p-1.5 font-mono text-[10px] text-gray-700 dark:text-slate-300 border border-gray-100 dark:border-[#222738]">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-200 dark:border-[#222738] bg-gray-50/50 dark:bg-[#181c27] px-4 py-3 text-xs text-gray-600 dark:text-slate-400">
          <div>
            Showing <span className="font-medium text-gray-900 dark:text-slate-100">{data.items.length}</span> of{' '}
            <span className="font-medium text-gray-900 dark:text-slate-100">{data.total}</span> total events
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#151821] px-2.5 py-1.5 font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#1e2333] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </button>
            <span className="text-xs font-medium text-gray-700 dark:text-slate-200">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-[#222738] bg-white dark:bg-[#151821] px-2.5 py-1.5 font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-[#1e2333] focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
