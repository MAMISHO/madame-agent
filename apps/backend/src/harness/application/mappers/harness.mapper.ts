import { EntityMapper } from '../../../core/mappings/entity-mapper.interface';
import { IHarness } from '../../domain/models/harness.interface';
import { HarnessDto } from '../dtos/harness.dto';
import { AgentMapper } from './agent.mapper';

export class HarnessMapper implements EntityMapper<IHarness, HarnessDto> {
  private agentMapper = new AgentMapper();
  
  initMapper(): void {}

  toDTO(entity: IHarness): HarnessDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      isDefault: entity.isDefault,
      isActive: entity.isActive,
      agents: entity.agents ? this.agentMapper.toDTOList(entity.agents) : undefined,
    };
  }

  toEntity(dto: HarnessDto): IHarness {
    return {
      id: dto.id,
      code: dto.code,
      name: dto.name,
      description: dto.description,
      isDefault: dto.isDefault,
      isActive: dto.isActive,
    };
  }

  toDTOList(entityList: IHarness[]): HarnessDto[] {
    return entityList.map((e) => this.toDTO(e));
  }

  toEntityList(dtoList: HarnessDto[]): IHarness[] {
    return dtoList.map((d) => this.toEntity(d));
  }
}
