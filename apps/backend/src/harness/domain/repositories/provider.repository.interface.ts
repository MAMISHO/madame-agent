import { IProvider } from '../models/provider.interface';

export interface IProviderRepository {
  findAll(): Promise<IProvider[]>;
  findById(id: string): Promise<IProvider | null>;
  findByCode(code: string): Promise<IProvider | null>;
  create(provider: Partial<IProvider>): Promise<IProvider>;
  update(id: string, provider: Partial<IProvider>): Promise<IProvider>;
  delete(id: string): Promise<boolean>;
}
