#!/usr/bin/env node

import process from "node:process";
import {
  createGhTransport,
  executeGitHubApplication,
  GITHUB_APPLICATION_CLIENT_VERSION,
  GitHubApplicationError,
  loadPreparedApplication,
  planGitHubApplication,
  readGitHubApplicationStatus,
  writeLocalReceipt
} from "./github-application-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

const HELP = `Usage:
  node github-application.mjs submit --prepared <prepare-pr.json> --repository-root <path> [options]
  node github-application.mjs update --prepared <prepare-pr.json> --repository-root <path> --pull-request <number> [options]
  node github-application.mjs status --prepared <prepare-pr.json> --repository-root <path> [--pull-request <number>] [options]

Read-only by default. submit and update emit an immutable action plan and perform no write unless the exact plan digest
is supplied with --confirm-external-write. The confirmed action can create a fork, branch commit, push-equivalent Git
ref, and draft pull request. It never approves, merges, marks ready, deploys, launches, or creates a W2 application.

Options:
  --prepared <file>                    Canonical prepare-pr JSON result stored outside the source repository.
  --repository-root <path>             Exact builder source repository root; used for local path isolation.
  --pull-request <number>              Exact existing application pull request. Required for update.
  --confirm-external-write <sha256:…>  Execute only the byte-exact current action plan.
  --write-receipt <directory>          After status or execution, write one bounded local receipt outside the source repo.
  -h, --help                           Show this help message.
`;

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const { command, options } = parseArguments(argv);
  const prepared = loadPreparedApplication(options.prepared, {
    sourceRepositoryRoot: options.repositoryRoot
  });
  const transport = createGhTransport();
  let result;
  if (command === "status") {
    if (options.confirmExternalWrite !== null) usage("status does not accept --confirm-external-write");
    result = await readGitHubApplicationStatus({
      prepared,
      transport,
      pullRequestNumber: options.pullRequest
    });
  } else if (options.confirmExternalWrite === null) {
    result = await planGitHubApplication({
      operation: command,
      prepared,
      transport,
      pullRequestNumber: options.pullRequest
    });
  } else {
    result = await executeGitHubApplication({
      operation: command,
      prepared,
      transport,
      confirmationDigest: options.confirmExternalWrite,
      pullRequestNumber: options.pullRequest
    });
  }

  let receipt = null;
  if (options.writeReceipt !== null) {
    const status = command === "status" ? result : result.status;
    if (!status?.pullRequestNumber) {
      usage("--write-receipt requires a completed status read or confirmed external action");
    }
    receipt = writeLocalReceipt({
      receiptDirectory: options.writeReceipt,
      sourceRepositoryRoot: options.repositoryRoot,
      receipt: {
        applicationId: prepared.applicationId,
        applicationRevision: prepared.applicationRevision,
        pullRequestNumber: status.pullRequestNumber,
        pullRequestUrl: status.pullRequestUrl,
        githubStatus: status.status,
        applicationResult: status.applicationResult,
        headCommit: status.headCommit,
        packageMatchesPrepared: status.packageMatchesPrepared,
        preparedPackageDigest: prepared.package.digest,
        confirmationDigest: command === "status" ? null : result.confirmationDigest ?? null,
        externalActionsPerformed: command === "status" ? [] : result.externalActionsPerformed ?? []
      }
    });
  }

  process.stdout.write(`${canonicalJson({
    schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
    command,
    ok: true,
    result,
    receipt
  })}\n`);
  return 0;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) usage("missing command");
  const command = argv[0];
  if (!new Set(["submit", "update", "status"]).has(command)) usage(`unknown command ${command}`);
  const definitions = new Map([
    ["--prepared", "prepared"],
    ["--repository-root", "repositoryRoot"],
    ["--pull-request", "pullRequest"],
    ["--confirm-external-write", "confirmExternalWrite"],
    ["--write-receipt", "writeReceipt"]
  ]);
  const options = {
    prepared: null,
    repositoryRoot: null,
    pullRequest: null,
    confirmExternalWrite: null,
    writeReceipt: null
  };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    const key = definitions.get(name);
    if (key === undefined) usage(`unknown option ${name}`);
    if (seen.has(name)) usage(`option ${name} may only be used once`);
    seen.add(name);
    let value = separator === -1 ? argv[index + 1] : token.slice(separator + 1);
    if (separator === -1) index += 1;
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      usage(`option ${name} requires a value`);
    }
    options[key] = value;
  }
  if (options.prepared === null) usage("missing --prepared");
  if (options.repositoryRoot === null) usage("missing --repository-root");
  if (command === "update" && options.pullRequest === null) usage("update requires --pull-request");
  return { command, options };
}

function usage(message) {
  throw new GitHubApplicationError("USAGE_ERROR", message, { exitCode: 2 });
}

function safeFailure(error) {
  if (error instanceof GitHubApplicationError) return error;
  return new GitHubApplicationError("INTERNAL_ERROR", "the GitHub application client failed without a safe diagnostic", {
    exitCode: 2
  });
}

main().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    const failure = safeFailure(error);
    const payload = {
      schemaVersion: GITHUB_APPLICATION_CLIENT_VERSION,
      command: process.argv[2] ?? null,
      ok: false,
      error: {
        code: failure.code,
        message: failure.message
      }
    };
    if (failure.details !== null) payload.error.details = failure.details;
    process.stdout.write(`${canonicalJson(payload)}\n`);
    process.exitCode = failure.exitCode;
  }
);
