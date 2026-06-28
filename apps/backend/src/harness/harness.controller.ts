import { Controller, Get, Post, Body, Param, Put, Delete, BadRequestException, NotFoundException } from '@nestjs/common';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';
import { AgentConfigEntity } from '../core/infra/database/entities/agent-config.entity';
import { ProviderConfigEntity } from '../core/infra/database/entities/provider-config.entity';
import { readFileSync } from 'fs';
import { join } from 'path';

// Seed helper to return default agent prompts
function getDefaultPromptText(role: string): string {
  try {
    const filenameMap: Record<string, string> = {
      preparer: 'preparer.md',
      planner: 'planner.md',
      orchestrator: 'orchestrator-delegate.md',
      executor: 'executor.md',
      qa: 'qa.md',
      supervisor: 'supervisor.md',
    };
    const file = filenameMap[role.toLowerCase()];
    if (!file) return '';
    const filePath = join(__dirname, '../prompts/templates', file);
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return `Default system instructions for ${role}`;
  }
}

@Controller('v1/harness')
export class HarnessController {

  @Get()
  async listAll() {
    // Seed default harness if database is empty
    let defaultHarness = await HarnessEntity.findOne({ where: { isDefault: true } });
    if (!defaultHarness) {
      defaultHarness = await HarnessEntity.create({
        name: 'Default Harness',
        isDefault: true,
        isActive: true,
      });
      // Seed default agent configurations
      const roles = ['preparer', 'planner', 'orchestrator', 'executor', 'qa', 'supervisor'];
      for (const role of roles) {
        await AgentConfigEntity.create({
          harnessId: defaultHarness.id,
          role,
          prompt: getDefaultPromptText(role),
          providerId: 'ollama',
          modelName: 'gemma4:latest-oc',
        });
      }
    }

    return HarnessEntity.findAll({ include: [AgentConfigEntity] });
  }

  @Post()
  async create(@Body() body: { name: string }) {
    const { name } = body;
    if (!name) {
      throw new BadRequestException('Harness name is required.');
    }

    const trimmedName = name.trim();

    // Validations: min 8, max 25 characters, no spaces, no special characters
    if (trimmedName.length < 8 || trimmedName.length > 25) {
      throw new BadRequestException('Harness name must be between 8 and 25 characters.');
    }

    const nameRegex = /^[a-zA-Z0-9_\-]+$/;
    if (!nameRegex.test(trimmedName)) {
      throw new BadRequestException('Harness name cannot contain spaces or special characters (only letters, numbers, dashes, and underscores are allowed).');
    }

    const exists = await HarnessEntity.findOne({ where: { name: trimmedName } });
    if (exists) {
      throw new BadRequestException('A harness with this name already exists.');
    }

    // Create the custom harness
    const harness = await HarnessEntity.create({
      name: trimmedName,
      isDefault: false,
      isActive: false,
    });

    // Copy agent configurations from default harness
    const defaultHarness = await HarnessEntity.findOne({ where: { isDefault: true }, include: [AgentConfigEntity] });
    if (defaultHarness && defaultHarness.agents) {
      for (const agent of defaultHarness.agents) {
        await AgentConfigEntity.create({
          harnessId: harness.id,
          role: agent.role,
          prompt: agent.prompt,
          providerId: agent.providerId,
          modelName: agent.modelName,
        });
      }
    }

    return HarnessEntity.findByPk(harness.id, { include: [AgentConfigEntity] });
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const harness = await HarnessEntity.findByPk(id, { include: [AgentConfigEntity] });
    if (!harness) {
      throw new NotFoundException('Harness not found.');
    }
    return harness;
  }

  @Put(':id/active')
  async setActive(@Param('id') id: string) {
    const harness = await HarnessEntity.findByPk(id);
    if (!harness) {
      throw new NotFoundException('Harness not found.');
    }

    // Set all others to inactive
    await HarnessEntity.update({ isActive: false }, { where: {} });

    // Set this one to active
    harness.isActive = true;
    await harness.save();

    return { message: `Harness "${harness.name}" is now active.`, activeId: harness.id };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const harness = await HarnessEntity.findByPk(id);
    if (!harness) {
      throw new NotFoundException('Harness not found.');
    }

    if (harness.isDefault) {
      throw new BadRequestException('The default harness cannot be deleted.');
    }

    const wasActive = harness.isActive;

    // Delete associated agent configs and harness
    await AgentConfigEntity.destroy({ where: { harnessId: id } });
    await harness.destroy();

    // Fallback active to default if the deleted harness was active
    if (wasActive) {
      await HarnessEntity.update({ isActive: true }, { where: { isDefault: true } });
    }

    return { message: 'Harness deleted successfully.' };
  }

  @Put(':id/agents/:role')
  async updateAgent(
    @Param('id') id: string,
    @Param('role') role: string,
    @Body() body: { prompt: string; providerId: string; modelName: string }
  ) {
    const harness = await HarnessEntity.findByPk(id);
    if (!harness) {
      throw new NotFoundException('Harness not found.');
    }

    if (harness.isDefault) {
      throw new BadRequestException('The default harness configurations cannot be modified.');
    }

    const agentConfig = await AgentConfigEntity.findOne({
      where: { harnessId: id, role: role.toLowerCase() },
    });

    if (!agentConfig) {
      throw new NotFoundException(`Agent configuration for role "${role}" not found in this harness.`);
    }

    agentConfig.prompt = body.prompt;
    agentConfig.providerId = body.providerId;
    agentConfig.modelName = body.modelName;
    await agentConfig.save();

    return agentConfig;
  }
}
