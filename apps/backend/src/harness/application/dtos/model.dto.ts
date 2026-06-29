import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ModelDto {
  @IsUUID()
  id!: string;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  providerId!: string;
}

export class CreateModelDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  providerId!: string;
}
