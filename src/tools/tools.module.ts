import { Module } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { BuiltInToolsService } from './built-in-tools.service';
import { SandboxManagerService } from './sandbox-manager.service';
import { ToolLoopService } from './tool-loop.service';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  providers: [ToolRegistryService, BuiltInToolsService, SandboxManagerService, ToolLoopService],
  exports: [ToolRegistryService, SandboxManagerService, ToolLoopService],
})
export class ToolsModule {}
