import { IHarness } from '../models/harness.interface';

export interface IHarnessRepository {
  findAll(): Promise<IHarness[]>;
  findById(id: string): Promise<IHarness | null>;
  findByCode(code: string): Promise<IHarness | null>;
  create(harness: Partial<IHarness>): Promise<IHarness>;
  update(id: string, harness: Partial<IHarness>): Promise<IHarness>;
  delete(id: string): Promise<boolean>;
  findDefault(): Promise<IHarness | null>;
  deactivateAll(): Promise<void>;
}
