import { createFeatureSelector, createSelector } from '@ngrx/store';
import { StatsState } from './stats.reducer';

export const selectStatsState = createFeatureSelector<StatsState>('stats');

export const selectSummaryStats = createSelector(selectStatsState, (state) => state.summary);
export const selectDetailedSessions = createSelector(selectStatsState, (state) => state.sessions);
export const selectStatsLoading = createSelector(selectStatsState, (state) => state.loading);
export const selectStatsError = createSelector(selectStatsState, (state) => state.error);
