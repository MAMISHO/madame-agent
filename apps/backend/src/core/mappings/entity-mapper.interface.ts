export interface EntityMapper<Entity, DTO> {
  initMapper(): void;
  toDTO(entity: Entity): DTO;
  toEntity(dto: DTO): Entity;
  toDTOList(entityList: Entity[]): DTO[];
  toEntityList(dtoList: DTO[]): Entity[];
}
