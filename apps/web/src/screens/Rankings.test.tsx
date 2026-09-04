/**
 * Component tests for the Rankings & Leaderboard screen (CLAUDE.md §4).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Rankings } from './Rankings';
import { useAuth } from '../auth/AuthContext';
import * as rankingsApi from '../api/rankings';
import type { MeResponse, LeaderboardUser, RankingEventResponse } from '../api/types';

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

vi.mock('../api/rankings', () => ({
  getLeaderboard: vi.fn(),
  updateRanking: vi.fn(),
  setReporterStatus: vi.fn(),
  getRankingHistory: vi.fn(),
}));
const mockedRankings = vi.mocked(rankingsApi);

function fakeUser(
  role: 'owner' | 'manager' | 'member',
  id = 'u-mgr-1',
  name = 'Alice Manager',
  isReporter = false,
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
    ranking: 85,
    isReporter,
  };
}

const mockLeaderboard: LeaderboardUser[] = [
  {
    id: 'u-1',
    name: 'Top Performer',
    email: 'top@relay.test',
    role: 'member',
    ranking: 98,
    isReporter: true,
    teamId: 't1',
    teamName: 'Alpha Team',
  },
  {
    id: 'u-2',
    name: 'Second Player',
    email: 'second@relay.test',
    role: 'member',
    ranking: 82,
    isReporter: false,
    teamId: 't1',
    teamName: 'Alpha Team',
  },
  {
    id: 'u-3',
    name: 'Third Place',
    email: 'third@relay.test',
    role: 'member',
    ranking: 70,
    isReporter: false,
    teamId: 't1',
    teamName: 'Alpha Team',
  },
];

const mockHistory: RankingEventResponse[] = [
  {
    id: 'ev-1',
    userId: 'u-1',
    changedByUserId: 'u-mgr-1',
    changedByName: 'Alice Manager',
    oldRanking: 90,
    newRanking: 98,
    reason: 'Exceptional delivery velocity and zero defect rate',
    createdAt: new Date().toISOString(),
  },
];

describe('Rankings Screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders leaderboard rows with rank numbers, names, and scores', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Top Performer')).toBeInTheDocument();
    expect(screen.getByText('Second Player')).toBeInTheDocument();
    expect(screen.getByText('Third Place')).toBeInTheDocument();
    expect(screen.getByText('98')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
  });

  it('displays Reporter badge on designated reporters', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-2', 'Second Player'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Top Performer')).toBeInTheDocument();
    expect(screen.getByText('Reporter')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('hides Adjust and Reporter management buttons from Members', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-2', 'Second Player'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Top Performer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /adjust/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make reporter/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my score history/i })).toBeInTheDocument();
  });

  it('shows Adjust, Reporter toggle, and History buttons to Manager', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'u-mgr-1', 'Alice Manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Top Performer')).toBeInTheDocument();
    const adjustButtons = screen.getAllByRole('button', { name: /adjust/i });
    expect(adjustButtons.length).toBe(3);
  });

  it('allows Manager to open Adjust Modal, input score and mandatory reason, and save', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'u-mgr-1', 'Alice Manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);
    mockedRankings.updateRanking.mockResolvedValue({
      id: 'u-1',
      name: 'Top Performer',
      email: 'top@relay.test',
      role: 'member',
      ranking: 100,
      isReporter: true,
      teamId: 't1',
      teamName: 'Alpha Team',
    });

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    const adjustButtons = await screen.findAllByRole('button', { name: /adjust/i });
    await user.click(adjustButtons[0]!);

    expect(screen.getByText(/adjust ranking — top performer/i)).toBeInTheDocument();

    const scoreInput = screen.getByLabelText(/ranking score \(0–100\)/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, '100');

    const reasonInput = screen.getByLabelText(/audit reason \(mandatory\)/i);
    await user.type(reasonInput, 'Flawless handoffs during sprint release');

    const submitBtn = screen.getByRole('button', { name: /save & log event/i });
    await user.click(submitBtn);

    expect(mockedRankings.updateRanking).toHaveBeenCalledWith('u-1', {
      ranking: 100,
      reason: 'Flawless handoffs during sprint release',
    });
  });

  it('allows Manager to toggle designated reporter status', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'u-mgr-1', 'Alice Manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);
    mockedRankings.setReporterStatus.mockResolvedValue({
      id: 'u-2',
      isReporter: true,
    });

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    const row = await screen.findByTestId('ranking-row-u-2');
    const makeReporterBtn = within(row).getByRole('button', { name: /make reporter/i });
    await user.click(makeReporterBtn);

    expect(mockedRankings.setReporterStatus).toHaveBeenCalledWith('u-2', {
      isReporter: true,
    });
  });

  it('allows Manager to open audit history modal and displays audit entries', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager', 'u-mgr-1', 'Alice Manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);
    mockedRankings.getRankingHistory.mockResolvedValue(mockHistory);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    const historyButtons = await screen.findAllByTitle('View audit history');
    await user.click(historyButtons[0]!);

    expect(screen.getByText(/audit trail — top performer/i)).toBeInTheDocument();
    expect(
      await screen.findByText('Exceptional delivery velocity and zero defect rate'),
    ).toBeInTheDocument();
    expect(screen.getByText('Alice Manager')).toBeInTheDocument();
  });

  it('allows Member to view self audit history via "My Score History"', async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue({
      user: fakeUser('member', 'u-1', 'Top Performer'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue(mockLeaderboard);
    mockedRankings.getRankingHistory.mockResolvedValue(mockHistory);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    const myHistoryBtn = await screen.findByRole('button', { name: /my score history/i });
    await user.click(myHistoryBtn);

    expect(screen.getByText(/audit trail — top performer/i)).toBeInTheDocument();
    expect(
      await screen.findByText('Exceptional delivery velocity and zero defect rate'),
    ).toBeInTheDocument();
  });

  it('displays empty state when leaderboard has no members', async () => {
    mockedUseAuth.mockReturnValue({
      user: fakeUser('manager'),
      status: 'authed',
      completeSignIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockedRankings.getLeaderboard.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Rankings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('No members on the leaderboard yet')).toBeInTheDocument();
  });
});
