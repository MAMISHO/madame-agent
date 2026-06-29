import { Column, DataType, Model, Table, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { HarnessEntity } from './harness.entity';

@Table({ tableName: 'agent_configs', timestamps: true })
export class AgentConfigEntity extends Model {
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

  @ForeignKey(() => HarnessEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare harnessId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare role: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare prompt: string;

  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare providerId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare modelName: string;

  @BelongsTo(() => HarnessEntity)
  declare harness?: HarnessEntity;
}
