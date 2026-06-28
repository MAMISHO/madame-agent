import { Component, signal, OnInit } from '@angular/core';

interface CostStats {
  totalCloudUsd: number;
  totalSavedUsd: number;
  cloudInputTokens: number;
  cloudOutputTokens: number;
  localInputTokens: number;
  localOutputTokens: number;
}

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly title = signal('Madame-Agent Dashboard');
  protected readonly stats = signal<CostStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    this.loadStats();
  }

  async loadStats() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const res = await fetch('/v1/costs');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      this.stats.set(data);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to fetch cost statistics.');
    } finally {
      this.loading.set(false);
    }
  }
}
