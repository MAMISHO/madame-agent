import { Controller, Get, Post, Put, Delete, Body, Param, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { ScalableModelEntity } from '../core/infra/database/entities/scalable-model.entity';
import { AgentConfigEntity } from '../core/infra/database/entities/agent-config.entity';
import { RepositoryValidator } from '../core/application/services/repository-validator.service';

@Controller('v1/duos')
export class ScalableModelController {
  constructor(private readonly validator: RepositoryValidator) {}

  @Get()
  async listAll() {
    const models = await ScalableModelEntity.findAll();
    return models;
  }

  @Post()
  async create(
    @Body()
    body: {
      code: string;
      name: string;
      localProviderId: string;
      localModelName: string;
      cloudProviderId: string;
      cloudModelName: string;
    },
  ) {
    const { code, name, localProviderId, localModelName, cloudProviderId, cloudModelName } = body;

    if (!code) throw new BadRequestException('Code is required.');
    this.validator.validateCode(code);

    if (!name) throw new BadRequestException('Name is required.');
    if (!localProviderId || !localModelName) throw new BadRequestException('Local provider and model are required.');
    if (!cloudProviderId || !cloudModelName) throw new BadRequestException('Cloud provider and model are required.');

    const existing = await ScalableModelEntity.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException(`A scalable model with code "${code}" already exists.`);
    }

    const model = await ScalableModelEntity.create({
      code,
      name,
      localProviderId,
      localModelName,
      cloudProviderId,
      cloudModelName,
    });

    return model;
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const model = await ScalableModelEntity.findByPk(id);
    if (!model) {
      throw new NotFoundException(`Scalable model not found.`);
    }
    return model;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      localProviderId?: string;
      localModelName?: string;
      cloudProviderId?: string;
      cloudModelName?: string;
    },
  ) {
    const model = await ScalableModelEntity.findByPk(id);
    if (!model) {
      throw new NotFoundException(`Scalable model not found.`);
    }

    if (body.name !== undefined) model.name = body.name;
    if (body.localProviderId !== undefined) model.localProviderId = body.localProviderId;
    if (body.localModelName !== undefined) model.localModelName = body.localModelName;
    if (body.cloudProviderId !== undefined) model.cloudProviderId = body.cloudProviderId;
    if (body.cloudModelName !== undefined) model.cloudModelName = body.cloudModelName;
    
    await model.save();
    return model;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const model = await ScalableModelEntity.findByPk(id);
    if (!model) {
      throw new NotFoundException(`Scalable model not found.`);
    }

    // Check Relational Integrity: agents using this model
    // Note: virtual provider is 'madame-duo', and modelName stores the scalable model UUID
    const agentsUsingIt = await AgentConfigEntity.findAll({ 
      where: { 
        providerId: 'madame-duo',
        modelName: id
      } 
    });

    if (agentsUsingIt.length > 0) {
      const agentCodes = agentsUsingIt.map((a) => a.code).join(', ');
      throw new ConflictException(`Cannot delete scalable model because it is used by agents: ${agentCodes}`);
    }

    await model.destroy();
    return { deleted: true };
  }
}
