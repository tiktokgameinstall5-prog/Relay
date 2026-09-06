/**
 * Component tests for the Tasks and Relay workflow screen (CLAUDE.md §2, §9).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  downloadAttachmentFile: vi.fn(),
  getAttachmentDownloadUrl: vi.fn((taskId: string, attId: string) => `/api/tasks/${taskId}/attachments/${attId}/download`),
}));
const mockedWorkflow = vi.mocked(workflowApi);

vi.mock('../api/auth', () => ({
  listTeams: vi.fn(),
  listTeamMembers: vi.fn(),
  listManagers: vi.fn(),
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
  scheduledFor: null,
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

  it('allows active assignee to click Peer Hand-off, select teammate, and call forwardStep with targetUserId', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-member-1', 'Bob Member'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);
    mockedAuth.listTeamMembers.mockResolvedValue([
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
        id: 'u-member-3',
        name: 'Dave Teammate',
        email: 'dave@relay.test',
        role: 'member',
        status: 'active',
        pendingInvite: false,
        teamId: 'team-1',
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedWorkflow.forwardStep.mockResolvedValue({
      ...mockTaskInProgress,
      currentStepOrder: 2,
      currentAssignee: { id: 'u-member-3', name: 'Dave Teammate' },
    });

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const handoffToggleBtn = await screen.findByRole('button', { name: /hand off to peer/i });
    await user.click(handoffToggleBtn);

    const peerBtn = await screen.findByRole('button', { name: /dave teammate/i });
    await user.click(peerBtn);

    expect(mockedWorkflow.forwardStep).toHaveBeenCalledWith('task-1', {
      targetUserId: 'u-member-3',
    });
  });

  it('allows Owner to open modal, select Manager target mode, and assign direct task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('owner', 'o1', 'Owner Oscar'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);
    mockedAuth.listTeams.mockResolvedValue([
      {
        id: 'team-1',
        name: 'Alpha Team',
        managerId: 'm1',
        managerName: 'Manager Alice',
        managerEmail: 'alice@relay.test',
        memberCount: 2,
        pendingInviteCount: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedAuth.listManagers.mockResolvedValue([
      {
        id: 'm1',
        name: 'Manager Alice',
        email: 'alice@relay.test',
        status: 'active',
        pendingInvite: false,
        teamId: 'team-1',
        teamName: 'Alpha Team',
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedWorkflow.createTask.mockResolvedValue(mockTaskInProgress);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const assignBtn = await screen.findByRole('button', { name: /assign task/i });
    await user.click(assignBtn);

    expect(screen.getByText('Assign task (Owner)')).toBeInTheDocument();

    const managerModeBtn = screen.getByRole('button', { name: /manager/i });
    await user.click(managerModeBtn);

    const nameInput = screen.getByPlaceholderText(/brand launch video/i);
    await user.type(nameInput, 'Quarterly Review Task');

    const submitBtn = screen.getByRole('button', { name: /confirm assignment/i });
    await user.click(submitBtn);

    expect(mockedWorkflow.createTask).toHaveBeenCalledWith({
      name: 'Quarterly Review Task',
      type: 'text',
      description: undefined,
      targetManagerId: 'm1',
    });
  });

  it('allows Owner to open modal, select Member target mode, and assign direct task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('owner', 'o1', 'Owner Oscar'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);
    mockedAuth.listTeams.mockResolvedValue([
      {
        id: 'team-1',
        name: 'Alpha Team',
        managerId: 'm1',
        managerName: 'Manager Alice',
        managerEmail: 'alice@relay.test',
        memberCount: 2,
        pendingInviteCount: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedAuth.listTeamMembers.mockResolvedValue([
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
    ]);
    mockedWorkflow.createTask.mockResolvedValue(mockTaskInProgress);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const assignBtn = await screen.findByRole('button', { name: /assign task/i });
    await user.click(assignBtn);

    const memberModeBtn = screen.getByRole('button', { name: /specific member/i });
    await user.click(memberModeBtn);

    const nameInput = screen.getByPlaceholderText(/brand launch video/i);
    await user.type(nameInput, 'Direct Member Task');

    // Wait for member select to populate
    const memberSelect = await screen.findByLabelText('Select target member');
    await user.selectOptions(memberSelect, 'u-member-1');

    const submitBtn = screen.getByRole('button', { name: /confirm assignment/i });
    await user.click(submitBtn);

    expect(mockedWorkflow.createTask).toHaveBeenCalledWith({
      name: 'Direct Member Task',
      type: 'text',
      description: undefined,
      targetMemberId: 'u-member-1',
    });
  });

  it('lists attachments, renders video preview for video attachments, and shows lossless download link', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);
    mockedWorkflow.listAttachments.mockResolvedValue([
      {
        id: 'att-1',
        taskId: 'task-1',
        fileName: 'raw_master_clip.mp4',
        fileSize: 10485760, // 10 MB
        mimeType: 'video/mp4',
        checksumSha256: 'abc123sha',
        uploadedByUserId: 'm1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const toggleBtn = await screen.findByRole('button', { name: /attachments/i });
    await user.click(toggleBtn);

    expect(await screen.findByText('raw_master_clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('(10.0 MB)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /lossless video/i })).toHaveAttribute(
      'href',
      '/api/tasks/task-1/attachments/att-1/download',
    );
  });

  it('allows user to upload an attachment to a task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);
    mockedWorkflow.listAttachments.mockResolvedValue([]);
    mockedWorkflow.uploadAttachment.mockResolvedValue({
      id: 'att-2',
      taskId: 'task-1',
      fileName: 'specs.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      checksumSha256: 'def456sha',
      uploadedByUserId: 'm1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const toggleBtn = await screen.findByRole('button', { name: /attachments/i });
    await user.click(toggleBtn);

    const fileInput = screen.getByLabelText(/upload attachment/i);
    const testFile = new File(['dummy content'], 'specs.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, testFile);

    expect(mockedWorkflow.uploadAttachment).toHaveBeenCalledWith('task-1', testFile);
    expect(await screen.findByText('specs.pdf')).toBeInTheDocument();
  });

  it('allows user to delete an attachment from a task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([mockTaskInProgress]);
    mockedWorkflow.listAttachments.mockResolvedValue([
      {
        id: 'att-1',
        taskId: 'task-1',
        fileName: 'temp.txt',
        fileSize: 100,
        mimeType: 'text/plain',
        checksumSha256: 'xyz',
        uploadedByUserId: 'm1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    mockedWorkflow.deleteAttachment.mockResolvedValue();

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const toggleBtn = await screen.findByRole('button', { name: /attachments/i });
    await user.click(toggleBtn);

    const deleteBtn = await screen.findByRole('button', { name: /delete temp\.txt/i });
    await user.click(deleteBtn);

    expect(mockedWorkflow.deleteAttachment).toHaveBeenCalledWith('task-1', 'att-1');
  });

  it('renders scheduled task with Scheduled status chip and clock indicator', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const mockScheduledTask: TaskResponse = {
      ...mockTaskInProgress,
      id: 'task-scheduled-1',
      name: 'Future Scheduled Release',
      status: 'scheduled',
      scheduledFor: futureDate,
      currentAssignee: null,
      steps: [
        {
          id: 'step-1',
          stepOrder: 1,
          status: 'pending',
          assignedUserId: 'u-member-1',
          assignedUserName: 'Bob Member',
          startedAt: null,
          completedAt: null,
          durationSeconds: null,
        },
      ],
    };
    mockedWorkflow.listTasks.mockResolvedValue([mockScheduledTask]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Future Scheduled Release')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText(/scheduled for:/i)).toBeInTheDocument();
  });

  it('allows Manager to toggle Schedule for later, pick datetime, and submit scheduled task', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);
    mockedAuth.listTeams.mockResolvedValue([
      {
        id: 'team-1',
        name: 'Alpha Team',
        managerId: 'm1',
        managerName: 'Manager Alice',
        managerEmail: 'alice@relay.test',
        memberCount: 1,
        pendingInviteCount: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedAuth.listTeamMembers.mockResolvedValue([
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
    ]);
    mockedWorkflow.createTask.mockResolvedValue(mockTaskInProgress);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const assignBtn = await screen.findByRole('button', { name: /^assign task$/i });
    await user.click(assignBtn);

    const nameInput = screen.getByPlaceholderText(/brand launch video/i);
    await user.type(nameInput, 'Scheduled Sprint Kickoff');

    // Add Bob to relay
    const addBobBtn = await screen.findByRole('button', { name: /bob member/i });
    await user.click(addBobBtn);

    // Toggle Schedule for later
    const scheduleToggle = screen.getByTestId('schedule-toggle');
    await user.click(scheduleToggle);

    // Enter a valid future datetime (e.g. 5 days from now)
    const futureDate = new Date(Date.now() + 5 * 86400000);
    const dateStr = futureDate.toISOString().slice(0, 16);
    const dateInput = screen.getByTestId('scheduled-datetime-input');
    await user.clear(dateInput);
    await user.type(dateInput, dateStr);

    const submitBtn = screen.getByRole('button', { name: /create relay task/i });
    await user.click(submitBtn);

    expect(mockedWorkflow.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Scheduled Sprint Kickoff',
        scheduledFor: expect.any(String),
        memberIds: ['u-member-1'],
      }),
    );
  });

  it('validates scheduled datetime: rejects past date and > 365 days future date with error banner', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'm1', 'Manager Alice'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedWorkflow.listTasks.mockResolvedValue([]);
    mockedAuth.listTeams.mockResolvedValue([
      {
        id: 'team-1',
        name: 'Alpha Team',
        managerId: 'm1',
        managerName: 'Manager Alice',
        managerEmail: 'alice@relay.test',
        memberCount: 1,
        pendingInviteCount: 0,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockedAuth.listTeamMembers.mockResolvedValue([
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
    ]);

    render(
      <MemoryRouter>
        <Tasks />
      </MemoryRouter>,
    );

    const assignBtn = await screen.findByRole('button', { name: /^assign task$/i });
    await user.click(assignBtn);

    const nameInput = screen.getByPlaceholderText(/brand launch video/i);
    await user.type(nameInput, 'Invalid Date Task');

    const addBobBtn = await screen.findByRole('button', { name: /bob member/i });
    await user.click(addBobBtn);

    // Toggle Schedule for later
    const scheduleToggle = screen.getByTestId('schedule-toggle');
    await user.click(scheduleToggle);

    // Try a date in the past
    const pastDate = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
    const dateInput = screen.getByTestId('scheduled-datetime-input');
    await user.clear(dateInput);
    await user.type(dateInput, pastDate);

    const submitBtn = screen.getByRole('button', { name: /create relay task/i });
    await user.click(submitBtn);

    expect(await screen.findByText('Scheduled date must be in the future.')).toBeInTheDocument();
    expect(mockedWorkflow.createTask).not.toHaveBeenCalled();

    // Try a date > 365 days in future
    const tooFarDate = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 16);
    await user.clear(dateInput);
    await user.type(dateInput, tooFarDate);
    await user.click(submitBtn);

    expect(
      await screen.findByText('Scheduled date cannot be more than 365 days in the future.'),
    ).toBeInTheDocument();
    expect(mockedWorkflow.createTask).not.toHaveBeenCalled();
  });
});

