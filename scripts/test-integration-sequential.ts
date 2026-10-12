#!/usr/bin/env bun
/**
 * Sequential integration test runner
 * Runs each integration test file individually to avoid PostgreSQL advisory lock contention
 */

const testFiles = [
  'bootstrap.spec.ts',
  'auth-observability.spec.ts',
  'metrics.spec.ts',
  'repositories.spec.ts',
  'schema.spec.ts',
  'submit-transaction.use-case.spec.ts',
  'wallets.service.spec.ts',
  'workers.spec.ts',
  'outbox-publisher.worker.spec.ts',
  'pending-reference.worker.spec.ts',
  'wallets.http.spec.ts',
  'wagering.http.spec.ts',
  'http-api.spec.ts',
  'crash-recovery.spec.ts',
  'entities/inbox-outbox.entity.spec.ts',
  'entities/wager-transaction.entity.spec.ts',
  'entities/wallet-ledger-entry.entity.spec.ts',
  'entities/wallet.entity.spec.ts',
];

async function runTests(): Promise<void> {
  let allPassed = true;
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('Running integration tests SEQUENTIALLY');
  console.log('='.repeat(60));
  console.log(`Total test files: ${testFiles.length}`);
  console.log();

  for (const file of testFiles) {
    const fileStart = Date.now();
    console.log(`\n--- Running: ${file} ---`);

    const proc = Bun.spawn(['bun', 'test', `tests/integration/${file}`], {
      stdout: 'inherit',
      stderr: 'inherit',
    });

    const exitCode = await proc.exited;
    const duration = Date.now() - fileStart;

    if (exitCode === 0) {
      console.log(`✓ ${file} passed (${duration}ms)`);
    } else {
      console.log(`✗ ${file} FAILED (${duration}ms)`);
      allPassed = false;
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log();
  console.log('='.repeat(60));
  console.log(`Total time: ${totalDuration}ms`);
  console.log(allPassed ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗');
  console.log('='.repeat(60));

  if (!allPassed) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});