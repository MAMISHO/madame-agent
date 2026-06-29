import { IProvider } from './provider.interface';
import { IAgent } from './agent.interface';

export interface IModel {
  id: string;
  code: string;
  name: string;
  description?: string;
  providerId: string;
  provider?: IProvider;
  agents?: IAgent[];
}
