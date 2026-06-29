import { Controller, Get, Post, Put, Delete, Body, Param, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { ProviderEntity } from '../core/infra/database/entities/provider.entity';
import { ModelEntity } from '../core/infra/database/entities/model.entity';
import { ScalableModelEntity } from '../core/infra/database/entities/scalable-model.entity';
import { RepositoryValidator } from '../core/application/services/repository-validator.service';

@Controller('v1/providers')
export class ProviderConfigController {

  constructor(private readonly validator: RepositoryValidator) {}

  private async validateConnectivity(code: string, baseUrl: string) {
    try {
      new URL(baseUrl);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      let checkUrl = baseUrl;
      if (code.toLowerCase().includes('ollama') || baseUrl.includes('11434')) {
        checkUrl = baseUrl.endsWith('/') ? `${baseUrl}api/tags` : `${baseUrl}/api/tags`;
      }
      
      const res = await fetch(checkUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        throw new Error(`Server responded with status ${res.status}`);
      }
    } catch (err: any) {
      throw new BadRequestException(`Failed to validate provider connectivity to ${baseUrl}: ${err.message}`);
    }
  }

  @Get()
  async listAll() {
    const providers = await ProviderEntity.findAll();
    return providers.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      apiKey: p.apiKey ? '****' + p.apiKey.slice(-4) : null,
      baseUrl: p.baseUrl,
    }));
  }

  @Post()
  async create(@Body() body: { code: string; name: string; apiKey?: string; baseUrl?: string }) {
    const { code, name, apiKey, baseUrl } = body;
    if (!code || !name) {
      throw new BadRequestException('Provider code and name are required.');
    }

    this.validator.validateCode(code);

    const existing = await ProviderEntity.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException(`Provider with code "${code}" already exists.`);
    }

    if (baseUrl) {
      await this.validateConnectivity(code, baseUrl);
    }

    const provider = await ProviderEntity.create({ code, name, apiKey, baseUrl });
    return {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      apiKey: provider.apiKey ? '****' + provider.apiKey.slice(-4) : null,
      baseUrl: provider.baseUrl,
    };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; apiKey?: string; baseUrl?: string }) {
    const provider = await ProviderEntity.findByPk(id);
    if (!provider) {
      throw new NotFoundException(`Provider "${id}" not found.`);
    }

    if (body.baseUrl) {
      await this.validateConnectivity(provider.code, body.baseUrl);
    }

    if (body.name !== undefined) provider.name = body.name;
    if (body.apiKey !== undefined) provider.apiKey = body.apiKey;
    if (body.baseUrl !== undefined) provider.baseUrl = body.baseUrl;
    await provider.save();

    return {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      apiKey: provider.apiKey ? '****' + provider.apiKey.slice(-4) : null,
      baseUrl: provider.baseUrl,
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const provider = await ProviderEntity.findByPk(id);
    if (!provider) {
      throw new NotFoundException(`Provider "${id}" not found.`);
    }

    // Check Relational Integrity
    const modelsUsingIt = await ModelEntity.findAll({ where: { providerId: id } });
    if (modelsUsingIt.length > 0) {
      const modelCodes = modelsUsingIt.map(m => m.code).join(', ');
      throw new ConflictException(`Cannot delete provider because it is used by models: ${modelCodes}`);
    }

    const localModelsUsingIt = await ScalableModelEntity.findAll({ where: { localProviderId: id } });
    const cloudModelsUsingIt = await ScalableModelEntity.findAll({ where: { cloudProviderId: id } });
    const scalableModelsUsingIt = [...localModelsUsingIt, ...cloudModelsUsingIt];
    
    if (scalableModelsUsingIt.length > 0) {
      const modelCodes = Array.from(new Set(scalableModelsUsingIt.map(m => m.code))).join(', ');
      throw new ConflictException(`Cannot delete provider because it is used by scalable models: ${modelCodes}`);
    }

    await provider.destroy();
    return { deleted: true };
  }
}
