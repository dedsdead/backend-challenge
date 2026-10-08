import { ValidationError } from '../../domain/errors';
import type { LedgerCursor } from '../../database/repositories/interfaces';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FIELDS = ['createdAt', 'id'];

function fail(): never {
  throw new ValidationError('Invalid ledger cursor');
}

export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeLedgerCursor(raw: string): LedgerCursor {
  if (typeof raw !== 'string' || raw.length === 0) fail();
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail();
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== FIELDS.length || keys[0] !== FIELDS[0] || keys[1] !== FIELDS[1]) return fail();
  const { createdAt, id } = record;
  if (typeof createdAt !== 'string' || !ISO_Z_RE.test(createdAt)) return fail();
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return fail();
  if (typeof id !== 'string' || !UUID_RE.test(id)) return fail();
  return { createdAt: date, id };
}
