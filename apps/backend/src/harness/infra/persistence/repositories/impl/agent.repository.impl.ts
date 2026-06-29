import { Injectable } from '@nestjs/common';
import { IAgentRepository } from '../../../../domain/repositories/agent.repository.interface';
import { IAgent } from '../../../../domain/models/agent.interface';
import { AgentEntity } from '../../../../../core/infra/database/entities/agent.entity';
import { ModelEntity } from '../../../../../core/infra/database/entities/model.entity';
import { ProviderEntity } from '../../../../../core/infra/database/entities/provider.entity';

@Injectable()
export class AgentRepositoryImpl implements IAgentRepository {
  async findAllByHarnessId(harnessId: string): Promise<IAgent[]> {
    const agents = await AgentEntity.findAll({
      where: { harnessId },
      include: [
        { model: ModelEntity, include: [ProviderEntity] }
      ]
    });
    return agents.map(a => a.get({ plain: true }) as IAgent);
  }

  async findByHarnessIdAndRole(harnessId: string, role: string): Promise<IAgent | null> {
    const agent = await AgentEntity.findOne({
      where: { harnessId, role },
      include: [
        { model: ModelEntity, include: [ProviderEntity] }
      ]
    });
    return agent ? (agent.get({ plain: true }) as IAgent) : null;
  }

  async create(data: Partial<IAgent>): Promise<IAgent> {
    const agent = await AgentEntity.create(data as any);
    return agent.get({ plain: true }) as IAgent;
  }

  async update(id: string, data: Partial<IAgent>): Promise<IAgent> {
    await AgentEntity.update(data as any, { where: { id } });
    const updated = await AgentEntity.findByPk(id, { include: [ModelEntity] });
    return updated!.get({ plain: true }) as IAgent;
  }

  async deleteByHarnessId(harnessId: string): Promise<number> {
    return AgentEntity.destroy({ where: { harnessId } });
  }
}
