import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HarnessStrategy } from './harness.strategy';
import { OpenCodeStrategy } from './strategies/opencode.strategy';
import { CliStrategy } from './strategies/cli.strategy';

@Injectable()
export class HarnessService {
  private readonly logger = new Logger(HarnessService.name);
  private readonly strategies = new Map<string, HarnessStrategy>();
  private defaultHarness: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly openCodeStrategy: OpenCodeStrategy,
    private readonly cliStrategy: CliStrategy,
  ) {
    this.strategies.set(openCodeStrategy.name, openCodeStrategy);
    this.strategies.set(cliStrategy.name, cliStrategy);

    // Read default harness from environment or config
    this.defaultHarness = 
      this.configService.get<string>('HARNESS_CLIENT') || 
      process.env.HARNESS_CLIENT || 
      'opencode';
    
    this.logger.log(`Initialized HarnessService with default strategy: "${this.defaultHarness}"`);
  }

  /**
   * Resolves the strategy dynamically based on client name or metadata.
   */
  getStrategy(harnessName?: string): HarnessStrategy {
    const name = (harnessName || this.defaultHarness).toLowerCase();
    const strategy = this.strategies.get(name);
    if (!strategy) {
      this.logger.warn(`Harness strategy "${name}" not found. Falling back to "${this.defaultHarness}".`);
      return this.strategies.get(this.defaultHarness) || this.openCodeStrategy;
    }
    return strategy;
  }
}
