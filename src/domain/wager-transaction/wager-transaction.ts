import { Money } from '../money/money';
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from '../enums';
import { InvalidTransactionStateError, ReferenceResolutionError } from '../errors';
import { FailureCode } from '../failure-codes';

export interface WagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  isInternal?: boolean;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: string;
  currency: string;
  referenceExternalTransactionId?: string;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  createdAt: Date;
  resultBalance?: string;
}

interface WagerTransactionInternalState {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  resultBalance?: Money;
}

export class WagerTransaction {
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: WagerTransactionKind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId?: string;
  public readonly createdAt: Date;

  private _state: WagerTransactionInternalState;

  private constructor(props: WagerTransactionProps, status: WagerTransactionStatus = WagerTransactionStatus.Pending) {
    this.id = props.id;
    this.providerId = props.providerId;
    this.externalTransactionId = props.externalTransactionId;
    this.idempotencyKey = props.idempotencyKey;
    this.payloadHash = props.payloadHash;
    this.walletId = props.walletId;
    this.playerId = props.playerId;
    this.roundId = props.roundId;
    this.gameId = props.gameId;
    this.kind = props.kind;
    this.money = props.money;
    this.referenceExternalTransactionId = props.referenceExternalTransactionId;
    this.createdAt = props.createdAt;
    this._state = {
      status,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: undefined,
      resultBalance: undefined,
    };
  }

  static create(props: WagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback) {
      if (!props.referenceExternalTransactionId) {
        throw new Error(`${props.kind} requires referenceExternalTransactionId`);
      }
    }

    if (props.kind === WagerTransactionKind.Opening && !props.isInternal) {
      throw new Error('OPENING must be internal');
    }

    return new WagerTransaction(props, WagerTransactionStatus.Pending);
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    const tx = new WagerTransaction(
      {
        id: state.id,
        providerId: state.providerId,
        externalTransactionId: state.externalTransactionId,
        idempotencyKey: state.idempotencyKey,
        payloadHash: state.payloadHash,
        walletId: state.walletId,
        playerId: state.playerId,
        roundId: state.roundId,
        gameId: state.gameId,
        kind: state.kind,
        money: Money.from({ amount: state.money, currency: state.currency }),
        referenceExternalTransactionId: state.referenceExternalTransactionId,
        createdAt: state.createdAt,
      },
      state.status
    );

    tx._state = {
      status: state.status,
      referenceTransactionId: state.referenceTransactionId,
      failureCode: state.failureCode,
      processedAt: state.processedAt,
      resultBalance: state.resultBalance ? Money.fromInternal(state.resultBalance, state.currency) : undefined,
    };
    return tx;
  }

  get status(): WagerTransactionStatus {
    return this._state.status;
  }

  get referenceTransactionId(): string | undefined {
    return this._state.referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._state.failureCode;
  }

  get processedAt(): Date | undefined {
    return this._state.processedAt;
  }

  get resultBalance(): Money | undefined {
    return this._state.resultBalance;
  }

  isTerminal(): boolean {
    return (
      this._state.status === WagerTransactionStatus.Processed ||
      this._state.status === WagerTransactionStatus.Rejected ||
      this._state.status === WagerTransactionStatus.Failed
    );
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError('Cannot transition from terminal state');
    }
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();

    // REFUND and ROLLBACK require a reference transaction ID
    if ((this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback) && !referenceTransactionId) {
      throw new Error(`${this.kind} requires referenceTransactionId`);
    }

    this._state.status = WagerTransactionStatus.Processed;
    this._state.referenceTransactionId = referenceTransactionId;
    this._state.processedAt = at;
  }

  markPendingReference(): void {
    this.assertNotTerminal();
    this._state.status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._state.status = WagerTransactionStatus.Rejected;
    this._state.failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._state.status = WagerTransactionStatus.Failed;
    this._state.failureCode = code;
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Loss:
        return LedgerDirection.Debit; // doesn't affect balance but direction is debit
      case WagerTransactionKind.Rollback:
        if (reference) {
          // Inverse of reference direction
          const refDirection = reference.ledgerDirectionFor();
          return refDirection === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
        }
        return LedgerDirection.Debit;
      default:
        return LedgerDirection.Debit;
    }
  }

  // Allow setting resultBalance for replay snapshot
  setResultBalance(balance: Money): void {
    this._state.resultBalance = balance;
  }
}