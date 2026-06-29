import { Injectable } from '@angular/core';
import { from, Observable } from 'rxjs';
import { Harness } from '../domain/harness.model';
import { ProviderConfig } from '../domain/provider.model';
import { ScalableModelConfig } from '../domain/scalable-model.model';

@Injectable({
  providedIn: 'root',
})
export class HarnessService {
  getHarnesses(): Observable<Harness[]> {
    return from(
      fetch('/v1/harness').then((res) => {
        if (!res.ok) throw new Error('Failed to load harnesses.');
        return res.json();
      })
    );
  }

  createHarness(code: string, name: string, cloneFromHarnessId?: string): Observable<Harness> {
    return from(
      fetch('/v1/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, cloneFromHarnessId }),
      }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to create harness.');
        }
        return res.json();
      })
    );
  }

  deleteHarness(id: string): Observable<void> {
    return from(
      fetch(`/v1/harness/${id}`, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to delete harness.');
        }
        return;
      })
    );
  }

  makeHarnessActive(id: string): Observable<void> {
    return from(
      fetch(`/v1/harness/${id}/active`, { method: 'PUT' }).then((res) => {
        if (!res.ok) throw new Error('Failed to activate harness.');
        return;
      })
    );
  }

  updateAgentPrompt(harnessId: string, role: string, payload: { prompt: string; providerId: string; modelName: string }): Observable<void> {
    return from(
      fetch(`/v1/harness/${harnessId}/agents/${role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => {
        if (!res.ok) throw new Error('Failed to update agent prompt.');
        return;
      })
    );
  }

  // Provider CRUD endpoints
  getProviders(): Observable<ProviderConfig[]> {
    return from(
      fetch('/v1/providers').then((res) => {
        if (!res.ok) throw new Error('Failed to load providers.');
        return res.json();
      })
    );
  }

  createProvider(provider: ProviderConfig): Observable<ProviderConfig> {
    return from(
      fetch('/v1/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider),
      }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to create provider.');
        }
        return res.json();
      })
    );
  }

  deleteProvider(id: string): Observable<void> {
    return from(
      fetch(`/v1/providers/${id}`, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to delete provider.');
        }
        return;
      })
    );
  }

  // Scalable Models CRUD
  getScalableModels(): Observable<ScalableModelConfig[]> {
    return from(
      fetch('/v1/duos').then((res) => {
        if (!res.ok) throw new Error('Failed to load scalable models.');
        return res.json();
      })
    );
  }

  createScalableModel(model: ScalableModelConfig): Observable<ScalableModelConfig> {
    return from(
      fetch('/v1/duos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model),
      }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to create scalable model.');
        }
        return res.json();
      })
    );
  }

  deleteScalableModel(id: string): Observable<void> {
    return from(
      fetch(`/v1/duos/${id}`, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to delete scalable model.');
        }
        return;
      })
    );
  }
}
