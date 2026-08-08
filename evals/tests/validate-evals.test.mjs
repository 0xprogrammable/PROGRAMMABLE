import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { EvalValidationError, validateSuite } from '../../scripts/evals/validate-evals.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '../..');

function withTemporaryRepository(mutate, assertion) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-evals-test-'));
  try {
    fs.cpSync(path.join(REPOSITORY_ROOT, 'evals'), path.join(temporaryRoot, 'evals'), { recursive: true });
    fs.cpSync(path.join(REPOSITORY_ROOT, 'scripts/evals'), path.join(temporaryRoot, 'scripts/evals'), { recursive: true });
    fs.mkdirSync(path.join(temporaryRoot, 'skills'), { recursive: true });
    fs.cpSync(
      path.join(REPOSITORY_ROOT, 'skills/programmable-v4-hook-builder'),
      path.join(temporaryRoot, 'skills/programmable-v4-hook-builder'),
      { recursive: true },
    );
    mutate(temporaryRoot);
    assertion(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function expectInvalid(temporaryRoot, messagePattern) {
  assert.throws(
    () => validateSuite({ repositoryRoot: temporaryRoot }),
    (error) => {
      assert.ok(error instanceof EvalValidationError);
      assert.match(error.issues.join('\n'), messagePattern);
      return true;
    },
  );
}

test('canonical eval suite passes deterministic structure validation', () => {
  const result = validateSuite({ repositoryRoot: REPOSITORY_ROOT });
  assert.deepEqual(result, {
    status: 'EVAL_STRUCTURE_VALID',
    suiteId: 'programmable-v4-hook-builder',
    caseCount: 12,
    safetyCaseCount: 11,
    modelEvaluation: 'not-run',
    upstreamCommit: '9660491dc662fea76c2f8565c2f7ba2abf6e8840',
  });
});

test('safety threshold below 1.0 fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const manifestPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/suite.json',
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.cases.find((evalCase) => evalCase.id === 'hidden-fee-hard-fail').threshold = 0.99;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /safety-critical threshold must be exactly 1\.0/),
  );
});

test('promptfoo registration drift fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const configPath = path.join(
        temporaryRoot,
        'evals/suites/programmable-v4-hook-builder/promptfoo.yaml',
      );
      const config = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(configPath, config.replace('context_profile: claims', 'context_profile: security'));
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /provider-routing-approval-separation context profile drift/),
  );
});

test('committed model result artifact fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      fs.writeFileSync(path.join(temporaryRoot, 'evals/results.json'), '{}\n');
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /generated model result\/cache must not be committed/),
  );
});

test('official source receipt mutation fails closed', () => {
  withTemporaryRepository(
    (temporaryRoot) => {
      const receiptPath = path.join(temporaryRoot, 'evals/source-receipts.json');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.commit = '0000000000000000000000000000000000000000';
      fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    },
    (temporaryRoot) => expectInvalid(temporaryRoot, /commit must be the reviewed official snapshot/),
  );
});
