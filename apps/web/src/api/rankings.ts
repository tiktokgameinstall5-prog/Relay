/**
 * Rankings API functions (CLAUDE.md §4).
 */
import { request } from './client';
import type {
  LeaderboardUser,
  RankingEventResponse,
  UpdateRankingInput,
  SetReporterInput,
} from './types';

/** GET /api/rankings/leaderboard — get team/org leaderboard */
export function getLeaderboard(): Promise<LeaderboardUser[]> {
  return request<LeaderboardUser[]>('/rankings/leaderboard');
}

/** PATCH /api/rankings/:userId — update member ranking with audit reason */
export function updateRanking(
  userId: string,
  input: UpdateRankingInput,
): Promise<LeaderboardUser> {
  return request<LeaderboardUser>(`/rankings/${userId}`, {
    method: 'PATCH',
    body: input,
  });
}

/** PATCH /api/rankings/:userId/reporter — toggle reporter status */
export function setReporterStatus(
  userId: string,
  input: SetReporterInput,
): Promise<{ id: string; isReporter: boolean }> {
  return request<{ id: string; isReporter: boolean }>(`/rankings/${userId}/reporter`, {
    method: 'PATCH',
    body: input,
  });
}

/** GET /api/rankings/:userId/history — get audit history of ranking changes */
export function getRankingHistory(userId: string): Promise<RankingEventResponse[]> {
  return request<RankingEventResponse[]>(`/rankings/${userId}/history`);
}
