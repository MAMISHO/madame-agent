import { IAgent } from '../models/agent.interface';

export interface IAgentRepository {
  findAllByHarnessId(harnessId: string): Promise<IAgent[]>;
  findByHarnessIdAndRole(harnessId: string, role: string): Promise<IAgent | null>;
  create(agent: Partial<IAgent>): Promise<IAgent>;
  update(id: string, agent: Partial<IAgent>): Promise<IAgent>;
  deleteByHarnessId(harnessId: string): Promise<number>;
}
