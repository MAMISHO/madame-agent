import { Module, Global } from '@nestjs/common';
import { AgentLoggerService } from './agent-logger.service';
import { McpClientService } from './mcp-client.service';

@Global()
@Module({
  providers: [AgentLoggerService, McpClientService],
  exports: [AgentLoggerService, McpClientService],
})
export class UtilsModule {}
