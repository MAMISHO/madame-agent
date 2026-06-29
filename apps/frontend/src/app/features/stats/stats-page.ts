import { Component, inject, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { AsyncPipe } from '@angular/common';
import * as StatsActions from './ui/store/stats.actions';
import { selectSummaryStats, selectDetailedSessions, selectStatsLoading, selectStatsError } from './ui/store/stats.selectors';
import { StatsDashboardComponent } from './ui/stats-dashboard/stats-dashboard.component';

@Component({
  selector: 'app-stats-page',
  standalone: true,
  imports: [AsyncPipe, StatsDashboardComponent],
  template: `
    <main class="mochi-panel mochi-deck-workspace">
      <app-stats-dashboard
        [summary]="(summary$ | async)!"
        [sessions]="(sessions$ | async)!"
        [loading]="(loading$ | async)!"
        [error]="(error$ | async)"
        (retry)="onRetry()"
        (toggleSession)="onToggleSession($event)"
      />
    </main>
  `,
})
export class StatsPageComponent implements OnInit {
  private store = inject(Store);

  summary$ = this.store.select(selectSummaryStats);
  sessions$ = this.store.select(selectDetailedSessions);
  loading$ = this.store.select(selectStatsLoading);
  error$ = this.store.select(selectStatsError);

  ngOnInit() {
    this.store.dispatch(StatsActions.loadSummaryStats());
    this.store.dispatch(StatsActions.loadDetailedStats());
  }

  onRetry() {
    this.store.dispatch(StatsActions.loadSummaryStats());
    this.store.dispatch(StatsActions.loadDetailedStats());
  }

  onToggleSession(sessionId: string) {
    this.store.dispatch(StatsActions.toggleSessionExpand({ sessionId }));
  }
}
