import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Plan T046: `GET /metrics` is part of the unauthenticated monitoring
 * surface (README §2/§9, same category as the health endpoints), so it is
 * explicitly `@Public()` and will stay reachable once the global JWT guard
 * lands in T044.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Public()
  async render(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader('Content-Type', this.metricsService.contentType);
    return this.metricsService.render();
  }
}
