import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { StatsService } from '../../data/stats.service';
import * as StatsActions from './stats.actions';

@Injectable()
export class StatsEffects {
  private actions$ = inject(Actions);
  private statsService = inject(StatsService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StatsActions.loadSummaryStats),
      switchMap(() =>
        this.statsService.getSummaryStats().pipe(
          map((summary) => StatsActions.loadSummaryStatsSuccess({ summary })),
          catchError((error) => of(StatsActions.loadSummaryStatsFailure({ error: error.message })))
        )
      )
    )
  );

  loadDetailed$ = createEffect(() =>
    this.actions$.pipe(
      ofType(StatsActions.loadDetailedStats),
      switchMap(() =>
        this.statsService.getDetailedStats().pipe(
          map((sessions) => StatsActions.loadDetailedStatsSuccess({ sessions })),
          catchError((error) => of(StatsActions.loadDetailedStatsFailure({ error: error.message })))
        )
      )
    )
  );
}
