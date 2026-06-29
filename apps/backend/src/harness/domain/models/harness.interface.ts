import { IAgent } from './agent.interface';
import { IEdge } from './edge.interface';

export interface IHarness {
  id: string;
  code: string;
  name: string;
  description?: string;
  isDefault: boolean;
  isActive: boolean;
  agents?: IAgent[];
  edges?: IEdge[];
}
