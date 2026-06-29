import { IsString, IsOptional, IsBoolean, IsArray, IsUUID } from 'class-validator';
import { AgentDto } from './agent.dto';

export class HarnessDto {
  @IsUUID()
  id!: string;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  isDefault!: boolean;

  @IsBoolean()
  isActive!: boolean;

  @IsArray()
  @IsOptional()
  agents?: AgentDto[];
}

export class CreateHarnessDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  cloneFromHarnessId?: string;
}

export class UpdateHarnessDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
