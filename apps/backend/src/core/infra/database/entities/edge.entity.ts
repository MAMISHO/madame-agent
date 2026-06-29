import { Column, DataType, Model, Table, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { HarnessEntity } from './harness.entity';
import { AgentEntity } from './agent.entity';

@Table({ tableName: 'edges', timestamps: true })
export class EdgeEntity extends Model {
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
  declare harnessId: string;

  @ForeignKey(() => AgentEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare sourceAgentId: string;

  @ForeignKey(() => AgentEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare targetAgentId: string;

  @Column({
    type: DataType.ENUM('unidirectional', 'bidirectional'),
    allowNull: false,
    defaultValue: 'unidirectional',
  })
  declare type: 'unidirectional' | 'bidirectional';

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare condition: string;

  @BelongsTo(() => HarnessEntity)
  declare harness?: HarnessEntity;

  @BelongsTo(() => AgentEntity, 'sourceAgentId')
  declare sourceAgent?: AgentEntity;

  @BelongsTo(() => AgentEntity, 'targetAgentId')
  declare targetAgent?: AgentEntity;
}
