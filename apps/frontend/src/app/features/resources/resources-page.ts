import { Component, inject, OnInit, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { AsyncPipe } from '@angular/common';
import { selectAllProviders, selectAllScalableModels, selectHarnessLoading } from '../harness/ui/store/harness.selectors';
import * as HarnessActions from '../harness/ui/store/harness.actions';

@Component({
  selector: 'app-resources-page',
  standalone: true,
  imports: [AsyncPipe],
  templateUrl: './resources-page.html',
  styles: [`
    .resources-container { display: flex; gap: 24px; padding: 24px; flex-wrap: wrap; align-items: flex-start; }
    .resource-card { background: #1a1a1e; border: 1px solid #27272a; border-radius: 16px; padding: 20px; width: 100%; max-width: 450px; }
  `]
})
export class ResourcesPageComponent implements OnInit {
  private store = inject(Store);

  providers$ = this.store.select(selectAllProviders);
  scalableModels$ = this.store.select(selectAllScalableModels);
  loading$ = this.store.select(selectHarnessLoading);

  // Forms state
  showProvForm = signal(false);
  newProvCode = signal('');
  newProvName = signal('');
  newProvBaseUrl = signal('');
  newProvApiKey = signal('');

  showDuoForm = signal(false);
  newDuoCode = signal('');
  newDuoName = signal('');
  newDuoLocalProv = signal('');
  newDuoLocalModel = signal('');
  newDuoCloudProv = signal('');
  newDuoCloudModel = signal('');

  ngOnInit() {
    this.store.dispatch(HarnessActions.loadProviders());
    this.store.dispatch(HarnessActions.loadScalableModels());
  }

  onSaveProvider() {
    const code = this.newProvCode().trim();
    const name = this.newProvName().trim();
    if (!code || !name) { alert('Code and Name are required'); return; }
    this.store.dispatch(HarnessActions.createProvider({
      provider: {
        id: '', code, name,
        baseUrl: this.newProvBaseUrl().trim() || undefined,
        apiKey: this.newProvApiKey().trim() || undefined
      }
    }));
    this.showProvForm.set(false);
    this.newProvCode.set(''); this.newProvName.set(''); this.newProvBaseUrl.set(''); this.newProvApiKey.set('');
  }

  onSaveDuo() {
    const code = this.newDuoCode().trim();
    const name = this.newDuoName().trim();
    if (!code || !name) { alert('Code and Name are required'); return; }
    this.store.dispatch(HarnessActions.createScalableModel({
      model: {
        id: '', code, name,
        localProviderId: this.newDuoLocalProv().trim(),
        localModelName: this.newDuoLocalModel().trim(),
        cloudProviderId: this.newDuoCloudProv().trim(),
        cloudModelName: this.newDuoCloudModel().trim()
      }
    }));
    this.showDuoForm.set(false);
    this.newDuoCode.set(''); this.newDuoName.set('');
    this.newDuoLocalProv.set(''); this.newDuoLocalModel.set('');
    this.newDuoCloudProv.set(''); this.newDuoCloudModel.set('');
  }

  onDeleteProvider(id: string) {
    if (confirm('Are you sure you want to delete this provider?')) {
      this.store.dispatch(HarnessActions.deleteProvider({ id }));
    }
  }

  onDeleteScalableModel(id: string) {
    if (confirm('Are you sure you want to delete this Dúo?')) {
      this.store.dispatch(HarnessActions.deleteScalableModel({ id }));
    }
  }
}
