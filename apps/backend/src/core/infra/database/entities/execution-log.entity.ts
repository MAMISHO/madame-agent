import { Column, DataType, Model, Table, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { HarnessEntity } from './harness.entity';

@Table({ tableName: 'execution_logs', timestamps: true })
export class ExecutionLogEntity extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  sessionId!: string;

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
  modelName!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  executionDate!: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  executionTime!: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  log!: string;

  @BelongsTo(() => HarnessEntity)
  harness?: HarnessEntity;
}
