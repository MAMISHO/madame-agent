import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HarnessService } from './harness.service';
import { HarnessController } from './harness.controller';
import { ProviderConfigController } from './provider-config.controller';
import { ScalableModelController } from './scalable-model.controller';
import { OpenCodeStrategy } from './strategies/opencode.strategy';
import { CliStrategy } from './strategies/cli.strategy';
import { RepositoryValidator } from '../core/application/services/repository-validator.service';

import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [ConfigModule, ObservabilityModule],
  controllers: [HarnessController, ProviderConfigController, ScalableModelController],
  providers: [
    HarnessService,
    OpenCodeStrategy,
    CliStrategy,
    RepositoryValidator,
  ],
  exports: [HarnessService],
})
export class HarnessModule {}
