import { describe, it, expect } from 'bun:test';
import { Money } from '../../../src/domain/money/money';
import { WagerTransaction } from '../../../src/domain/wager-transaction/wager-transaction';
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from '../../../src/domain/enums';
import { InvalidTransactionStateError, ReferenceResolutionError } from '../../../src/domain/errors';
import { FailureCode } from '../../../src/domain/failure-codes';

describe('WagerTransaction', () => {
  const baseProps = {
    id: 'tx-1',
    providerId: 'provider-1',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-1:ext-1',
    payloadHash: 'hash123',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '50.00', currency: 'BRL' }),
    referenceExternalTransactionId: undefined,
    createdAt: new Date('2024-01-01T10:00:00Z'),
  };

  describe('create', () => {
    it('creates transaction in PENDING status', () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.id).toBe('tx-1');
      expect(tx.kind).toBe(WagerTransactionKind.Bet);
    });

    it('requires reference for REFUND', () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: undefined,
        })
      ).toThrow('REFUND requires referenceExternalTransactionId');
    });

    it('requires reference for ROLLBACK', () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: undefined,
        })
      ).toThrow('ROLLBACK requires referenceExternalTransactionId');
    });

    it('rejects OPENING when source is not internal', () => {
      expect(() =>
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Opening,
        })
      ).toThrow('OPENING must be internal');
    });

    it('accepts OPENING when source is internal', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Opening,
        isInternal: true,
      });
      expect(tx.kind).toBe(WagerTransactionKind.Opening);
    });
  });

  describe('rehydrate', () => {
    it('reconstructs transaction from persisted state', () => {
      const tx = WagerTransaction.rehydrate({
        id: 'tx-1',
        providerId: 'provider-1',
        externalTransactionId: 'ext-1',
        idempotencyKey: 'provider-1:ext-1',
        payloadHash: 'hash123',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.Bet,
        money: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: undefined,
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: 'ref-tx-1',
        failureCode: undefined,
        processedAt: new Date('2024-01-01T10:00:00Z'),
        createdAt: new Date('2024-01-01T10:00:00Z'),
      });

      expect(tx.id).toBe('tx-1');
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.money.amount).toBe('50.00');
    });
  });

  describe('transitions', () => {
    it('markProcessed sets status to PROCESSED and records reference', () => {
      const tx = WagerTransaction.create(baseProps);
      const at = new Date('2024-01-01T10:05:00Z');
      tx.markProcessed('ref-tx-1', at);

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe('ref-tx-1');
      expect(tx.processedAt).toEqual(at);
      expect(tx.isTerminal()).toBe(true);
    });

    it('markPendingReference sets status to PENDING_REFERENCE', () => {
      const tx = WagerTransaction.create(baseProps);
      tx.markPendingReference();

      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);
    });

    it('reject sets status to REJECTED with failure code', () => {
      const tx = WagerTransaction.create(baseProps);
      tx.reject(FailureCode.InsufficientFunds);

      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(tx.isTerminal()).toBe(true);
    });

    it('fail sets status to FAILED with failure code', () => {
      const tx = WagerTransaction.create(baseProps);
      tx.fail(FailureCode.InternalError);

      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.InternalError);
      expect(tx.isTerminal()).toBe(true);
    });

    it('throws when transitioning from terminal state', () => {
      const tx = WagerTransaction.create(baseProps);
      tx.markProcessed('ref-1', new Date());

      expect(() => tx.markProcessed('ref-2', new Date())).toThrow(InvalidTransactionStateError);
      expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
      expect(() => tx.reject(FailureCode.ValidationFailed)).toThrow(InvalidTransactionStateError);
      expect(() => tx.fail(FailureCode.InternalError)).toThrow(InvalidTransactionStateError);
    });

    it('throws when markProcessed called for REFUND without referenceTransactionId', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-ref-1',
      });

      expect(() => tx.markProcessed(undefined, new Date())).toThrow('REFUND requires referenceTransactionId');
    });

    it('throws when markProcessed called for ROLLBACK without referenceTransactionId', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-ref-1',
      });

      expect(() => tx.markProcessed(undefined, new Date())).toThrow('ROLLBACK requires referenceTransactionId');
    });

    it('allows markProcessed with referenceTransactionId for REFUND', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-ref-1',
      });

      tx.markProcessed('ref-tx-1', new Date());
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe('ref-tx-1');
    });

    it('allows markProcessed with referenceTransactionId for ROLLBACK', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-ref-1',
      });

      tx.markProcessed('ref-tx-1', new Date());
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe('ref-tx-1');
    });
  });

  describe('queries', () => {
    it('isTerminal returns true for PROCESSED, REJECTED, FAILED', () => {
      const tx1 = WagerTransaction.create(baseProps);
      tx1.markProcessed('ref', new Date());
      expect(tx1.isTerminal()).toBe(true);

      const tx2 = WagerTransaction.create(baseProps);
      tx2.reject(FailureCode.ValidationFailed);
      expect(tx2.isTerminal()).toBe(true);

      const tx3 = WagerTransaction.create(baseProps);
      tx3.fail(FailureCode.InternalError);
      expect(tx3.isTerminal()).toBe(true);
    });

    it('isTerminal returns false for PENDING, PENDING_REFERENCE', () => {
      const tx1 = WagerTransaction.create(baseProps);
      expect(tx1.isTerminal()).toBe(false);

      const tx2 = WagerTransaction.create(baseProps);
      tx2.markPendingReference();
      expect(tx2.isTerminal()).toBe(false);
    });

    it('affectsBalance returns false for LOSS', () => {
      const tx = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Loss,
      });
      expect(tx.affectsBalance()).toBe(false);
    });

    it('affectsBalance returns true for BET, WIN, REFUND, ROLLBACK, OPENING', () => {
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Bet }).affectsBalance()
      ).toBe(true);
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win }).affectsBalance()
      ).toBe(true);
      expect(
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: 'ref',
        }).affectsBalance()
      ).toBe(true);
      expect(
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: 'ref',
        }).affectsBalance()
      ).toBe(true);
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Opening, isInternal: true }).affectsBalance()
      ).toBe(true);
    });

    it('requiresReference returns true for REFUND and ROLLBACK', () => {
      expect(
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: 'ref',
        }).requiresReference()
      ).toBe(true);
      expect(
        WagerTransaction.create({
          ...baseProps,
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: 'ref',
        }).requiresReference()
      ).toBe(true);
    });

    it('requiresReference returns false for other kinds', () => {
      expect(WagerTransaction.create(baseProps).requiresReference()).toBe(false);
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win }).requiresReference()
      ).toBe(false);
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Loss }).requiresReference()
      ).toBe(false);
      expect(
        WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Opening, isInternal: true }).requiresReference()
      ).toBe(false);
    });

    it('matchesPayload returns true for same hash', () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.matchesPayload('hash123')).toBe(true);
      expect(tx.matchesPayload('different')).toBe(false);
    });

    it('ledgerDirectionFor returns Debit for BET', () => {
      const tx = WagerTransaction.create(baseProps);
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    });

    it('ledgerDirectionFor returns Credit for WIN', () => {
      const tx = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.Win });
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    it('ledgerDirectionFor returns inverse for ROLLBACK', () => {
      const refTx = WagerTransaction.create(baseProps);
      refTx.markProcessed('ref', new Date());

      const rollback = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-1',
      });
      expect(rollback.ledgerDirectionFor(refTx)).toBe(LedgerDirection.Credit); // inverse of Debit
    });
  });

  describe('resultBalance', () => {
    it('sets resultBalance once per stored outcome', () => {
      const tx = WagerTransaction.create(baseProps);
      tx.markProcessed('ref', new Date());
      expect(tx.resultBalance).toBeUndefined();
    });
  });
});