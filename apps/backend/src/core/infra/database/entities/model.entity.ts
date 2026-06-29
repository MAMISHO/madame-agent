import { Column, DataType, Model, Table, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { ProviderEntity } from './provider.entity';
import { AgentEntity } from './agent.entity';

@Table({ tableName: 'models', timestamps: true })
export class ModelEntity extends Model {
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

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare description: string;

  @ForeignKey(() => ProviderEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare providerId: string;

  @BelongsTo(() => ProviderEntity)
  declare provider?: ProviderEntity;

  @HasMany(() => AgentEntity)
  declare agents?: AgentEntity[];
}
