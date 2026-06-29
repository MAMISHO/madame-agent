import { EntityMapper } from '../../../core/mappings/entity-mapper.interface';
import { IModel } from '../../domain/models/model.interface';
import { ModelDto } from '../dtos/model.dto';

export class ModelMapper implements EntityMapper<IModel, ModelDto> {
  initMapper(): void {}

  toDTO(entity: IModel): ModelDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      description: entity.description,
      providerId: entity.providerId,
    };
  }

  toEntity(dto: ModelDto): IModel {
    return {
      id: dto.id,
      code: dto.code,
      name: dto.name,
      description: dto.description,
      providerId: dto.providerId,
    };
  }

  toDTOList(entityList: IModel[]): ModelDto[] {
    return entityList.map((e) => this.toDTO(e));
  }

  toEntityList(dtoList: ModelDto[]): IModel[] {
    return dtoList.map((d) => this.toEntity(d));
  }
}
