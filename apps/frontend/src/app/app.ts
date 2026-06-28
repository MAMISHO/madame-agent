import { Component, signal, OnInit } from '@angular/core';

interface AgentConfig {
  id: string;
  harnessId: string;
  role: string;
  prompt: string;
  providerId: string;
  modelName: string;
}

interface Harness {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  agents?: AgentConfig[];
}

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
  protected readonly currentView = signal<'stats' | 'harness'>('stats');
  protected readonly stats = signal<CostStats | null>(null);
  protected readonly harnesses = signal<Harness[]>([]);
  protected readonly selectedHarness = signal<Harness | null>(null);
  protected readonly selectedAgent = signal<AgentConfig | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  // Form states
  protected readonly newHarnessName = signal('');
  protected readonly editPrompt = signal('');
  protected readonly editProvider = signal('');
  protected readonly editModel = signal('');

  // Static list of popular providers
  protected readonly providers = ['ollama', 'gemini', 'openai', 'anthropic'];

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    this.error.set(null);
    try {
      await Promise.all([this.loadStats(), this.loadHarnesses()]);
    } catch (err: any) {
      this.error.set(err.message || 'Failed to sync with backend.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadStats() {
    const res = await fetch('/v1/costs');
    if (!res.ok) throw new Error('Failed to load cost statistics.');
    const data = await res.json();
    this.stats.set(data);
  }

  async loadHarnesses() {
    const res = await fetch('/v1/harness');
    if (!res.ok) throw new Error('Failed to load harnesses.');
    const data = await res.json();
    this.harnesses.set(data);

    // Auto-select active harness for viewing
    const active = data.find((h: Harness) => h.isActive);
    if (active) {
      this.selectedHarness.set(active);
    } else if (data.length > 0) {
      this.selectedHarness.set(data[0]);
    }
  }

  async selectHarness(harness: Harness) {
    this.selectedHarness.set(harness);
    this.selectedAgent.set(null);
  }

  async makeHarnessActive(harness: Harness) {
    try {
      const res = await fetch(`/v1/harness/${harness.id}/active`, { method: 'PUT' });
      if (!res.ok) throw new Error('Failed to activate harness.');
      await this.loadHarnesses();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async createHarness(nameInput: HTMLInputElement) {
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/v1/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to create harness.');
      }
      const newHarness = await res.json();
      nameInput.value = '';
      await this.loadHarnesses();
      this.selectedHarness.set(newHarness);
    } catch (err: any) {
      alert(err.message);
    }
  }

  async deleteHarness(harness: Harness) {
    if (harness.isDefault) return;
    if (!confirm(`Are you sure you want to delete harness "${harness.name}"?`)) return;

    try {
      const res = await fetch(`/v1/harness/${harness.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete harness.');
      await this.loadHarnesses();
    } catch (err: any) {
      alert(err.message);
    }
  }

  selectAgent(agent: AgentConfig) {
    this.selectedAgent.set(agent);
    this.editPrompt.set(agent.prompt);
    this.editProvider.set(agent.providerId);
    this.editModel.set(agent.modelName);
  }

  async saveAgentConfig() {
    const agent = this.selectedAgent();
    const harness = this.selectedHarness();
    if (!agent || !harness) return;

    try {
      const res = await fetch(`/v1/harness/${harness.id}/agents/${agent.role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: this.editPrompt(),
          providerId: this.editProvider(),
          modelName: this.editModel(),
        }),
      });
      if (!res.ok) throw new Error('Failed to save agent configuration.');
      const updatedAgent = await res.json();

      // Update local state
      const updatedAgents = harness.agents?.map((a) => (a.role === agent.role ? updatedAgent : a)) || [];
      const updatedHarness = { ...harness, agents: updatedAgents };
      
      this.harnesses.update((list) => list.map((h) => (h.id === harness.id ? updatedHarness : h)));
      this.selectedHarness.set(updatedHarness);
      this.selectedAgent.set(updatedAgent);
      
      alert('Agent configurations saved successfully!');
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Bind forms inputs
  onPromptChange(event: Event) {
    this.editPrompt.set((event.target as HTMLTextAreaElement).value);
  }

  onProviderChange(event: Event) {
    this.editProvider.set((event.target as HTMLSelectElement).value);
  }

  onModelChange(event: Event) {
    this.editModel.set((event.target as HTMLInputElement).value);
  }

  getAgentByRole(role: string): AgentConfig | undefined {
    return this.selectedHarness()?.agents?.find((a) => a.role === role.toLowerCase());
  }
}
