import { Money } from '../domain/money/money';
import { IntegrationEvent } from './integration-event';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
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
    referenceExternalTransactionId: string;
  }): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
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
        referenceExternalTransactionId: props.referenceExternalTransactionId,
      },
    });
  }
}