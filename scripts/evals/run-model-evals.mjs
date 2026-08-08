#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { EvalValidationError, validateSuite } from './validate-evals.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const DEFAULT_SUITE = 'programmable-v4-hook-builder';
const EXPECTED_PROMPTFOO_VERSION = '0.121.11';

process.umask(0o077);

function parseArguments(argv) {
  const options = {
    suiteId: DEFAULT_SUITE,
    requireProvider: false,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--suite') {
      options.suiteId = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--suite=')) {
      options.suiteId = argument.slice('--suite='.length);
    } else if (argument === '--require-provider') {
      options.requireProvider = true;
    } else if (argument === '--output') {
      options.output = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--output=')) {
      options.output = argument.slice('--output='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function emit(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function fail(message, details = {}) {
  emit({ status: 'MODEL_EVALS_ERROR', message, ...details }, process.stderr);
  process.exitCode = 2;
}

function hasProviderCredential() {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

function resolveOutputPath(requestedOutput, suiteId) {
  if (requestedOutput) {
    const outputPath = path.resolve(requestedOutput);
    const relativeToRepository = path.relative(REPOSITORY_ROOT, outputPath);
    if (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository)) {
      throw new Error('result output must be outside the repository worktree');
    }
    return outputPath;
  }
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'programmable-hook-evals-'));
  fs.chmodSync(outputDirectory, 0o700);
  return path.join(outputDirectory, `${suiteId}-${Date.now()}.results.json`);
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
  validateSuite({ repositoryRoot: REPOSITORY_ROOT, suiteId: options.suiteId });
} catch (error) {
  if (error instanceof EvalValidationError) {
    fail('offline-structure-validation-failed', { issues: error.issues });
  } else {
    fail(error.message);
  }
}

if (!process.exitCode && !hasProviderCredential()) {
  emit({
    status: 'MODEL_EVALS_SKIPPED',
    suiteId: options.suiteId,
    reason: 'ANTHROPIC_API_KEY is not configured',
    offlineStructure: 'valid',
    modelQuality: 'not-evaluated',
    resultArtifact: null,
    releaseGateSatisfied: false,
  });
  if (options.requireProvider) process.exitCode = 3;
}

if (!process.exitCode && hasProviderCredential()) {
  const promptfooBinary = path.join(REPOSITORY_ROOT, 'node_modules/.bin/promptfoo');
  const promptfooPackage = path.join(REPOSITORY_ROOT, 'node_modules/promptfoo/package.json');
  if (!fs.existsSync(promptfooBinary)) {
    fail('local-promptfoo-installation-missing', {
      expectedPath: 'node_modules/.bin/promptfoo',
      networkInstallAttempted: false,
    });
  } else if (!fs.existsSync(promptfooPackage)) {
    fail('local-promptfoo-package-metadata-missing', {
      expectedPath: 'node_modules/promptfoo/package.json',
    });
  } else {
    let installedPromptfooVersion;
    try {
      installedPromptfooVersion = JSON.parse(fs.readFileSync(promptfooPackage, 'utf8')).version;
    } catch (error) {
      fail('local-promptfoo-package-metadata-invalid', { error: error.message });
    }

    if (process.exitCode) process.exit();
    if (installedPromptfooVersion !== EXPECTED_PROMPTFOO_VERSION) {
      fail('local-promptfoo-version-mismatch', {
        expectedVersion: EXPECTED_PROMPTFOO_VERSION,
        installedVersion: installedPromptfooVersion,
      });
    }

    if (process.exitCode) process.exit();
    let outputPath;
    try {
      outputPath = resolveOutputPath(options.output, options.suiteId);
    } catch (error) {
      fail(error.message);
    }

    if (process.exitCode) process.exit();
    const outputParent = path.dirname(outputPath);
    fs.mkdirSync(outputParent, { recursive: true, mode: 0o700 });

    const configPath = `suites/${options.suiteId}/promptfoo.yaml`;
    const child = spawnSync(
      promptfooBinary,
      ['eval', '-c', configPath, '--output', outputPath, '--no-progress-bar'],
      {
        cwd: path.join(REPOSITORY_ROOT, 'evals'),
        env: {
          ...process.env,
          PROMPTFOO_DISABLE_TELEMETRY: '1',
          PROMPTFOO_CACHE_ENABLED: 'false',
        },
        stdio: 'inherit',
      },
    );

    if (child.error) {
      fail('promptfoo-process-failed-to-start', { error: child.error.message });
    } else if (child.status !== 0) {
      fail('model-evaluation-failed', { exitCode: child.status, resultArtifact: outputPath });
    } else if (!fs.existsSync(outputPath)) {
      fail('promptfoo-returned-success-without-result-artifact');
    } else {
      emit({
        status: 'MODEL_EVALS_COMPLETED',
        suiteId: options.suiteId,
        resultArtifact: outputPath,
        provider: 'anthropic:claude-sonnet-4-6',
        offlineStructure: 'valid',
        note: 'Promptfoo assertions passed; this is not approval, deployment, routing, or endorsement evidence.',
      });
    }
  }
}
