import { Component, Input, Output, EventEmitter, signal, computed, effect, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { Harness, AgentConfig } from '../../domain/harness.model';
import { ProviderConfig } from '../../domain/provider.model';
import { ScalableModelConfig } from '../../domain/scalable-model.model';

@Component({
  selector: 'app-agent-editor',
  standalone: true,
  imports: [UpperCasePipe],
  templateUrl: './agent-editor.component.html',
  styleUrl: './agent-editor.component.css',
})
export class AgentEditorComponent implements AfterViewInit {
  @ViewChild('providerSelect') providerSelect!: ElementRef<HTMLSelectElement>;
  @ViewChild('modelSelect') modelSelect?: ElementRef<HTMLSelectElement>;

  private _agent!: AgentConfig;

  @Input()
  set agent(value: AgentConfig) {
    if (value) {
      this._agent = value;
      this.editPrompt.set(value.prompt || '');
      this.editProvider.set(value.providerId || '');
      this.editModel.set(value.modelName || '');
    }
  }
  get agent(): AgentConfig {
    return this._agent;
  }

  @Input() harness: Harness | null = null;
  @Input() allHarnesses: Harness[] = [];
  @Input() providers: ProviderConfig[] = [];
  @Input() scalableModels: ScalableModelConfig[] = [];
  @Input() isLoading = false;
  @Input() role = '';

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<{
    harnessId: string;
    role: string;
    prompt: string;
    providerId: string;
    modelName: string;
  }>();
  @Output() addProvider = new EventEmitter<ProviderConfig>();
  @Output() addScalableModel = new EventEmitter<ScalableModelConfig>();

  editPrompt = signal('');
  editProvider = signal('');
  editModel = signal('');

  // Track providers as a signal for reactivity
  providersSignal = signal<ProviderConfig[]>([]);
  
  constructor() {
    // Sync providers input to signal
    effect(() => {
      this.providersSignal.set(this.providers);
    }, { allowSignalWrites: true });
  }

  ngAfterViewInit(): void {
    this.syncSelectValue();
  }

  private syncSelectValue(): void {
    setTimeout(() => {
      const sel = this.providerSelect?.nativeElement;
      if (sel) {
        sel.value = this.editProvider();
      }
      if (this.modelSelect?.nativeElement) {
        this.modelSelect.nativeElement.value = this.editModel();
      }
    }, 0);
  }

  // Add provider form state
  showAddProviderForm = signal(false);
  newProvCode = signal('');
  newProvName = signal('');
  newProvBaseUrl = signal('');
  newProvApiKey = signal('');

  // Add Dúo (Scalable Model) form state
  showAddDuoForm = signal(false);
  newDuoCode = signal('');
  newDuoName = signal('');
  newDuoLocalProv = signal('');
  newDuoLocalModel = signal('');
  newDuoCloudProv = signal('');
  newDuoCloudModel = signal('');

  // Computed Usages
  usedByAgents = computed(() => {
    const usages: { harnessName: string; agentRole: string }[] = [];
    const targetProv = this.editProvider();
    const targetModel = this.editModel();
    if (!targetProv && !targetModel) return usages;

    for (const h of this.allHarnesses) {
      if (h.agents) {
        for (const a of h.agents) {
          if ((targetProv && a.providerId === targetProv) || (targetModel && a.modelName === targetModel)) {
            usages.push({ harnessName: h.name, agentRole: a.role });
          }
        }
      }
    }
    return usages;
  });

  // Default hardcoded ones for initial select option fallback
  readonly defaultProviderIds = ['ollama', 'gemini', 'openai', 'anthropic', 'nvidia', 'cloud', 'madame-duo'];

  // Computed list of all available providers including current selection
  allProviderOptions = computed(() => {
    const currentProviderId = this.editProvider();
    const providersList = this.providersSignal();
    const currentProvider = providersList.find(p => p.id === currentProviderId);
    
    const options: { id: string; name: string }[] = [];
    
    // Add default providers
    for (const id of this.defaultProviderIds) {
      options.push({ id, name: id.toUpperCase() });
    }
    
    // Add custom providers from the loaded list
    for (const p of providersList) {
      if (!this.defaultProviderIds.includes(p.id)) {
        options.push({ id: p.id, name: `${p.name} (${p.id})` });
      }
    }
    
    // CRITICAL: Always include the current provider if it exists and isn't in the list
    // This handles the case where providers haven't loaded yet or the provider is custom
    if (currentProviderId && !options.some(o => o.id === currentProviderId)) {
      const displayName = currentProvider 
        ? `${currentProvider.name} (${currentProviderId})`
        : `${currentProviderId} (custom)`;
      options.push({ id: currentProviderId, name: displayName });
    }
    
    return options;
  });

  onPromptChange(event: Event) {
    this.editPrompt.set((event.target as HTMLTextAreaElement).value);
  }

  onProviderChange(event: Event) {
    this.editProvider.set((event.target as HTMLSelectElement).value);
    // Auto-clear or reset model when switching to/from duo
    if (this.editProvider() === 'madame-duo') {
      this.editModel.set('');
    }
  }

  onModelChange(event: Event) {
    this.editModel.set((event.target as HTMLInputElement | HTMLSelectElement).value);
  }

  onSave() {
    if (!this.harness) return;
    if (this.harness.isActive) {
      const confirmSave = confirm(
        '⚠️ Este arnés está ACTIVO. Guardar modificaciones detendrá cualquier sesión o tarea en ejecución bajo este modelo en OpenCode.\n\n¿Deseas guardar los cambios y detener las ejecuciones activas?'
      );
      if (!confirmSave) return;
    }
    this.save.emit({
      harnessId: this.harness.id,
      role: this.agent.role,
      prompt: this.editPrompt(),
      providerId: this.editProvider(),
      modelName: this.editModel(),
    });
  }
}
