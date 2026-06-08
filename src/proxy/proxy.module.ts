import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { RouterModule } from '../router/router.module';

@Module({
  imports: [RouterModule],
  controllers: [ProxyController],
  providers: [ProxyService]
})
export class ProxyModule {}
