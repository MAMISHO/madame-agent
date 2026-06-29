export interface AgentConfig {
  id?: string;
  code?: string;
  harnessId?: string;
  role: string;
  prompt: string;
  providerId: string;
  modelName: string;
}

export interface Harness {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  agents?: AgentConfig[];
}
