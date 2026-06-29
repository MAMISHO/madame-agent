import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, mergeMap, switchMap } from 'rxjs/operators';
import { HarnessService } from '../../data/harness.service';
import * as HarnessActions from './harness.actions';

@Injectable()
export class HarnessEffects {
  private actions$ = inject(Actions);
  private harnessService = inject(HarnessService);

  loadHarnesses$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.loadHarnesses),
      switchMap(() =>
        this.harnessService.getHarnesses().pipe(
          map((harnesses) => HarnessActions.loadHarnessesSuccess({ harnesses })),
          catchError((error) => of(HarnessActions.loadHarnessesFailure({ error: error.message })))
        )
      )
    )
  );

  createHarness$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.createHarnessOptimistic),
      mergeMap(({ code, name, tempId, cloneFromHarnessId }) =>
        this.harnessService.createHarness(code, name, cloneFromHarnessId).pipe(
          map((harness) => HarnessActions.createHarnessSuccess({ tempId, harness })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.createHarnessFailure({ tempId, error: error.message }));
          })
        )
      )
    )
  );

  deleteHarness$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.deleteHarnessOptimistic),
      mergeMap(({ harness }) =>
        this.harnessService.deleteHarness(harness.id).pipe(
          map(() => HarnessActions.deleteHarnessSuccess({ id: harness.id })),
          catchError((error) => {
            alert(error.message);
            return of(
              HarnessActions.deleteHarnessFailure({
                harness,
                previousSelected: harness,
                error: error.message,
              })
            );
          })
        )
      )
    )
  );

  makeActive$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.makeHarnessActive),
      mergeMap(({ harness }) =>
        this.harnessService.makeHarnessActive(harness.id).pipe(
          map(() => HarnessActions.makeHarnessActiveSuccess({ id: harness.id })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.makeHarnessActiveFailure({ error: error.message }));
          })
        )
      )
    )
  );

  updateAgentPrompt$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.updateAgentPrompt),
      mergeMap(({ harnessId, role, prompt, providerId, modelName }) =>
        this.harnessService.updateAgentPrompt(harnessId, role, { prompt, providerId, modelName }).pipe(
          map(() => HarnessActions.updateAgentPromptSuccess({ harnessId, role, prompt, providerId, modelName })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.updateAgentPromptFailure({ error: error.message }));
          })
        )
      )
    )
  );

  // Provider config effects
  loadProviders$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.loadProviders),
      switchMap(() =>
        this.harnessService.getProviders().pipe(
          map((providers) => HarnessActions.loadProvidersSuccess({ providers })),
          catchError((error) => of(HarnessActions.loadProvidersFailure({ error: error.message })))
        )
      )
    )
  );

  createProvider$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.createProvider),
      mergeMap(({ provider }) =>
        this.harnessService.createProvider(provider).pipe(
          map((created) => {
            alert('Provider connection verified and added successfully!');
            return HarnessActions.createProviderSuccess({ provider: created });
          }),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.createProviderFailure({ error: error.message }));
          })
        )
      )
    )
  );

  deleteProvider$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.deleteProvider),
      mergeMap(({ id }) =>
        this.harnessService.deleteProvider(id).pipe(
          map(() => HarnessActions.deleteProviderSuccess({ id })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.deleteProviderFailure({ error: error.message }));
          })
        )
      )
    )
  );

  // Scalable Models Effects
  loadScalableModels$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.loadScalableModels),
      switchMap(() =>
        this.harnessService.getScalableModels().pipe(
          map((models) => HarnessActions.loadScalableModelsSuccess({ models })),
          catchError((error) => of(HarnessActions.loadScalableModelsFailure({ error: error.message })))
        )
      )
    )
  );

  createScalableModel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.createScalableModel),
      mergeMap(({ model }) =>
        this.harnessService.createScalableModel(model).pipe(
          map((created) => HarnessActions.createScalableModelSuccess({ model: created })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.createScalableModelFailure({ error: error.message }));
          })
        )
      )
    )
  );

  deleteScalableModel$ = createEffect(() =>
    this.actions$.pipe(
      ofType(HarnessActions.deleteScalableModel),
      mergeMap(({ id }) =>
        this.harnessService.deleteScalableModel(id).pipe(
          map(() => HarnessActions.deleteScalableModelSuccess({ id })),
          catchError((error) => {
            alert(error.message);
            return of(HarnessActions.deleteScalableModelFailure({ error: error.message }));
          })
        )
      )
    )
  );
}
