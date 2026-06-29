import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HarnessService } from './harness.service';
import { HarnessController } from './harness.controller';
import { ProviderConfigController } from './provider-config.controller';
import { ScalableModelController } from './scalable-model.controller';
import { OpenCodeStrategy } from './strategies/opencode.strategy';
import { CliStrategy } from './strategies/cli.strategy';
import { RepositoryValidator } from '../core/application/services/repository-validator.service';

import { HarnessRepositoryImpl } from './infra/persistence/repositories/impl/harness.repository.impl';
import { AgentRepositoryImpl } from './infra/persistence/repositories/impl/agent.repository.impl';
import { ModelRepositoryImpl } from './infra/persistence/repositories/impl/model.repository.impl';
import { ProviderRepositoryImpl } from './infra/persistence/repositories/impl/provider.repository.impl';

import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [ConfigModule, ObservabilityModule],
  controllers: [HarnessController, ProviderConfigController, ScalableModelController],
  providers: [
    HarnessService,
    OpenCodeStrategy,
    CliStrategy,
    RepositoryValidator,
    { provide: 'IHarnessRepository', useClass: HarnessRepositoryImpl },
    { provide: 'IAgentRepository', useClass: AgentRepositoryImpl },
    { provide: 'IModelRepository', useClass: ModelRepositoryImpl },
    { provide: 'IProviderRepository', useClass: ProviderRepositoryImpl },
  ],
  exports: [HarnessService],
})
export class HarnessModule {}
