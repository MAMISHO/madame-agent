import { Column, DataType, Model, Table, HasMany } from 'sequelize-typescript';
import { AgentEntity } from './agent.entity';
import { EdgeEntity } from './edge.entity';

@Table({ tableName: 'harnesses', timestamps: true })
export class HarnessEntity extends Model {
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
    unique: true,
  })
  declare name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare description: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isDefault: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isActive: boolean;

  @HasMany(() => AgentEntity)
  declare agents?: AgentEntity[];

  @HasMany(() => EdgeEntity)
  declare edges?: EdgeEntity[];
}
