import { EntityMapper } from '../../../core/mappings/entity-mapper.interface';
import { IProvider } from '../../domain/models/provider.interface';
import { ProviderDto } from '../dtos/provider.dto';

export class ProviderMapper implements EntityMapper<IProvider, ProviderDto> {
  initMapper(): void {}

  toDTO(entity: IProvider): ProviderDto {
    return {
      id: entity.id,
      code: entity.code,
      name: entity.name,
      apiKey: entity.apiKey,
      baseUrl: entity.baseUrl,
    };
  }

  toEntity(dto: ProviderDto): IProvider {
    return {
      id: dto.id,
      code: dto.code,
      name: dto.name,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
    };
  }

  toDTOList(entityList: IProvider[]): ProviderDto[] {
    return entityList.map((e) => this.toDTO(e));
  }

  toEntityList(dtoList: ProviderDto[]): IProvider[] {
    return dtoList.map((d) => this.toEntity(d));
  }
}
