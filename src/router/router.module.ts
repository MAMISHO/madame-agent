import { Module } from '@nestjs/common';
import { RouterService } from './router.service';
import { ProvidersModule } from '../providers/providers.module';
import { ClassifierModule } from '../classifier/classifier.module';

@Module({
  imports: [ProvidersModule, ClassifierModule],
  providers: [RouterService],
  exports: [RouterService],
})
export class RouterModule {}

