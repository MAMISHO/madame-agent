import { createAction, props } from '@ngrx/store';
import { Harness, AgentConfig } from '../../domain/harness.model';
import { ProviderConfig } from '../../domain/provider.model';

// Load
export const loadHarnesses = createAction('[Harness] Load Harnesses');
export const loadHarnessesSuccess = createAction('[Harness] Load Harnesses Success', props<{ harnesses: Harness[] }>());
export const loadHarnessesFailure = createAction('[Harness] Load Harnesses Failure', props<{ error: string }>());

// Select
export const selectHarness = createAction('[Harness] Select Harness', props<{ harness: Harness }>());

// Optimistic Create
export const createHarnessOptimistic = createAction('[Harness] Create Harness Optimistic', props<{ code: string; name: string; cloneFromHarnessId?: string; tempId: string }>());
export const createHarnessSuccess = createAction('[Harness] Create Harness Success', props<{ tempId: string; harness: Harness }>());
export const createHarnessFailure = createAction('[Harness] Create Harness Failure', props<{ tempId: string; error: string }>());

// Optimistic Delete
export const deleteHarnessOptimistic = createAction('[Harness] Delete Harness Optimistic', props<{ harness: Harness }>());
export const deleteHarnessSuccess = createAction('[Harness] Delete Harness Success', props<{ id: string }>());
export const deleteHarnessFailure = createAction('[Harness] Delete Harness Failure', props<{ harness: Harness; previousSelected: Harness | null; error: string }>());

// Activate
export const makeHarnessActive = createAction('[Harness] Make Active', props<{ harness: Harness }>());
export const makeHarnessActiveSuccess = createAction('[Harness] Make Active Success', props<{ id: string }>());
export const makeHarnessActiveFailure = createAction('[Harness] Make Active Failure', props<{ error: string }>());

// Update Agent Prompt
export const updateAgentPrompt = createAction(
  '[Harness] Update Agent Prompt',
  props<{ harnessId: string; role: string; prompt: string; providerId: string; modelName: string }>()
);
export const updateAgentPromptSuccess = createAction(
  '[Harness] Update Agent Prompt Success',
  props<{ harnessId: string; role: string; prompt: string; providerId: string; modelName: string }>()
);
export const updateAgentPromptFailure = createAction('[Harness] Update Agent Prompt Failure', props<{ error: string }>());

// Provider CRUD Actions
export const loadProviders = createAction('[Provider] Load Providers');
export const loadProvidersSuccess = createAction('[Provider] Load Providers Success', props<{ providers: ProviderConfig[] }>());
export const loadProvidersFailure = createAction('[Provider] Load Providers Failure', props<{ error: string }>());

export const createProvider = createAction('[Provider] Create Provider', props<{ provider: ProviderConfig }>());
export const createProviderSuccess = createAction('[Provider] Create Provider Success', props<{ provider: ProviderConfig }>());
export const createProviderFailure = createAction('[Provider] Create Provider Failure', props<{ error: string }>());

export const deleteProvider = createAction('[Provider] Delete Provider', props<{ id: string }>());
export const deleteProviderSuccess = createAction('[Provider] Delete Provider Success', props<{ id: string }>());
export const deleteProviderFailure = createAction('[Provider] Delete Provider Failure', props<{ error: string }>());

// ScalableModel CRUD Actions
export const loadScalableModels = createAction('[ScalableModel] Load');
export const loadScalableModelsSuccess = createAction('[ScalableModel] Load Success', props<{ models: import('../../domain/scalable-model.model').ScalableModelConfig[] }>());
export const loadScalableModelsFailure = createAction('[ScalableModel] Load Failure', props<{ error: string }>());

export const createScalableModel = createAction('[ScalableModel] Create', props<{ model: import('../../domain/scalable-model.model').ScalableModelConfig }>());
export const createScalableModelSuccess = createAction('[ScalableModel] Create Success', props<{ model: import('../../domain/scalable-model.model').ScalableModelConfig }>());
export const createScalableModelFailure = createAction('[ScalableModel] Create Failure', props<{ error: string }>());

export const deleteScalableModel = createAction('[ScalableModel] Delete', props<{ id: string }>());
export const deleteScalableModelSuccess = createAction('[ScalableModel] Delete Success', props<{ id: string }>());
export const deleteScalableModelFailure = createAction('[ScalableModel] Delete Failure', props<{ error: string }>());
