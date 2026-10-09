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

  it('excludes Idempotency-Key from business hash', () => {
    const base = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: 'ref-1',
    };
    // Simulating businessHash which excludes idempotencyKey
    const hash1 = payloadHash({ ...base });
    const hash2 = payloadHash({ ...base, idempotencyKey: 'different-key' });
    expect(hash1).toBe(hash2);
  });

  it('excludes ingress and other non-business fields from business hash', () => {
    const base = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: 'ref-1',
    };
    // Simulating businessHash which excludes ingress
    const hash1 = payloadHash({ ...base });
    const hash2 = payloadHash({ ...base, ingress: { kind: 'http' } });
    const hash3 = payloadHash({ ...base, ingress: { kind: 'sqs', messageId: 'msg-1', consumerName: 'c' } });
    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
  });

  it('AC-6: hash divergence when same idempotency key but different payload', () => {
    const payload1 = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: 'ref-1',
    };
    const payload2 = {
      ...payload1,
      amount: '50.00', // different amount
    };
    expect(payloadHash(payload1)).not.toBe(payloadHash(payload2));
  });

  it('hash is stable for key-order permutations at all nesting levels', () => {
    const payload1 = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: 'ref-1',
    };
    const payload2 = {
      currency: 'BRL',
      amount: '25.00',
      kind: 'BET',
      gameId: 'g-1',
      roundId: 'r-1',
      playerId: 'player-1',
      walletId: 'w-1',
      externalTransactionId: 'tx-1',
      providerId: 'p',
      referenceExternalTransactionId: 'ref-1',
    };
    expect(payloadHash(payload1)).toBe(payloadHash(payload2));
  });

  it('handles undefined referenceExternalTransactionId gracefully', () => {
    const base = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: undefined,
    };
    const hash1 = payloadHash(base);
    const base2 = { ...base };
    delete base2.referenceExternalTransactionId;
    const hash2 = payloadHash(base2);
    expect(hash1).toBe(hash2);
  });

  it('treats null and missing referenceExternalTransactionId differently', () => {
    const withNull = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
      referenceExternalTransactionId: null,
    };
    const without = {
      providerId: 'p',
      externalTransactionId: 'tx-1',
      walletId: 'w-1',
      playerId: 'player-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET',
      amount: '25.00',
      currency: 'BRL',
    };
    // Both should serialize to null and produce same hash
    // Actually canonicalize skips undefined but keeps null
    // Let's verify the behavior
    const hashWithNull = payloadHash(withNull);
    const hashWithout = payloadHash(without);
    // They should be different because null is serialized but undefined is skipped
    // This is the current behavior - both are valid but produce different hashes
    expect(hashWithNull).not.toBe(hashWithout);
  });
});
