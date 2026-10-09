import { describe, expect, it } from 'bun:test';
import { createLogger, PinoLoggerService } from '../../../src/observability/logger';

const capture = () => {
  const chunks: string[] = [];
  const destination = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  };
  return { chunks, destination };
};

describe('pino logger (plan T045)', () => {
  it('binds the base service name wagering-processor', () => {
    const { chunks, destination } = capture();
    const logger = createLogger({ destination });
    logger.info('boot');
    const line = JSON.parse(chunks.join('').trim());
    expect(line.service).toBe('wagering-processor');
    expect(line.level).toBe(30);
    expect(line.msg).toBe('boot');
  });

  it('redacts the authorization header, data, payload and body paths', () => {
    const { chunks, destination } = capture();
    const logger = createLogger({ destination });
    logger.info(
      {
        req: { headers: { authorization: 'Bearer super-secret-token' } },
        data: { amount: '100.00', currency: 'BRL' },
        payload: { playerId: 'p-1', walletId: 'w-1' },
        body: { balance: '900.00' },
      },
      'request',
    );
    const output = chunks.join('');
    expect(output).not.toContain('super-secret-token');
    expect(output).not.toContain('900.00');
    expect(output).toContain('[Redacted]');
    const line = JSON.parse(output.trim());
    expect(line.req.headers.authorization).toBe('[Redacted]');
  });

  it('exposes a Nest LoggerService adapter that logs JSON with context', () => {
    const { chunks, destination } = capture();
    const service = new PinoLoggerService({ destination });
    service.log('processed', 'SubmitTransactionUseCase', {
      correlationId: 'cid-1',
      transactionId: 'tx-1',
    });
    const line = JSON.parse(chunks.join('').trim());
    expect(line.msg).toBe('processed');
    expect(line.context).toBe('SubmitTransactionUseCase');
    expect(line.correlationId).toBe('cid-1');
    expect(line.transactionId).toBe('tx-1');
    expect(line.service).toBe('wagering-processor');
  });

  it('redacts nested financial fields (amount, currency, walletId, playerId, balance)', () => {
    const { chunks, destination } = capture();
    const logger = createLogger({ destination });
    logger.info(
      {
        req: {
          body: {
            transaction: { amount: '100.00', currency: 'BRL', walletId: 'w-1' },
            playerId: 'p-1',
            balance: '900.00',
          },
        },
        data: { nested: { amount: '50.00', currency: 'USD' } },
        payload: { inner: { walletId: 'w-2', playerId: 'p-2' } },
      },
      'nested request',
    );
    const output = chunks.join('');
    expect(output).not.toContain('100.00');
    expect(output).not.toContain('900.00');
    expect(output).not.toContain('50.00');
    expect(output).not.toContain('BRL');
    expect(output).not.toContain('USD');
    expect(output).not.toContain('w-1');
    expect(output).not.toContain('w-2');
    expect(output).not.toContain('p-1');
    expect(output).not.toContain('p-2');
    expect(output).toContain('[Redacted]');
  });
});
