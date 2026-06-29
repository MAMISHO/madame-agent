import { Injectable } from '@nestjs/common';
import { IHarnessRepository } from '../../../../domain/repositories/harness.repository.interface';
import { IHarness } from '../../../../domain/models/harness.interface';
import { HarnessEntity } from '../../../../../core/infra/database/entities/harness.entity';
import { AgentEntity } from '../../../../../core/infra/database/entities/agent.entity';
import { ModelEntity } from '../../../../../core/infra/database/entities/model.entity';
import { ProviderEntity } from '../../../../../core/infra/database/entities/provider.entity';

@Injectable()
export class HarnessRepositoryImpl implements IHarnessRepository {
  async findAll(): Promise<IHarness[]> {
    const harnesses = await HarnessEntity.findAll({
      include: [{
        model: AgentEntity,
        attributes: ['id', 'code', 'name', 'role', 'harnessId', 'modelId'],
        include: [{
          model: ModelEntity,
          attributes: ['id', 'code', 'providerId'],
          include: [{
            model: ProviderEntity,
            attributes: ['id', 'code']
          }]
        }]
      }]
    });
    return harnesses.map(h => h.get({ plain: true }) as IHarness);
  }

  async findById(id: string): Promise<IHarness | null> {
    const harness = await HarnessEntity.findByPk(id, {
      include: [{
        model: AgentEntity,
        attributes: ['id', 'code', 'name', 'role', 'harnessId', 'modelId'],
        include: [{
          model: ModelEntity,
          attributes: ['id', 'code', 'providerId'],
          include: [{
            model: ProviderEntity,
            attributes: ['id', 'code']
          }]
        }]
      }]
    });
    return harness ? (harness.get({ plain: true }) as IHarness) : null;
  }

  async findByCode(code: string): Promise<IHarness | null> {
    const harness = await HarnessEntity.findOne({
      where: { code },
      include: [{
        model: AgentEntity,
        attributes: ['id', 'code', 'name', 'role', 'harnessId', 'modelId'],
        include: [{
          model: ModelEntity,
          attributes: ['id', 'code', 'providerId'],
          include: [{
            model: ProviderEntity,
            attributes: ['id', 'code']
          }]
        }]
      }]
    });
    return harness ? (harness.get({ plain: true }) as IHarness) : null;
  }

  async create(data: Partial<IHarness>): Promise<IHarness> {
    const harness = await HarnessEntity.create(data as any);
    return harness.get({ plain: true }) as IHarness;
  }

  async update(id: string, data: Partial<IHarness>): Promise<IHarness> {
    await HarnessEntity.update(data as any, { where: { id } });
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await HarnessEntity.destroy({ where: { id } });
    return deleted > 0;
  }

  async findDefault(): Promise<IHarness | null> {
    const harness = await HarnessEntity.findOne({
      where: { isDefault: true },
      include: [{
        model: AgentEntity,
        attributes: ['id', 'code', 'name', 'role', 'harnessId', 'modelId'],
        include: [{
          model: ModelEntity,
          attributes: ['id', 'code', 'providerId'],
          include: [{
            model: ProviderEntity,
            attributes: ['id', 'code']
          }]
        }]
      }]
    });
    return harness ? (harness.get({ plain: true }) as IHarness) : null;
  }

  async deactivateAll(): Promise<void> {
    await HarnessEntity.update({ isActive: false }, { where: {} });
  }
}
