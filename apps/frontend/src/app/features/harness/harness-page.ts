import { Component, inject, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import { AsyncPipe } from '@angular/common';
import { Subscription } from 'rxjs';
import * as HarnessActions from './ui/store/harness.actions';
import { selectAllHarnesses, selectSelectedHarness, selectAllProviders, selectAllScalableModels, selectHarnessLoading, selectHarnessDetailLoading, selectSelectedAgentDetail, selectHarnessAgentLoading } from './ui/store/harness.selectors';
import { Harness, AgentConfig } from './domain/harness.model';
import { ProviderConfig } from './domain/provider.model';
import { ScalableModelConfig } from './domain/scalable-model.model';
import { HarnessService } from './data/harness.service';
import { HarnessListComponent } from './ui/harness-list/harness-list.component';
import { GraphFlowComponent } from './ui/graph-flow/graph-flow.component';
import { AgentEditorComponent } from './ui/agent-editor/agent-editor.component';

@Component({
  selector: 'app-harness-page',
  standalone: true,
  imports: [AsyncPipe, HarnessListComponent, GraphFlowComponent, AgentEditorComponent],
  templateUrl: './harness-page.html',
  styleUrl: './harness-page.css',
})
export class HarnessPageComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private harnessService = inject(HarnessService);
  private sub!: Subscription;

  harnesses$ = this.store.select(selectAllHarnesses);
  selectedHarness$ = this.store.select(selectSelectedHarness);
  providers$ = this.store.select(selectAllProviders);
  scalableModels$ = this.store.select(selectAllScalableModels);
  loading$ = this.store.select(selectHarnessLoading);
  detailLoading$ = this.store.select(selectHarnessDetailLoading);
  agentLoading$ = this.store.select(selectHarnessAgentLoading);

  selectedAgentRole = signal<string | null>(null);
  selectedHarness = signal<Harness | null>(null);

  selectedAgent$ = this.store.select(selectSelectedAgentDetail);

  syncDirty = signal(false);
  isSyncing = signal(false);

  consoleLogs = signal<string[]>([]);
  agentStates = signal<Record<string, string>>({
    orchestrator: 'idle', preparer: 'idle', planner: 'idle',
    supervisor: 'idle', executor: 'idle', qa: 'idle',
  });
  showLogsConsole = signal(false);

  private eventSource: EventSource | null = null;

  ngOnInit() {
    this.store.dispatch(HarnessActions.loadHarnesses());
    this.store.dispatch(HarnessActions.loadProviders());
    this.store.dispatch(HarnessActions.loadScalableModels());
    this.connectEventSource();

    this.sub = this.selectedHarness$.subscribe((harness) => {
      this.selectedHarness.set(harness);
    });
  }

  ngOnDestroy() {
    this.eventSource?.close();
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  private connectEventSource() {
    try {
      this.eventSource = new EventSource('/v1/events');
      this.eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const formattedLog = `[${data.timestamp.split('T')[1].slice(0, 8)}] [${data.role.toUpperCase()}] ${data.message}`;
        this.consoleLogs.update((logs) => [...logs, formattedLog].slice(-150));

        const roleKey = data.role.toLowerCase();
        if (roleKey in this.agentStates()) {
          this.agentStates.update((states) => ({ ...states, [roleKey]: data.state }));
        }
      };
      this.eventSource.onerror = () => {
        this.eventSource?.close();
        setTimeout(() => this.connectEventSource(), 3000);
      };
    } catch {
      setTimeout(() => this.connectEventSource(), 5000);
    }
  }

  onSelectHarness(harness: Harness) {
    this.store.dispatch(HarnessActions.loadHarnessDetail({ id: harness.id }));
    this.selectedAgentRole.set(null);
  }

  onCreateHarness(payload: {code: string, name: string, cloneFromHarnessId?: string}) {
    const tempId = 'temp_' + Date.now();
    this.store.dispatch(HarnessActions.createHarnessOptimistic({ code: payload.code, name: payload.name, cloneFromHarnessId: payload.cloneFromHarnessId, tempId }));
    this.markSyncDirty();
  }

  onDeleteHarness(harness: Harness) {
    if (!confirm(`Are you sure you want to delete harness "${harness.name}"?`)) return;
    this.store.dispatch(HarnessActions.deleteHarnessOptimistic({ harness }));
    this.markSyncDirty();
  }

  onActivateHarness(harness: Harness) {
    this.store.dispatch(HarnessActions.makeHarnessActive({ harness }));
    this.markSyncDirty();
  }

  onSelectAgent(agent: AgentConfig) {
    this.selectedAgentRole.set(agent.role);
    if (this.selectedHarness()) {
      this.store.dispatch(HarnessActions.loadAgentDetail({ 
        harnessId: this.selectedHarness()!.id, 
        role: agent.role 
      }));
    }
    this.scrollToRight();
  }

  onCloseEditor() {
    this.selectedAgentRole.set(null);
    this.store.dispatch(HarnessActions.clearSelectedAgent());
  }

  onSaveAgent(payload: { harnessId: string; role: string; prompt: string; providerId: string; modelName: string }) {
    this.store.dispatch(HarnessActions.updateAgentPrompt(payload));
  }

  onAddProvider(provider: ProviderConfig) {
    this.store.dispatch(HarnessActions.createProvider({ provider }));
  }

  onCreateScalableModel(model: ScalableModelConfig) {
    this.store.dispatch(HarnessActions.createScalableModel({ model }));
  }

  onSyncToOpenCode() {
    this.isSyncing.set(true);
    this.harnessService.syncToOpenCode().subscribe({
      next: (result) => {
        this.isSyncing.set(false);
        if (result.ok) {
          this.syncDirty.set(false);
        }
      },
      error: () => {
        this.isSyncing.set(false);
      },
    });
  }

  markSyncDirty() {
    this.syncDirty.set(true);
  }

  onClearLogs() {
    this.consoleLogs.set([]);
  }

  onToggleConsole() {
    this.showLogsConsole.set(!this.showLogsConsole());
  }

  private scrollToRight() {
    setTimeout(() => {
      const viewport = document.querySelector('.mochi-viewport');
      if (viewport) {
        viewport.scrollTo({ left: viewport.scrollWidth, behavior: 'smooth' });
      }
    }, 100);
  }
}
