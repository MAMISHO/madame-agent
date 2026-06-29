import { IsString, IsOptional, IsUUID } from 'class-validator';

export class AgentDto {
  @IsUUID()
  id!: string;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  role!: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsUUID()
  harnessId!: string;

  @IsUUID()
  @IsOptional()
  modelId?: string;

  @IsString()
  @IsOptional()
  providerId?: string;

  @IsString()
  @IsOptional()
  modelName?: string;
}

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsUUID()
  @IsOptional()
  modelId?: string;
}
