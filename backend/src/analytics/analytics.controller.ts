// apps/api/src/analytics/analytics.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentMembership, Roles } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { AnalyticsService } from './analytics.service';

@Controller()
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) { }

  @Get('dashboard')
  dashboard(@CurrentMembership() m: Membership) {
    return m.role === 'LEADER'
      ? this.analytics.leaderDashboard(m)
      : this.analytics.memberDashboard(m);
  }

  @Get('reports')
  @Roles('LEADER')
  reports(@CurrentMembership() m: Membership, @Query() filters: Record<string, string>) {
    return this.analytics.reports(m, filters);
  }
}
