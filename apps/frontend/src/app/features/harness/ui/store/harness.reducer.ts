import { createReducer, on } from '@ngrx/store';
import { Harness } from '../../domain/harness.model';
import { ProviderConfig } from '../../domain/provider.model';
import { ScalableModelConfig } from '../../domain/scalable-model.model';
import * as HarnessActions from './harness.actions';

export interface HarnessState {
  harnesses: Harness[];
  providers: ProviderConfig[];
  scalableModels: ScalableModelConfig[];
  selectedHarness: Harness | null;
  loading: boolean;
  error: string | null;
}

export const initialHarnessState: HarnessState = {
  harnesses: [],
  providers: [],
  scalableModels: [],
  selectedHarness: null,
  loading: false,
  error: null,
};

export const harnessReducer = createReducer(
  initialHarnessState,

  on(HarnessActions.loadHarnesses, (state) => ({
    ...state,
    loading: true,
  })),

  on(HarnessActions.loadHarnessesSuccess, (state, { harnesses }) => {
    const active = harnesses.find((h) => h.isActive) || harnesses[0] || null;
    return {
      ...state,
      harnesses,
      selectedHarness: state.selectedHarness
        ? (harnesses.find(h => h.id === state.selectedHarness?.id) || active)
        : active,
      loading: false,
      error: null,
    };
  }),

  on(HarnessActions.loadHarnessesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(HarnessActions.selectHarness, (state, { harness }) => ({
    ...state,
    selectedHarness: harness,
  })),

  // Optimistic Create Harness
  on(HarnessActions.createHarnessOptimistic, (state, { code, name, tempId }) => {
    const tempHarness: Harness = {
      id: tempId,
      code,
      name,
      isDefault: false,
      isActive: false,
      agents: [],
    };
    return {
      ...state,
      harnesses: [...state.harnesses, tempHarness],
    };
  }),

  on(HarnessActions.createHarnessSuccess, (state, { tempId, harness }) => {
    const updatedHarnesses = state.harnesses.map((h) => (h.id === tempId ? harness : h));
    const wasSelected = state.selectedHarness?.id === tempId;
    return {
      ...state,
      harnesses: updatedHarnesses,
      selectedHarness: wasSelected ? harness : state.selectedHarness,
    };
  }),

  on(HarnessActions.createHarnessFailure, (state, { tempId }) => ({
    ...state,
    harnesses: state.harnesses.filter((h) => h.id !== tempId),
  })),

  // Optimistic Delete Harness
  on(HarnessActions.deleteHarnessOptimistic, (state, { harness }) => {
    const updatedList = state.harnesses.filter((h) => h.id !== harness.id);
    let nextSelected = state.selectedHarness;
    if (state.selectedHarness?.id === harness.id) {
      nextSelected = updatedList.find(h => h.isDefault) || updatedList[0] || null;
    }
    return {
      ...state,
      harnesses: updatedList,
      selectedHarness: nextSelected,
    };
  }),

  on(HarnessActions.deleteHarnessFailure, (state, { harness, previousSelected }) => ({
    ...state,
    harnesses: [...state.harnesses, harness],
    selectedHarness: previousSelected,
  })),

  // Activate Harness
  on(HarnessActions.makeHarnessActive, (state, { harness }) => {
    const updatedList = state.harnesses.map((h) => ({
      ...h,
      isActive: h.id === harness.id,
    }));
    return {
      ...state,
      harnesses: updatedList,
      selectedHarness: state.selectedHarness?.id === harness.id
        ? { ...state.selectedHarness, isActive: true }
        : (state.selectedHarness ? { ...state.selectedHarness, isActive: false } : null),
    };
  }),

  // Update Agent Prompt
  on(HarnessActions.updateAgentPromptSuccess, (state, { harnessId, role, prompt, providerId, modelName }) => {
    const updatedList = state.harnesses.map((h) => {
      if (h.id !== harnessId) return h;
      const updatedAgents = (h.agents || []).map((agent) =>
        agent.role === role ? { ...agent, prompt, providerId, modelName } : agent
      );
      return { ...h, agents: updatedAgents };
    });

    let nextSelected = state.selectedHarness;
    if (state.selectedHarness?.id === harnessId) {
      const updatedAgents = (state.selectedHarness.agents || []).map((agent) =>
        agent.role === role ? { ...agent, prompt, providerId, modelName } : agent
      );
      nextSelected = { ...state.selectedHarness, agents: updatedAgents };
    }

    return {
      ...state,
      harnesses: updatedList,
      selectedHarness: nextSelected,
    };
  }),

  // Providers Reducers
  on(HarnessActions.loadProviders, (state) => ({
    ...state,
    loading: true,
  })),

  on(HarnessActions.loadProvidersSuccess, (state, { providers }) => ({
    ...state,
    providers,
    loading: false,
  })),

  on(HarnessActions.loadProvidersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(HarnessActions.createProviderSuccess, (state, { provider }) => ({
    ...state,
    providers: [...state.providers, provider],
  })),

  on(HarnessActions.deleteProviderSuccess, (state, { id }) => ({
    ...state,
    providers: state.providers.filter((p) => p.id !== id),
  })),

  // ScalableModels Reducers
  on(HarnessActions.loadScalableModels, (state) => ({
    ...state,
    loading: true,
  })),

  on(HarnessActions.loadScalableModelsSuccess, (state, { models }) => ({
    ...state,
    scalableModels: models,
    loading: false,
  })),

  on(HarnessActions.loadScalableModelsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(HarnessActions.createScalableModelSuccess, (state, { model }) => ({
    ...state,
    scalableModels: [...state.scalableModels, model],
  })),

  on(HarnessActions.deleteScalableModelSuccess, (state, { id }) => ({
    ...state,
    scalableModels: state.scalableModels.filter((m) => m.id !== id),
  }))
);
