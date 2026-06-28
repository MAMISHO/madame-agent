import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { BuiltInToolsService } from './built-in-tools.service';
import { SandboxManagerService } from './sandbox-manager.service';
import { ToolLoopService } from './tool-loop.service';
import { SkillManagerService } from './skill-manager.service';
import { SkillScraperService } from './skill-scraper.service';
import { ValidatorService } from './validator.service';
import { ProvidersModule } from '../providers/providers.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [ProvidersModule, ObservabilityModule],
  providers: [
    ToolRegistryService,
    BuiltInToolsService,
    SandboxManagerService,
    ToolLoopService,
    SkillManagerService,
    SkillScraperService,
    ValidatorService,
  ],
  exports: [
    ToolRegistryService,
    SandboxManagerService,
    ToolLoopService,
    SkillManagerService,
    SkillScraperService,
    ValidatorService,
  ],
})
export class ToolsModule {}
