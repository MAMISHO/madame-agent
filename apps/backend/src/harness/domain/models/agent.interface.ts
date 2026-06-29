import { IHarness } from './harness.interface';
import { IModel } from './model.interface';

export interface IAgent {
  id: string;
  code: string;
  name: string;
  description?: string;
  role: string;
  prompt: string;
  harnessId: string;
  modelId: string;
  harness?: IHarness;
  model?: IModel;
}
