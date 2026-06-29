import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SessionStats, SummaryStats } from '../domain/stats.model';

@Injectable({
  providedIn: 'root',
})
export class StatsService {
  private http = inject(HttpClient);

  getSummaryStats(): Observable<SummaryStats> {
    return this.http.get<SummaryStats>('/v1/costs');
  }

  getDetailedStats(): Observable<SessionStats[]> {
    return this.http.get<SessionStats[]>('/v1/costs/detailed');
  }
}
