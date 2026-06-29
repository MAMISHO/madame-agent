import { IHarness } from './harness.interface';
import { IAgent } from './agent.interface';

export type EdgeType = 'unidirectional' | 'bidirectional';

export interface IEdge {
  id: string;
  harnessId: string;
  sourceAgentId: string;
  targetAgentId: string;
  type: EdgeType;
  condition?: string;
  harness?: IHarness;
  sourceAgent?: IAgent;
  targetAgent?: IAgent;
}
