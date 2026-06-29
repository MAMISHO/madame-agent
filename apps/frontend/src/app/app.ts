import { Component, signal } from '@angular/core';
import { StatsPageComponent } from './features/stats/stats-page';
import { HarnessPageComponent } from './features/harness/harness-page';
import { ResourcesPageComponent } from './features/resources/resources-page';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StatsPageComponent, HarnessPageComponent, ResourcesPageComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly currentView = signal<'stats' | 'harness' | 'resources'>('stats');
}
