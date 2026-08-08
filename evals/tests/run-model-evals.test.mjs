import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');
const RUNNER = path.join(REPOSITORY_ROOT, 'scripts/evals/run-model-evals.mjs');

function runWithoutProvider(extraArguments = []) {
  const environment = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  return spawnSync(process.execPath, [RUNNER, '--suite', 'programmable-v4-hook-builder', ...extraArguments], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: 'utf8',
  });
}

test('missing provider key emits an explicit non-green skip with no artifact', () => {
  const result = runWithoutProvider();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'MODEL_EVALS_SKIPPED',
    suiteId: 'programmable-v4-hook-builder',
    reason: 'ANTHROPIC_API_KEY is not configured',
    offlineStructure: 'valid',
    modelQuality: 'not-evaluated',
    resultArtifact: null,
    releaseGateSatisfied: false,
  });
});

test('release mode fails when provider-backed model quality was not evaluated', () => {
  const result = runWithoutProvider(['--require-provider']);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'MODEL_EVALS_SKIPPED');
  assert.equal(payload.releaseGateSatisfied, false);
  assert.equal(payload.resultArtifact, null);
});
