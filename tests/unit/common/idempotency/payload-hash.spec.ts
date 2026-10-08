import { describe, it, expect } from 'bun:test';
import { canonicalJson, payloadHash } from '../../../../src/common/idempotency/payload-hash';

describe('canonicalJson', () => {
  it('sorts top-level keys lexicographically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested keys recursively', () => {
    const value = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } };
    expect(canonicalJson(value)).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it('produces identical output regardless of insertion order', () => {
    const first = { providerId: 'p', money: { currency: 'BRL', amount: '10.00' }, kind: 'BET' };
    const second = { kind: 'BET', money: { amount: '10.00', currency: 'BRL' }, providerId: 'p' };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  it('preserves array element order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('escapes strings as JSON', () => {
    expect(canonicalJson({ a: 'x"y\n' })).toBe('{"a":"x\\"y\\n"}');
  });

  it('serializes null and nested null', () => {
    expect(canonicalJson({ a: null, b: { c: null } })).toBe('{"a":null,"b":{"c":null}}');
  });
});

describe('payloadHash', () => {
  it('returns a 64-char lowercase hex sha256', () => {
    const hash = payloadHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same payload', () => {
    const payload = {
      providerId: 'provider-a',
      externalTransactionId: 'tx-1',
      money: { amount: '25.00', currency: 'BRL' },
    };
    expect(payloadHash(payload)).toBe(payloadHash({ ...payload }));
  });

  it('is independent of key order at every level', () => {
    const a = { providerId: 'p', money: { currency: 'BRL', amount: '25.00' } };
    const b = { money: { amount: '25.00', currency: 'BRL' }, providerId: 'p' };
    expect(payloadHash(a)).toBe(payloadHash(b));
  });

  it('changes when any business value changes', () => {
    const base = { money: { amount: '25.00', currency: 'BRL' } };
    const changed = { money: { amount: '25.01', currency: 'BRL' } };
    expect(payloadHash(base)).not.toBe(payloadHash(changed));
  });

  it('changes when currency changes', () => {
    expect(payloadHash({ money: { amount: '25.00', currency: 'BRL' } })).not.toBe(
      payloadHash({ money: { amount: '25.00', currency: 'USD' } }),
    );
  });

  it('keeps array order significant in the hash', () => {
    expect(payloadHash({ ids: ['a', 'b'] })).not.toBe(payloadHash({ ids: ['b', 'a'] }));
  });
});
