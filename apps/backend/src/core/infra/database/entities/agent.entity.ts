import { Column, DataType, Model, Table, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { HarnessEntity } from './harness.entity';
import { ModelEntity } from './model.entity';

@Table({ tableName: 'agents', timestamps: true })
export class AgentEntity extends Model {
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

  @ForeignKey(() => ModelEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare modelId: string;

  @BelongsTo(() => HarnessEntity)
  declare harness?: HarnessEntity;

  @BelongsTo(() => ModelEntity)
  declare model?: ModelEntity;
}
