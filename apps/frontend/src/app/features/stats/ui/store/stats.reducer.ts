import { createReducer, on } from '@ngrx/store';
import { SessionStats, SummaryStats } from '../../domain/stats.model';
import * as StatsActions from './stats.actions';

export interface StatsState {
  summary: SummaryStats | null;
  sessions: SessionStats[];
  loading: boolean;
  error: string | null;
}

export const initialStatsState: StatsState = {
  summary: null,
  sessions: [],
  loading: false,
  error: null,
};

export const statsReducer = createReducer(
  initialStatsState,

  on(StatsActions.loadSummaryStats, (state) => ({
    ...state,
    loading: true,
  })),

  on(StatsActions.loadSummaryStatsSuccess, (state, { summary }) => ({
    ...state,
    summary,
    loading: false,
    error: null,
  })),

  on(StatsActions.loadSummaryStatsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(StatsActions.loadDetailedStats, (state) => ({
    ...state,
    loading: true,
  })),

  on(StatsActions.loadDetailedStatsSuccess, (state, { sessions }) => ({
    ...state,
    sessions: sessions.map((s) => ({ ...s, expanded: false })),
    loading: false,
    error: null,
  })),

  on(StatsActions.loadDetailedStatsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(StatsActions.toggleSessionExpand, (state, { sessionId }) => ({
    ...state,
    sessions: state.sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, expanded: !s.expanded } : s
    ),
  }))
);
