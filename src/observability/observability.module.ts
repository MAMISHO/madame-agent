import { Module } from '@nestjs/common';
import { ObservabilityService } from './observability.service';
import { CostTrackerService } from './cost-tracker.service';

@Module({
  providers: [ObservabilityService, CostTrackerService],
  exports: [ObservabilityService, CostTrackerService],
})
export class ObservabilityModule {}
