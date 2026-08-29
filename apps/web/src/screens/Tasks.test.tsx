/**
 * Component tests for the Tasks and Relay workflow screen (CLAUDE.md §2, §9).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Tasks } from './Tasks';
import { useAuth } from '../auth/AuthContext';
import * as workflowApi from '../api/workflow';
import * as authApi from '../api/auth';
import type { MeResponse, TaskResponse, TeamListRow, MemberRow } from '../api/types';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

vi.mock('../api/workflow', () => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  forwardStep: vi.fn(),
}));
const mockedWorkflow = vi.mocked(workflowApi);

vi.mock('../api/auth', () => ({
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
}));
const mockedAuth = vi.mocked(authApi);

function fakeUser(role: 'owner' | 'manager' | 'member', id = 'u1', name = 'Alice'): MeResponse {
  return {
    id,
    orgId: 'o1',
    organizationName: 'Test Org',
    role,
    name,
    email: `${name.toLowerCase()}@relay.test`,
    managerId: role === 'owner' ? null : 'm1',
    teamId: role === 'owner' ? null : 't1',
    roleTitle: null,
    workflowStep: null,
    ranking: 0,
    isReporter: false,
  };
}

const mockTaskInProgress: TaskResponse = {
  id: 'task-1',
  teamId: 'team-1',
  name: 'Launch Campaign Video',
  type: 'video',
  description: 'Produce launch video clip',
  status: 'in_progress',
  totalSteps: 2,
  completedSteps: 0,
  currentStepOrder: 1,
  currentAssignee: {
    id: 'u-member-1',
    name: 'Bob Member',
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  steps: [
    {
      id: 'step-1',
      stepOrder: 1,
      status: 'active',
      assignedUserId: 'u-member-1',
      assignedUserName: 'Bob Member',
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSeconds: 120,
    },
    {
      id: 'step-2',
      stepOrder: 2,
      status: 'pending',
      assignedUserId: 'u-member-2',
      assignedUserName: 'Charlie Reviewer',
      startedAt: null,
      completedAt: null,
      durationSeconds: null,
    },
  ],
};

describe('Tasks Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders task list with relay chain and status indicators', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Launch Campaign Video')).toBeInTheDocument();
    expect(screen.getByText('Produce launch video clip')).toBeInTheDocument();
    expect(screen.getByText('0/2 steps')).toBeInTheDocument();
    expect(screen.getByText('Currently with: Bob Member')).toBeInTheDocument();
    expect(screen.getByText('Assign task')).toBeInTheDocument();
  });

  it('renders empty state for manager with assign button when no tasks exist', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No tasks assigned yet')).toBeInTheDocument();
    expect(screen.getByText('Assign first task')).toBeInTheDocument();
  });

  it('shows prominent Forward button for active assignee (Bob Member)', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-member-1', 'Bob Member'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const forwardBtn = await screen.findByRole('button', { name: /forward to charlie/i });
    expect(forwardBtn).toBeInTheDocument();
  });

  it('does NOT show Forward button for non-active member', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-member-2', 'Charlie Reviewer'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Launch Campaign Video')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forward/i })).not.toBeInTheDocument();
  });

  it('allows active assignee to click Forward and trigger forwardStep', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-member-1', 'Bob Member'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);
    mockedWorkflow.forwardStep.mockResolvedValue({
      ...mockTaskInProgress,
      completedSteps: 1,
      currentStepOrder: 2,
      currentAssignee: { id: 'u-member-2', name: 'Charlie Reviewer' },
    });

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const forwardBtn = await screen.findByRole('button', { name: /forward to charlie/i });
    await user.click(forwardBtn);

    expect(mockedWorkflow.forwardStep).toHaveBeenCalledWith('task-1');
  });

  it('allows Manager to open modal, pick members in relay order, and submit task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);

    const mockTeam: TeamListRow = {
      id: 'team-1',
      name: 'Alpha Team',
      managerId: 'm1',
      managerName: 'Manager Alice',
      managerEmail: 'alice@relay.test',
      memberCount: 2,
      pendingInviteCount: 0,
      createdAt: new Date().toISOString(),
    };
    const mockMembers: MemberRow[] = [
      {
        id: 'u-member-1',
        name: 'Bob Member',
        email: 'bob@relay.test',
        role: 'member',
        status: 'active',
        pendingInvite: false,
        teamId: 'team-1',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'u-member-2',
        name: 'Charlie Reviewer',
        email: 'charlie@relay.test',
        role: 'member',
        status: 'active',
        pendingInvite: false,
        teamId: 'team-1',
        createdAt: new Date().toISOString(),
      },
    ];
    mockedAuth.listTeams.mockResolvedValue([mockTeam]);
    mockedAuth.listTeamMembers.mockResolvedValue(mockMembers);
    mockedWorkflow.createTask.mockResolvedValue(mockTaskInProgress);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const assignBtn = await screen.findByRole('button', { name: /assign task/i });
    await user.click(assignBtn);

    expect(screen.getByText('Assign new task relay')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/brand launch video/i);
    await user.type(nameInput, 'Sprint Demo Task');

    // Add Bob and Charlie to the relay
    const addBobBtn = await screen.findByRole('button', { name: /bob member/i });
    await user.click(addBobBtn);

    const addCharlieBtn = await screen.findByRole('button', { name: /charlie reviewer/i });
    await user.click(addCharlieBtn);

    const submitBtn = screen.getByRole('button', { name: /create relay task/i });
    await user.click(submitBtn);

    expect(mockedWorkflow.createTask).toHaveBeenCalledWith({
      name: 'Sprint Demo Task',
      type: 'text',
      description: undefined,
      memberIds: ['u-member-1', 'u-member-2'],
    });
  });
});
