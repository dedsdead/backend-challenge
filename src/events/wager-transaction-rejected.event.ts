import { Money } from '../domain/money/money';
import { IntegrationEvent } from './integration-event';

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  kind: string;
  money: { amount: string; currency: string };
  failureCode: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(props: {
    eventId: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: Date;
    transactionId: string;
    walletId: string;
    kind: string;
    money: Money;
    failureCode: string;
  }): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.correlationId,
      causationId: props.causationId,
      occurredAt: props.occurredAt,
      data: {
        transactionId: props.transactionId,
        walletId: props.walletId,
        kind: props.kind,
        money: props.money.toJSON(),
        failureCode: props.failureCode,
      },
    });
  }
}