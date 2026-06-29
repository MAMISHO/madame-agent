export interface ModelStats {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCloudUsd: number;
}

export interface AgentStats {
  role: string;
  totalCloudUsd: number;
  totalSavedUsd: number;
  models: ModelStats[];
}

export interface HarnessStats {
  harnessId: string;
  harnessName: string;
  totalCloudUsd: number;
  totalSavedUsd: number;
  agents: AgentStats[];
}

export interface SessionStats {
  sessionId: string;
  totalCloudUsd: number;
  totalSavedUsd: number;
  harnesses: HarnessStats[];
  expanded?: boolean;
}

export interface SummaryStats {
  totalCloudUsd: number;
  totalSavedUsd: number;
  activeAgents: number;
  totalRequests: number;
}
