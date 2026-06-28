import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HarnessService } from './harness.service';
import { OpenCodeStrategy } from './strategies/opencode.strategy';
import { CliStrategy } from './strategies/cli.strategy';

@Module({
  imports: [ConfigModule],
  providers: [
    HarnessService,
    OpenCodeStrategy,
    CliStrategy,
  ],
  exports: [HarnessService],
})
export class HarnessModule {}
