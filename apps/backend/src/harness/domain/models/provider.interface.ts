import { IModel } from './model.interface';

export interface IProvider {
  id: string;
  code: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  models?: IModel[];
}
