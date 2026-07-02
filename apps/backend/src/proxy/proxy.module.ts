import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { OllamaProxyController } from './ollama-proxy.controller';
import { ProxyService } from './proxy.service';
import { RouterModule } from '../router/router.module';
import { ObservabilityModule } from '../observability/observability.module';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [RouterModule, ObservabilityModule, UtilsModule],
  controllers: [ProxyController, OllamaProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
