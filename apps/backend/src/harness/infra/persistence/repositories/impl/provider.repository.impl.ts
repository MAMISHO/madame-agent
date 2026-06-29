import { Injectable } from '@nestjs/common';
import { IProviderRepository } from '../../../../domain/repositories/provider.repository.interface';
import { IProvider } from '../../../../domain/models/provider.interface';
import { ProviderEntity } from '../../../../../core/infra/database/entities/provider.entity';

@Injectable()
export class ProviderRepositoryImpl implements IProviderRepository {
  async findAll(): Promise<IProvider[]> {
    const providers = await ProviderEntity.findAll();
    return providers.map(p => p.get({ plain: true }) as IProvider);
  }

  async findById(id: string): Promise<IProvider | null> {
    const provider = await ProviderEntity.findByPk(id);
    return provider ? (provider.get({ plain: true }) as IProvider) : null;
  }

  async findByCode(code: string): Promise<IProvider | null> {
    const provider = await ProviderEntity.findOne({ where: { code } });
    return provider ? (provider.get({ plain: true }) as IProvider) : null;
  }

  async create(data: Partial<IProvider>): Promise<IProvider> {
    const provider = await ProviderEntity.create(data as any);
    return provider.get({ plain: true }) as IProvider;
  }

  async update(id: string, data: Partial<IProvider>): Promise<IProvider> {
    await ProviderEntity.update(data as any, { where: { id } });
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await ProviderEntity.destroy({ where: { id } });
    return deleted > 0;
  }
}
