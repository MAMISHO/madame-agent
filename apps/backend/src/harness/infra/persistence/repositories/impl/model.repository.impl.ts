import { Injectable } from '@nestjs/common';
import { IModelRepository } from '../../../../domain/repositories/model.repository.interface';
import { IModel } from '../../../../domain/models/model.interface';
import { ModelEntity } from '../../../../../core/infra/database/entities/model.entity';
import { ProviderEntity } from '../../../../../core/infra/database/entities/provider.entity';

@Injectable()
export class ModelRepositoryImpl implements IModelRepository {
  async findAll(): Promise<IModel[]> {
    const models = await ModelEntity.findAll({ include: [ProviderEntity] });
    return models.map(m => m.get({ plain: true }) as IModel);
  }

  async findById(id: string): Promise<IModel | null> {
    const model = await ModelEntity.findByPk(id, { include: [ProviderEntity] });
    return model ? (model.get({ plain: true }) as IModel) : null;
  }

  async findByCode(code: string): Promise<IModel | null> {
    const model = await ModelEntity.findOne({ where: { code }, include: [ProviderEntity] });
    return model ? (model.get({ plain: true }) as IModel) : null;
  }

  async create(data: Partial<IModel>): Promise<IModel> {
    const model = await ModelEntity.create(data as any);
    return model.get({ plain: true }) as IModel;
  }

  async update(id: string, data: Partial<IModel>): Promise<IModel> {
    await ModelEntity.update(data as any, { where: { id } });
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await ModelEntity.destroy({ where: { id } });
    return deleted > 0;
  }
}
