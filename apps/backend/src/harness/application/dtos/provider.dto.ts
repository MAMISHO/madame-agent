import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ProviderDto {
  @IsUUID()
  id!: string;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;
}

export class CreateProviderDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;
}
