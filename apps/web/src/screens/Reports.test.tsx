/**
 * Component tests for the Completion Reports screen (CLAUDE.md §4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Reports } from './Reports';
import { useAuth } from '../auth/AuthContext';
import * as reportsApi from '../api/reports';
import * as workflowApi from '../api/workflow';
import type { MeResponse, TaskReportResponse, TaskResponse } from '../api/types';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

vi.mock('../api/reports', () => ({
  listReports: vi.fn(),
  createReport: vi.fn(),
}));
const mockedReports = vi.mocked(reportsApi);

vi.mock('../api/workflow', () => ({
  listTasks: vi.fn(),
}));
const mockedWorkflow = vi.mocked(workflowApi);

function fakeUser(
  role: 'owner' | 'manager' | 'member',
  id = 'u-rep-1',
  name = 'Rachel Reporter',
  isReporter = true,
): MeResponse {
  return {
    id,
    orgId: 'o1',
    organizationName: 'Test Org',
    role,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@relay.test`,
    managerId: role === 'owner' ? null : 'm1',
    teamId: role === 'owner' ? null : 't1',
    roleTitle: null,
    workflowStep: null,
    ranking: 90,
    isReporter,
  };
}

const mockReportsList: TaskReportResponse[] = [
  {
    id: 'rep-1',
    taskId: 'task-100',
    taskName: 'Q3 Brand Campaign',
    reportedByUserId: 'u-rep-1',
    reportedByName: 'Rachel Reporter',
    summary: 'Successfully finished final video cut and delivered deliverables.',
    highlights: 'Delivered 2 days early. Great team collaboration.',
    blockers: 'Minor delay on font licensing resolved on step 2.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'rep-2',
    taskId: 'task-200',
    taskName: 'Product Documentation',
    reportedByUserId: 'u-rep-1',
    reportedByName: 'Rachel Reporter',
    summary: 'All API routes documented with OpenAPI schemas.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockCompletedTasks: TaskResponse[] = [
  {
    id: 'task-300',
    teamId: 't1',
    name: 'Website Redesign',
    type: 'file',
    description: 'New landing page',
    status: 'completed',
    scheduledFor: null,
    totalSteps: 3,
    completedSteps: 3,
    currentStepOrder: 3,
    currentAssignee: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
  },
];

describe('Reports Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders reports feed with report summary, task name, and reporter name', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-rep-1', 'Rachel Reporter', true),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Q3 Brand Campaign')).toBeInTheDocument();
    expect(
      screen.getByText('Successfully finished final video cut and delivered deliverables.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Product Documentation')).toBeInTheDocument();
    expect(
      screen.getByText('All API routes documented with OpenAPI schemas.'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 reports')).toBeInTheDocument();
  });

  it('allows expanding and collapsing report details (highlights & blockers)', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-rep-1', 'Rachel Reporter', true),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    const showDetailsBtn = await screen.findByRole('button', { name: /show details/i });
    await user.click(showDetailsBtn);

    expect(screen.getByText('Key Highlights')).toBeInTheDocument();
    expect(
      screen.getByText('Delivered 2 days early. Great team collaboration.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Blockers & Follow-ups')).toBeInTheDocument();
    expect(
      screen.getByText('Minor delay on font licensing resolved on step 2.'),
    ).toBeInTheDocument();

    const hideDetailsBtn = screen.getByRole('button', { name: /hide details/i });
    await user.click(hideDetailsBtn);

    expect(screen.queryByText('Key Highlights')).not.toBeInTheDocument();
  });

  it('shows Write Completion Report button to designated reporter', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-rep-1', 'Rachel Reporter', true),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: /write completion report/i })).toBeInTheDocument();
    expect(screen.queryByText(/read-only access:/i)).not.toBeInTheDocument();
  });

  it('shows Write Completion Report button to Manager even if not designated reporter', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'u-mgr-1', 'Alice Manager', false),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: /write completion report/i })).toBeInTheDocument();
  });

  it('hides Write Completion Report button and shows read-only banner for non-reporter member', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-reg-1', 'Regular Member', false),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/read-only access:/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write completion report/i })).not.toBeInTheDocument();
  });

  it('allows reporter to open modal, select completed task, fill summary, and submit', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-rep-1', 'Rachel Reporter', true),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue(mockReportsList);
    mockedWorkflow.listTasks.mockResolvedValue(mockCompletedTasks);
    mockedReports.createReport.mockResolvedValue({
      id: 'rep-3',
      taskId: 'task-300',
      taskName: 'Website Redesign',
      reportedByUserId: 'u-rep-1',
      reportedByName: 'Rachel Reporter',
      summary: 'Delivered clean responsive landing page across mobile and desktop.',
      highlights: '100 lighthouse performance score',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    const writeBtn = await screen.findByRole('button', { name: /write completion report/i });
    await user.click(writeBtn);

    expect(screen.getByRole('heading', { name: 'Write Completion Report' })).toBeInTheDocument();

    const taskSelect = await screen.findByLabelText(/completed task \*/i);
    await user.selectOptions(taskSelect, 'task-300');

    const summaryInput = screen.getByLabelText(/delivery summary \(required\) \*/i);
    await user.type(
      summaryInput,
      'Delivered clean responsive landing page across mobile and desktop.',
    );

    const highlightsInput = screen.getByLabelText(/key highlights \(optional\)/i);
    await user.type(highlightsInput, '100 lighthouse performance score');

    const submitBtn = screen.getByRole('button', { name: /submit report/i });
    await user.click(submitBtn);

    expect(mockedReports.createReport).toHaveBeenCalledWith('task-300', {
      summary: 'Delivered clean responsive landing page across mobile and desktop.',
      highlights: '100 lighthouse performance score',
    });
  });

  it('displays empty state when no completion reports exist', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-rep-1', 'Rachel Reporter', true),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedReports.listReports.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No completion reports yet')).toBeInTheDocument();
  });
});
