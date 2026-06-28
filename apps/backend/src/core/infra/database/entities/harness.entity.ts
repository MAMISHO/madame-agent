import { Column, DataType, Model, Table, HasMany } from 'sequelize-typescript';
import { AgentConfigEntity } from './agent-config.entity';

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
  name!: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  isDefault!: boolean;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  isActive!: boolean;

  @HasMany(() => AgentConfigEntity)
  agents?: AgentConfigEntity[];
}
