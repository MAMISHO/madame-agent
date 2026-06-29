import { Component, Input, Output, EventEmitter } from '@angular/core';
import { SummaryStats, SessionStats } from '../../domain/stats.model';

@Component({
  selector: 'app-stats-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './stats-dashboard.component.html',
  styleUrl: './stats-dashboard.component.css',
})
export class StatsDashboardComponent {
  @Input() summary: SummaryStats | null = null;
  @Input() sessions: SessionStats[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;

  @Output() retry = new EventEmitter<void>();
  @Output() toggleSession = new EventEmitter<string>();
}
