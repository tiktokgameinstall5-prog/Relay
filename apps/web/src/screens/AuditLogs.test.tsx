import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogs } from './AuditLogs';
import { useAuth } from '../auth/AuthContext';
import * as auditApi from '../api/audit';
import type { AuditLogListResponse, MeResponse } from '../api/types';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

vi.mock('../api/audit', () => ({
  getAuditLogs: vi.fn(),
}));
const mockedAuditApi = vi.mocked(auditApi);

function fakeOwner(): MeResponse {
  return {
    id: 'owner-1',
    orgId: 'org-1',
    organizationName: 'Acme Corp',
    role: 'owner',
    name: 'Alice Owner',
    email: 'alice@acme.test',
    managerId: null,
    teamId: null,
    roleTitle: null,
    workflowStep: null,
    ranking: 100,
    isReporter: false,
  };
}

const mockAuditLogs: AuditLogListResponse = {
  items: [
    {
      id: 'log-1',
      orgId: 'org-1',
      userId: 'owner-1',
      userName: 'Alice Owner',
      action: 'manager.provisioned',
      entityType: 'user',
      entityId: 'mgr-1',
      metadata: { email: 'mgr@acme.test' },
      ipAddress: '127.0.0.1',
      createdAt: '2026-09-04T12:00:00.000Z',
    },
    {
      id: 'log-2',
      orgId: 'org-1',
      userId: 'owner-1',
      userName: 'Alice Owner',
      action: 'member.deactivated',
      entityType: 'user',
      entityId: 'mem-1',
      metadata: { reason: 'contract ended' },
      ipAddress: '127.0.0.1',
      createdAt: '2026-09-04T12:30:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

describe('AuditLogs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      user: fakeOwner(),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
      refresh: vi.fn(),
    });
    mockedAuditApi.getAuditLogs.mockResolvedValue(mockAuditLogs);
  });

  it('renders audit logs header and events table', async () => {
    render(<AuditLogs />);

    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
    expect(
      screen.getByText('Immutable organization event log. Scoped strictly to your tenant.'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('manager.provisioned')).toBeInTheDocument();
      expect(screen.getByText('member.deactivated')).toBeInTheDocument();
    });

    expect(
      screen.getByText((_, el) => el?.textContent?.trim() === 'Showing 2 of 2 total events'),
    ).toBeInTheDocument();
  });

  it('filters audit logs when typing in action filter', async () => {
    const user = userEvent.setup();
    render(<AuditLogs />);

    await waitFor(() => {
      expect(screen.getByText('manager.provisioned')).toBeInTheDocument();
    });

    const actionInput = screen.getByPlaceholderText('e.g. member.deactivated');
    await user.type(actionInput, 'member.deactivated');

    await waitFor(() => {
      expect(mockedAuditApi.getAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'member.deactivated',
        }),
      );
    });
  });

  it('renders empty state when no events exist', async () => {
    mockedAuditApi.getAuditLogs.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    render(<AuditLogs />);

    await waitFor(() => {
      expect(
        screen.getByText('No audit log records found for the selected criteria.'),
      ).toBeInTheDocument();
    });
  });
});
