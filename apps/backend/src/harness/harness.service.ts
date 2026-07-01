import { Injectable, Logger, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HarnessStrategy } from './harness.strategy';
import { OpenCodeStrategy } from './strategies/opencode.strategy';
import { CliStrategy } from './strategies/cli.strategy';
import type { IHarnessRepository } from './domain/repositories/harness.repository.interface';
import type { IAgentRepository } from './domain/repositories/agent.repository.interface';
import type { IModelRepository } from './domain/repositories/model.repository.interface';
import type { IProviderRepository } from './domain/repositories/provider.repository.interface';
import { HarnessMapper } from './application/mappers/harness.mapper';
import { HarnessDto, CreateHarnessDto } from './application/dtos/harness.dto';
import { AgentDto } from './application/dtos/agent.dto';
import { AgentMapper } from './application/mappers/agent.mapper';
import { ProviderEntity } from '../core/infra/database/entities/provider.entity';
import { ModelEntity } from '../core/infra/database/entities/model.entity';
import { ObservabilityService } from '../observability/observability.service';
import { RepositoryValidator } from '../core/application/services/repository-validator.service';

@Injectable()
export class HarnessService {
  private readonly logger = new Logger(HarnessService.name);
  private readonly strategies = new Map<string, HarnessStrategy>();
  private defaultHarness: string;

  private harnessMapper = new HarnessMapper();

  constructor(
    private readonly configService: ConfigService,
    private readonly openCodeStrategy: OpenCodeStrategy,
    private readonly cliStrategy: CliStrategy,
    @Inject('IHarnessRepository') private readonly harnessRepo: IHarnessRepository,
    @Inject('IAgentRepository') private readonly agentRepo: IAgentRepository,
    @Inject('IModelRepository') private readonly modelRepo: IModelRepository,
    @Inject('IProviderRepository') private readonly providerRepo: IProviderRepository,
    private readonly observability: ObservabilityService,
    private readonly validator: RepositoryValidator,
  ) {
    this.strategies.set(openCodeStrategy.name, openCodeStrategy);
    this.strategies.set(cliStrategy.name, cliStrategy);
    this.defaultHarness = this.configService.get<string>('HARNESS_CLIENT') || process.env.HARNESS_CLIENT || 'opencode';
  }

  getStrategy(harnessName?: string): HarnessStrategy {
    const name = (harnessName || this.defaultHarness).toLowerCase();
    const strategy = this.strategies.get(name);
    return strategy || this.strategies.get(this.defaultHarness) || this.openCodeStrategy;
  }

  async listAll(): Promise<HarnessDto[]> {
    const harnesses = await this.harnessRepo.findAll();
    return this.harnessMapper.toDTOList(harnesses);
  }

  async create(dto: CreateHarnessDto): Promise<HarnessDto> {
    this.validator.validateCode(dto.code);
    const trimmedName = dto.name.trim();

    if (trimmedName.length < 8 || trimmedName.length > 50) {
      throw new BadRequestException('Harness name must be between 8 and 50 characters.');
    }
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
      throw new BadRequestException('Harness name cannot contain special characters.');
    }

    if (await this.harnessRepo.findByCode(dto.code)) {
      throw new BadRequestException('A harness with this code already exists.');
    }

    // Simplified creation logic without transactions for now to restore functionality
    const newHarness = await this.harnessRepo.create({
      code: dto.code,
      name: trimmedName,
      description: dto.description,
      isDefault: false,
      isActive: false,
    });

    const sourceHarness = dto.cloneFromHarnessId 
      ? await this.harnessRepo.findById(dto.cloneFromHarnessId) 
      : await this.harnessRepo.findDefault();

    if (sourceHarness) {
      const sourceAgents = await this.agentRepo.findAllByHarnessId(sourceHarness.id);
      for (const agent of sourceAgents) {
        await this.agentRepo.create({
          code: `${dto.code}-${agent.role}`,
          name: `${trimmedName} ${agent.role}`,
          harnessId: newHarness.id,
          role: agent.role,
          prompt: agent.prompt,
          modelId: agent.modelId,
        });
      }
    }

    const created = await this.harnessRepo.findById(newHarness.id);
    return this.harnessMapper.toDTO(created!);
  }

  async getOne(id: string): Promise<HarnessDto> {
    const harness = await this.harnessRepo.findById(id);
    if (!harness) throw new NotFoundException('Harness not found.');
    return this.harnessMapper.toDTO(harness);
  }

  async setActive(id: string) {
    const harness = await this.harnessRepo.findById(id);
    if (!harness) throw new NotFoundException('Harness not found.');
    
    const newState = !harness.isActive;
    await this.harnessRepo.update(id, { isActive: newState });
    
    return { 
      message: `Harness "${harness.name}" is now ${newState ? 'active' : 'inactive'}.`, 
      activeId: id,
      isActive: newState 
    };
  }

  async delete(id: string) {
    const harness = await this.harnessRepo.findById(id);
    if (!harness) throw new NotFoundException('Harness not found.');
    if (harness.isDefault) throw new BadRequestException('The default harness cannot be deleted.');

    await this.agentRepo.deleteByHarnessId(id);
    await this.harnessRepo.delete(id);

    if (harness.isActive) {
      const defaultHarness = await this.harnessRepo.findDefault();
      if (defaultHarness) {
        await this.harnessRepo.update(defaultHarness.id, { isActive: true });
      }
    }
    return { message: 'Harness deleted successfully.' };
  }

  async updateAgent(harnessId: string, role: string, prompt: string, providerId: string, modelName: string) {
    const harness = await this.harnessRepo.findById(harnessId);
    if (!harness) throw new NotFoundException('Harness not found.');
    if (harness.isDefault) throw new BadRequestException('Default harness cannot be modified.');

    // 1. Resolve Provider
    const provider = await ProviderEntity.findByPk(providerId) || 
                     await ProviderEntity.findOne({ where: { code: providerId } });
    if (!provider) throw new NotFoundException(`Provider "${providerId}" not found.`);

    // 2. Validate model connectivity
    await this.validateModelConnectivity(provider, modelName);

    // 3. Find or auto-create ModelEntity
    let dbModel = await ModelEntity.findOne({ where: { code: modelName, providerId: provider.id } });
    if (!dbModel) {
      dbModel = await ModelEntity.create({
        code: modelName,
        name: modelName,
        description: `Auto-created model for ${modelName}`,
        providerId: provider.id
      });
    }

    const agent = await this.agentRepo.findByHarnessIdAndRole(harnessId, role.toLowerCase());
    if (!agent) throw new NotFoundException('Agent not found in this harness.');

    const updated = await this.agentRepo.update(agent.id, { prompt, modelId: dbModel.id });

    if (harness.isActive) {
      this.observability.cancelRequestsForHarness(harnessId);
    }
    return updated;
  }

  private async validateModelConnectivity(provider: ProviderEntity, modelName: string) {
    if (provider.code.toLowerCase().includes('ollama') || (provider.baseUrl && provider.baseUrl.includes('11434'))) {
      const baseUrl = provider.baseUrl || 'http://localhost:11434';
      const checkUrl = baseUrl.endsWith('/') ? `${baseUrl}api/tags` : `${baseUrl}/api/tags`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(checkUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`Ollama responded with status ${res.status}`);
        }
        const data = await res.json() as { models?: { name: string }[] };
        const models = data.models || [];
        const exists = models.some(m => m.name === modelName || m.name.startsWith(modelName + ':') || modelName.startsWith(m.name + ':'));
        if (!exists) {
          throw new Error(`Model "${modelName}" is not pulled on Ollama. Pull it first using "ollama pull ${modelName}"`);
        }
      } catch (err: any) {
        throw new BadRequestException(`Failed to validate model connectivity to Ollama: ${err.message}`);
      }
    } else {
      if (provider.baseUrl) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(provider.baseUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (!res.ok && res.status !== 401 && res.status !== 403 && res.status !== 404) {
            throw new Error(`Server responded with status ${res.status}`);
          }
        } catch (err: any) {
          throw new BadRequestException(`Failed to validate cloud provider connectivity: ${err.message}`);
        }
      }
    }
  }

  async getAgent(harnessId: string, role: string): Promise<AgentDto> {
    const agent = await this.agentRepo.findByHarnessIdAndRole(harnessId, role.toLowerCase());
    if (!agent) throw new NotFoundException(`Agent not found for role ${role} in this harness.`);
    const agentMapper = new AgentMapper();
    return agentMapper.toDTO(agent);
  }
}
