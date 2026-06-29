import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { SessionStats, SummaryStats } from '../domain/stats.model';

@Injectable({
  providedIn: 'root',
})
export class StatsService {
  getSummaryStats(): Observable<SummaryStats> {
    return from(
      fetch('/v1/costs').then((res) => {
        if (!res.ok) throw new Error('Failed to load summary stats.');
        return res.json();
      })
    );
  }

  getDetailedStats(): Observable<SessionStats[]> {
    return from(
      fetch('/v1/costs/detailed').then((res) => {
        if (!res.ok) throw new Error('Failed to load detailed stats.');
        return res.json();
      })
    );
  }
}
