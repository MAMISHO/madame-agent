import { createAction, props } from '@ngrx/store';
import { SessionStats, SummaryStats } from '../../domain/stats.model';

// Summary Stats
export const loadSummaryStats = createAction('[Stats] Load Summary');
export const loadSummaryStatsSuccess = createAction('[Stats] Load Summary Success', props<{ summary: SummaryStats }>());
export const loadSummaryStatsFailure = createAction('[Stats] Load Summary Failure', props<{ error: string }>());

// Detailed Stats
export const loadDetailedStats = createAction('[Stats] Load Detailed');
export const loadDetailedStatsSuccess = createAction('[Stats] Load Detailed Success', props<{ sessions: SessionStats[] }>());
export const loadDetailedStatsFailure = createAction('[Stats] Load Detailed Failure', props<{ error: string }>());

// Toggle session expand
export const toggleSessionExpand = createAction('[Stats] Toggle Session Expand', props<{ sessionId: string }>());
