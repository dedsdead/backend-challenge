import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { correlationIdMiddleware } from './correlation';

/**
 * Observability surface of the wagering processor (plan T045/T046):
 * Prometheus metrics endpoint and the correlationId middleware that runs for
 * every request. Registered on the module (not `main.ts`) so the middleware
 * is active in integration tests that boot `AppModule` directly.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5 / path-to-regexp v8: the catch-all must be a named wildcard.
    consumer
      .apply(correlationIdMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
