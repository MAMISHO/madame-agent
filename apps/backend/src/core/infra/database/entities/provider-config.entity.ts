import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'provider_configs', timestamps: true })
export class ProviderConfigEntity extends Model {
  @Column({
    type: DataType.STRING,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  name!: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  apiKey?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  baseUrl?: string;
}
