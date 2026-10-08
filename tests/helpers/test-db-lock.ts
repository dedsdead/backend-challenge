import { Client } from 'pg';

let lockClient: Client | null = null;
const TEST_LOCK_ID = 0x77616765; // 'wage' in hex

export async function acquireTestLock(): Promise<void> {
  if (lockClient) return;
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:local@localhost:5432/wagering';
  lockClient = new Client({ connectionString: databaseUrl });
  await lockClient.connect();
  await lockClient.query('SELECT pg_advisory_lock($1)', [TEST_LOCK_ID]);
}

export async function releaseTestLock(): Promise<void> {
  if (!lockClient) return;
  try {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [TEST_LOCK_ID]);
  } finally {
    await lockClient.end();
    lockClient = null;
  }
}

export function isLockAcquired(): boolean {
  return lockClient !== null;
}