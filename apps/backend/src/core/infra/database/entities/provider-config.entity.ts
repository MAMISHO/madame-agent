import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'provider_configs', timestamps: true })
export class ProviderConfigEntity extends Model {
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
  declare apiKey: string | undefined;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare baseUrl: string | undefined;
}
