import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { createSqsClient } from '../messaging/sqs.client';

/** Minimal send surface so the prober is unit-testable without a live broker. */
export interface QueueSender {
  send(command: GetQueueAttributesCommand): Promise<unknown>;
}

/** Readiness probe (plan T047): main queue + DLQ must both answer. */
export class SqsQueueProber {
  constructor(
    private readonly client: QueueSender,
    private readonly queueUrl: string,
    private readonly dlqUrl: string,
  ) {}

  async probe(): Promise<void> {
    await Promise.all([
      this.client.send(
        new GetQueueAttributesCommand({ QueueUrl: this.queueUrl }),
      ),
      this.client.send(
        new GetQueueAttributesCommand({ QueueUrl: this.dlqUrl }),
      ),
    ]);
  }
}

export const SQS_PROBER = 'SQS_PROBER';

export function createSqsProber(config: ConfigService): SqsQueueProber {
  const client: SQSClient = createSqsClient(config);
  return new SqsQueueProber(
    client as unknown as QueueSender,
    config.getOrThrow<string>('SQS_QUEUE_URL'),
    config.getOrThrow<string>('SQS_DLQ_URL'),
  );
}
