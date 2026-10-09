import { describe, expect, it } from 'bun:test';
import type { Message } from '@aws-sdk/client-sqs';
import { metrics } from '../../../src/common/metrics/metrics';
import { ValidationError } from '../../../src/domain/errors';

const envDefaults: Record<string, string> = {
  SQS_ENDPOINT: 'http://localhost:4566',
  SQS_QUEUE_URL: 'http://localhost:4566/000000000000/wager-transactions.fifo',
  SQS_DLQ_URL: 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo',
  KEYCLOAK_ISSUER: 'http://localhost:8080/realms/wagering',
  KEYCLOAK_AUDIENCE: 'wagering-api',
  LOG_LEVEL: 'silent',
  WORKERS_ENABLED: 'false',
};

const makeConsumer = async () => {
  for (const [key, value] of Object.entries(envDefaults)) {
    process.env[key] ??= value;
  }
  const { WagerTransactionConsumer } = await import(
    '../../../src/messaging/wager-transaction.consumer'
  );
  const config = {
    get: (key: string) => process.env[key],
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`missing ${key}`);
      return value;
    },
  } as never;
  const consumer = new WagerTransactionConsumer(config, {} as never);
  const sent: unknown[] = [];
  (consumer as unknown as { sqsClient: unknown }).sqsClient = {
    send: async (command: unknown) => {
      sent.push(command);
      return {};
    },
  };
  return { consumer, sent };
};

const message: Message = { MessageId: 'msg-1', ReceiptHandle: 'rh-1', Body: '{}' };

describe('WagerTransactionConsumer metrics (plan T046)', () => {
  it('counts transient failures as sqs retries without touching the DLQ', async () => {
    const { consumer, sent } = await makeConsumer();
    const before = metrics.wageringSqsRetriesTotal.count;

    await (consumer as never as {
      handleProcessingError: (m: Message, r: string | undefined, e: unknown) => Promise<void>;
    }).handleProcessingError(message, 'rh-1', new Error('db connection reset'));

    expect(metrics.wageringSqsRetriesTotal.count).toBe(before + 1);
    expect(sent).toHaveLength(0);
  });

  it('counts permanent failures forwarded to the DLQ', async () => {
    const { consumer, sent } = await makeConsumer();
    const before = metrics.wageringDlqReceivedTotal.count;

    await (consumer as never as {
      handleProcessingError: (m: Message, r: string | undefined, e: unknown) => Promise<void>;
    }).handleProcessingError(
      message,
      'rh-1',
      new ValidationError('SQS message envelope missing required fields'),
    );

    expect(metrics.wageringDlqReceivedTotal.count).toBe(before + 1);
    expect(sent.length).toBeGreaterThan(0);
  });
});
