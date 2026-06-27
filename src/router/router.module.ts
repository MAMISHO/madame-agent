import { Module } from '@nestjs/common';
import { RouterService } from './router.service';
import { WorkflowService } from './workflow.service';
import { SessionManager } from './session.manager';
import { ProvidersModule } from '../providers/providers.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { ConfidenceModule } from '../confidence/confidence.module';
import { ContextModule } from '../context/context.module';
import { CacheModule } from '../cache/cache.module';
import { TranslationModule } from '../translation/translation.module';
import { ToolsModule } from '../tools/tools.module';
import { ObservabilityModule } from '../observability/observability.module';
import { HarnessModule } from '../harness/harness.module';

@Module({
  imports: [
    ProvidersModule,
    ClassifierModule,
    ConfidenceModule,
    ContextModule,
    CacheModule,
    TranslationModule,
    ToolsModule,
    ObservabilityModule,
    HarnessModule,
  ],
  providers: [RouterService, WorkflowService, SessionManager],
  exports: [RouterService, WorkflowService, SessionManager],
})
export class RouterModule {}
