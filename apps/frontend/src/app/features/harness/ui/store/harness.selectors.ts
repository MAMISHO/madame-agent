import { createFeatureSelector, createSelector } from '@ngrx/store';
import { HarnessState } from './harness.reducer';

export const selectHarnessState = createFeatureSelector<HarnessState>('harness');

export const selectAllHarnesses = createSelector(
  selectHarnessState,
  (state) => state.harnesses
);

export const selectSelectedHarness = createSelector(
  selectHarnessState,
  (state) => state.selectedHarness
);

export const selectHarnessLoading = createSelector(
  selectHarnessState,
  (state) => state.loading
);

export const selectHarnessError = createSelector(
  selectHarnessState,
  (state) => state.error
);

export const selectAllProviders = createSelector(
  selectHarnessState,
  (state) => state.providers
);

export const selectAllScalableModels = createSelector(
  selectHarnessState,
  (state) => state.scalableModels
);
