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
  declare sessionId: string;

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
  declare modelName: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare executionDate: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare executionTime: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare log: string;

  @BelongsTo(() => HarnessEntity)
  declare harness?: HarnessEntity;
}
