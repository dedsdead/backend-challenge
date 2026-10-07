import { Money } from '../domain/money/money';
import { IntegrationEvent } from './integration-event';

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  kind: string;
  money: { amount: string; currency: string };
  balanceBefore: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string };
  walletVersion: number;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
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
    balanceBefore: Money;
    balanceAfter: Money;
    walletVersion: number;
  }): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
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
        balanceBefore: props.balanceBefore.toJSON(),
        balanceAfter: props.balanceAfter.toJSON(),
        walletVersion: props.walletVersion,
      },
    });
  }
}