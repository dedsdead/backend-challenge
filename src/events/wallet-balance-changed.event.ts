import { Money } from '../domain/money/money';
import { LedgerDirection } from '../domain/enums';
import { IntegrationEvent } from './integration-event';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: { amount: string; currency: string };
  balanceBefore: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string };
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(props: {
    eventId: string;
    aggregateId: string;
    correlationId: string;
    causationId?: string;
    occurredAt: Date;
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    walletVersion: number;
  }): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: props.eventId,
      aggregateId: props.aggregateId,
      correlationId: props.correlationId,
      causationId: props.causationId,
      occurredAt: props.occurredAt,
      data: {
        walletId: props.walletId,
        transactionId: props.transactionId,
        direction: props.direction,
        money: props.money.toJSON(),
        balanceBefore: props.balanceBefore.toJSON(),
        balanceAfter: props.balanceAfter.toJSON(),
        walletVersion: props.walletVersion,
      },
    });
  }
}