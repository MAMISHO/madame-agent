import { EntityMapper } from '../../../core/mappings/entity-mapper.interface';
import { IAgent } from '../../domain/models/agent.interface';
import { AgentDto } from '../dtos/agent.dto';

export class AgentMapper implements EntityMapper<IAgent, AgentDto> {
  initMapper(): void {}

  toDTO(entity: IAgent): AgentDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      role: entity.role,
      prompt: entity.prompt,
      harnessId: entity.harnessId,
      modelId: entity.modelId,
      providerId: entity.model?.provider?.code || '',
      modelName: entity.model?.code || '',
    };
  }

  toEntity(dto: AgentDto): IAgent {
    return {
      id: dto.id,
      code: dto.code,
      name: dto.name,
      description: dto.description,
      role: dto.role,
      prompt: dto.prompt || '',
      harnessId: dto.harnessId,
      modelId: dto.modelId || '',
    };
  }

  toDTOList(entityList: IAgent[]): AgentDto[] {
    return entityList.map((e) => this.toDTO(e));
  }

  toEntityList(dtoList: AgentDto[]): IAgent[] {
    return dtoList.map((d) => this.toEntity(d));
  }
}
