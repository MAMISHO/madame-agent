import { Module } from '@nestjs/common';
import { RouterService } from './router.service';
import { ProvidersModule } from '../providers/providers.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { ConfidenceModule } from '../confidence/confidence.module';
import { ContextModule } from '../context/context.module';

@Module({
  imports: [ProvidersModule, ClassifierModule, ConfidenceModule, ContextModule],
  providers: [RouterService],
  exports: [RouterService],
})
export class RouterModule {}
