import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('live')
  live() {
    return this.health.live();
  }

  @Public()
  @Get('ready')
  ready() {
    return this.health.ready();
  }
}
