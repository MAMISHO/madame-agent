import { Module } from '@nestjs/common';
import { ConfidenceEngineService } from './confidence.service';

@Module({
  providers: [ConfidenceEngineService],
  exports: [ConfidenceEngineService],
})
export class ConfidenceModule {}
