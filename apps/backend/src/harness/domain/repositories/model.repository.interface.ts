import { IModel } from '../models/model.interface';

export interface IModelRepository {
  findAll(): Promise<IModel[]>;
  findById(id: string): Promise<IModel | null>;
  findByCode(code: string): Promise<IModel | null>;
  create(model: Partial<IModel>): Promise<IModel>;
  update(id: string, model: Partial<IModel>): Promise<IModel>;
  delete(id: string): Promise<boolean>;
}
