import { describe, expect, it, mock } from 'bun:test';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { SqsQueueProber } from '../../../src/health/sqs-prober';

const MAIN = 'http://localhost:4566/000000000000/wager-transactions.fifo';
const DLQ = 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';

describe('SqsQueueProber', () => {
  it('probes the main queue and the DLQ with GetQueueAttributes', async () => {
    const send = mock(() => Promise.resolve({ Attributes: {} }));
    const prober = new SqsQueueProber({ send } as never, MAIN, DLQ);

    await prober.probe();

    expect(send).toHaveBeenCalledTimes(2);
    const [first, second] = send.mock.calls as unknown as [
      [GetQueueAttributesCommand],
      [GetQueueAttributesCommand],
    ];
    const firstCmd = first[0];
    const secondCmd = second[0];
    expect(firstCmd).toBeInstanceOf(GetQueueAttributesCommand);
    expect(secondCmd).toBeInstanceOf(GetQueueAttributesCommand);
    expect(firstCmd.input.QueueUrl).toBe(MAIN);
    expect(secondCmd.input.QueueUrl).toBe(DLQ);
  });

  it('rejects when the main queue is unreachable', async () => {
    const send = mock(() => Promise.reject(new Error('ECONNREFUSED')));
    const prober = new SqsQueueProber({ send } as never, MAIN, DLQ);
    await expect(prober.probe()).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects when the DLQ is unreachable', async () => {
    let call = 0;
    const send = mock(() =>
      call++ === 0
        ? Promise.resolve({ Attributes: {} })
        : Promise.reject(new Error('QueueDoesNotExist')),
    );
    const prober = new SqsQueueProber({ send } as never, MAIN, DLQ);
    await expect(prober.probe()).rejects.toThrow('QueueDoesNotExist');
  });
});
