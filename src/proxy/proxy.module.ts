import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { RouterModule } from '../router/router.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [RouterModule, ObservabilityModule],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
