import { Column, DataType, Model, Table, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ProviderConfigEntity } from './provider-config.entity';

@Table({ tableName: 'scalable_models', timestamps: true })
export class ScalableModelEntity extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  declare code: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare name: string;

  @ForeignKey(() => ProviderConfigEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare localProviderId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare localModelName: string;

  @ForeignKey(() => ProviderConfigEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare cloudProviderId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare cloudModelName: string;

  @BelongsTo(() => ProviderConfigEntity, 'localProviderId')
  declare localProvider?: ProviderConfigEntity;

  @BelongsTo(() => ProviderConfigEntity, 'cloudProviderId')
  declare cloudProvider?: ProviderConfigEntity;
}
