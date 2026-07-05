import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Harness } from '../domain/harness.model';
import { ProviderConfig } from '../domain/provider.model';
import { ScalableModelConfig } from '../domain/scalable-model.model';

@Injectable({
  providedIn: 'root',
})
export class HarnessService {
  private http = inject(HttpClient);

  getHarnesses(): Observable<Harness[]> {
    return this.http.get<Harness[]>('/v1/harness');
  }

  getHarness(id: string): Observable<Harness> {
    return this.http.get<Harness>(`/v1/harness/${id}`);
  }

  getAgent(harnessId: string, role: string): Observable<import('../domain/harness.model').AgentConfig> {
    return this.http.get<import('../domain/harness.model').AgentConfig>(`/v1/harness/${harnessId}/agents/${role}`);
  }

  createHarness(code: string, name: string, cloneFromHarnessId?: string): Observable<Harness> {
    return this.http.post<Harness>('/v1/harness', { code, name, cloneFromHarnessId });
  }

  deleteHarness(id: string): Observable<void> {
    return this.http.delete<void>(`/v1/harness/${id}`);
  }

  makeHarnessActive(id: string): Observable<void> {
    return this.http.put<void>(`/v1/harness/${id}/active`, {});
  }

  updateAgentPrompt(harnessId: string, role: string, payload: { prompt: string; providerId: string; modelName: string }): Observable<void> {
    return this.http.put<void>(`/v1/harness/${harnessId}/agents/${role}`, payload);
  }

  // Provider CRUD endpoints
  getProviders(): Observable<ProviderConfig[]> {
    return this.http.get<ProviderConfig[]>('/v1/providers');
  }

  createProvider(provider: ProviderConfig): Observable<ProviderConfig> {
    return this.http.post<ProviderConfig>('/v1/providers', provider);
  }

  deleteProvider(id: string): Observable<void> {
    return this.http.delete<void>(`/v1/providers/${id}`);
  }

  // Scalable Models CRUD
  getScalableModels(): Observable<ScalableModelConfig[]> {
    return this.http.get<ScalableModelConfig[]>('/v1/duos');
  }

  createScalableModel(model: ScalableModelConfig): Observable<ScalableModelConfig> {
    return this.http.post<ScalableModelConfig>('/v1/duos', model);
  }

  deleteScalableModel(id: string): Observable<void> {
    return this.http.delete<void>(`/v1/duos/${id}`);
  }

  syncToOpenCode(): Observable<{ ok: boolean; count?: number; message?: string }> {
    return this.http.post<{ ok: boolean; count?: number; message?: string }>('/v1/harness/sync-to-opencode', {});
  }
}
