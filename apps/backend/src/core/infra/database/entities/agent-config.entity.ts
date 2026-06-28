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

  @ForeignKey(() => HarnessEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  harnessId!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  role!: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  prompt!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  providerId!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  modelName!: string;

  @BelongsTo(() => HarnessEntity)
  harness?: HarnessEntity;
}
