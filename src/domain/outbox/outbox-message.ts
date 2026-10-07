import { IntegrationEvent } from '../../events/integration-event';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

function validateWalletBalanceChanged(p: Record<string, unknown>): void {
  const required = ['walletId', 'transactionId', 'direction', 'money', 'balanceBefore', 'balanceAfter', 'walletVersion'];
  for (const field of required) {
    if (!(field in p)) throw new Error(`WalletBalanceChanged payload missing required field: ${field}`);
    if (['money', 'balanceBefore', 'balanceAfter'].includes(field)) {
      const money = p[field] as Record<string, unknown>;
      if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
        throw new Error(`WalletBalanceChanged payload.${field} must be { amount: string, currency: string }`);
      }
    }
    if (field === 'direction' && !['DEBIT', 'CREDIT'].includes(p.direction as string)) {
      throw new Error('WalletBalanceChanged payload.direction must be DEBIT or CREDIT');
    }
    if (field === 'walletVersion' && typeof p.walletVersion !== 'number') {
      throw new Error('WalletBalanceChanged payload.walletVersion must be a number');
    }
  }
}

function validateWagerTransactionProcessed(p: Record<string, unknown>): void {
  const required = ['transactionId', 'walletId', 'kind', 'money', 'balanceBefore', 'balanceAfter', 'walletVersion'];
  for (const field of required) {
    if (!(field in p)) throw new Error(`WagerTransactionProcessed payload missing required field: ${field}`);
    if (['money', 'balanceBefore', 'balanceAfter'].includes(field)) {
      const money = p[field] as Record<string, unknown>;
      if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
        throw new Error(`WagerTransactionProcessed payload.${field} must be { amount: string, currency: string }`);
      }
    }
    if (field === 'walletVersion' && typeof p.walletVersion !== 'number') {
      throw new Error('WagerTransactionProcessed payload.walletVersion must be a number');
    }
  }
}

function validateWagerTransactionRejected(p: Record<string, unknown>): void {
  const required = ['transactionId', 'walletId', 'kind', 'money', 'failureCode'];
  for (const field of required) {
    if (!(field in p)) throw new Error(`WagerTransactionRejected payload missing required field: ${field}`);
    if (field === 'money') {
      const money = p[field] as Record<string, unknown>;
      if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
        throw new Error('WagerTransactionRejected payload.money must be { amount: string, currency: string }');
      }
    }
  }
}

function validateWagerTransactionPendingReference(p: Record<string, unknown>): void {
  const required = ['transactionId', 'walletId', 'kind', 'money', 'referenceExternalTransactionId'];
  for (const field of required) {
    if (!(field in p)) throw new Error(`WagerTransactionPendingReference payload missing required field: ${field}`);
    if (field === 'money') {
      const money = p[field] as Record<string, unknown>;
      if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
        throw new Error('WagerTransactionPendingReference payload.money must be { amount: string, currency: string }');
      }
    }
  }
}

const VALIDATORS: Record<string, (p: Record<string, unknown>) => void> = {
  WalletBalanceChanged: (p: Record<string, unknown>) => {
    const required = ['walletId', 'transactionId', 'direction', 'money', 'balanceBefore', 'balanceAfter', 'walletVersion'];
    for (const field of required) {
      if (!(field in p)) throw new Error(`WalletBalanceChanged payload missing required field: ${field}`);
      if (['money', 'balanceBefore', 'balanceAfter'].includes(field)) {
        const money = p[field] as Record<string, unknown>;
        if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
          throw new Error(`WalletBalanceChanged payload.${field} must be { amount: string, currency: string }`);
        }
      }
      if (field === 'direction' && !['DEBIT', 'CREDIT'].includes(p.direction as string)) {
        throw new Error('WalletBalanceChanged payload.direction must be DEBIT or CREDIT');
      }
      if (field === 'walletVersion' && typeof p.walletVersion !== 'number') {
        throw new Error('WalletBalanceChanged payload.walletVersion must be a number');
      }
    }
  },
  WagerTransactionProcessed: (p: Record<string, unknown>) => {
    const required = ['transactionId', 'walletId', 'kind', 'money', 'balanceBefore', 'balanceAfter', 'walletVersion'];
    for (const field of required) {
      if (!(field in p)) throw new Error(`WagerTransactionProcessed payload missing required field: ${field}`);
      if (['money', 'balanceBefore', 'balanceAfter'].includes(field)) {
        const money = p[field] as Record<string, unknown>;
        if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
          throw new Error(`WagerTransactionProcessed payload.${field} must be { amount: string, currency: string }`);
        }
      }
      if (field === 'walletVersion' && typeof p.walletVersion !== 'number') {
        throw new Error('WagerTransactionProcessed payload.walletVersion must be a number');
      }
    }
  },
  WagerTransactionRejected: (p: Record<string, unknown>) => {
    const required = ['transactionId', 'walletId', 'kind', 'money', 'failureCode'];
    for (const field of required) {
      if (!(field in p)) throw new Error(`WagerTransactionRejected payload missing required field: ${field}`);
      if (field === 'money') {
        const money = p[field] as Record<string, unknown>;
        if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
          throw new Error('WagerTransactionRejected payload.money must be { amount: string, currency: string }');
        }
      }
    }
  },
  WagerTransactionPendingReference: (p: Record<string, unknown>) => {
    const required = ['transactionId', 'walletId', 'kind', 'money', 'referenceExternalTransactionId'];
    for (const field of required) {
      if (!(field in p)) throw new Error(`WagerTransactionPendingReference payload missing required field: ${field}`);
      if (field === 'money') {
        const money = p[field] as Record<string, unknown>;
        if (!money || typeof money.amount !== 'string' || typeof money.currency !== 'string') {
          throw new Error('WagerTransactionPendingReference payload.money must be { amount: string, currency: string }');
        }
      }
    }
  },
};

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  public readonly payload: Readonly<Record<string, unknown>>;
  public readonly occurredAt: Date;
  public readonly attempts: number;
  public readonly nextAttemptAt: Date | undefined;
  public readonly publishedAt: Date | undefined;

  private constructor(
    id: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    attempts: number,
    nextAttemptAt: Date | undefined,
    publishedAt: Date | undefined,
  ) {
    this.id = id;
    this.aggregateId = aggregateId;
    this.eventType = eventType;
    this.payload = payload;
    this.occurredAt = occurredAt;
    this.attempts = attempts;
    this.nextAttemptAt = nextAttemptAt;
    this.publishedAt = publishedAt;
  }

  static enqueue(event: { eventId: string; aggregateId: string; eventType: string; payload: Record<string, unknown>; occurredAt: Date }): OutboxMessage {
    OutboxMessage.validatePayload(event.eventType, event.payload);
    return new OutboxMessage(event.eventId, event.aggregateId, event.eventType, event.payload, event.occurredAt, 0, undefined, undefined);
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state.id, state.aggregateId, state.eventType, state.payload, state.occurredAt, state.attempts, state.nextAttemptAt, state.publishedAt);
  }

  private static validatePayload(eventType: string, payload: Record<string, unknown>): void {
    const validator = VALIDATORS[eventType];
    if (validator) validator(payload);
  }

  isPending(): boolean { return this.publishedAt === undefined; }
  isPublished(): boolean { return this.publishedAt !== undefined; }
  isDue(now: Date): boolean { return !this.nextAttemptAt || now >= this.nextAttemptAt; }
  markPublished(at: Date): void { (this as any).publishedAt = at; }
  scheduleRetry(now: Date): void {
    (this as any).attempts += 1;
    const delaySeconds = Math.min(Math.pow(2, (this as any).attempts) * 1, 300);
    (this as any).nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);
  }
}