import { describe, it, expect } from 'bun:test';
import { ValidationError } from '../../../../src/domain/errors';
import {
  encodeLedgerCursor,
  decodeLedgerCursor,
} from '../../../../src/modules/wallets/ledger-cursor.codec';

const ID = '0192f291-27dd-7d3f-8071-5f8685deef37';
const AT = new Date('2026-10-07T12:00:00.000Z');

describe('ledger-cursor codec', () => {
  it('round-trips createdAt and id', () => {
    const encoded = encodeLedgerCursor({ createdAt: AT, id: ID });
    const decoded = decodeLedgerCursor(encoded);
    expect(decoded.createdAt.toISOString()).toBe(AT.toISOString());
    expect(decoded.id).toBe(ID);
  });

  it('emits a query-safe base64url string', () => {
    const encoded = encodeLedgerCursor({ createdAt: AT, id: ID });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('rejects garbage input with ValidationError', () => {
    expect(() => decodeLedgerCursor('!!!not-a-cursor!!!')).toThrow(ValidationError);
  });

  it('rejects base64 that is not JSON', () => {
    expect(() => decodeLedgerCursor('YWJj')).toThrow(ValidationError);
  });

  it('rejects JSON missing id', () => {
    const raw = Buffer.from(JSON.stringify({ createdAt: AT.toISOString() })).toString('base64url');
    expect(() => decodeLedgerCursor(raw)).toThrow(ValidationError);
  });

  it('rejects non-UUID id', () => {
    const raw = Buffer.from(
      JSON.stringify({ createdAt: AT.toISOString(), id: 'nope' }),
    ).toString('base64url');
    expect(() => decodeLedgerCursor(raw)).toThrow(ValidationError);
  });

  it('rejects invalid createdAt', () => {
    const raw = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: ID })).toString('base64url');
    expect(() => decodeLedgerCursor(raw)).toThrow(ValidationError);
  });

  it('rejects extra/missing fields in JSON', () => {
    const raw = Buffer.from(JSON.stringify({ createdAt: AT.toISOString(), id: ID, evil: 1 })).toString(
      'base64url',
    );
    expect(() => decodeLedgerCursor(raw)).toThrow(ValidationError);
  });
});
