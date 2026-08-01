#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  classifyPublicIntakePullRequest,
  fetchPublicApplicationCandidate,
  hydratePublicApplicationCandidate,
  MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS,
  PublicIntakeError,
  verifyMaintainedSubmissions,
  verifyPublicHookApplication
} from "./verify-public-hook-application-core.mjs";

const usage = `Usage:
  verify-public-hook-application.mjs --classify --base-root <path> --candidate-root <path> --expected-base-commit <sha> --expected-candidate-commit <sha> --expected-merge-commit <sha>
  verify-public-hook-application.mjs --pull-request-number <number> --base-root <path> --candidate-root <path> --expected-base-commit <sha> --expected-candidate-commit <sha> --expected-merge-commit <sha> --expected-builder-login <login> --expected-builder-user-id <decimal-id>
  verify-public-hook-application.mjs --fetch-candidate --repository <owner/repository> --pull-request-number <number> --base-root <path> --candidate-root <path> --expected-base-commit <sha> --expected-candidate-commit <sha> --expected-merge-commit <sha>
  verify-public-hook-application.mjs --hydrate-candidate --repository <owner/repository> --pull-request-number <number> --base-root <path> --candidate-root <path> --expected-base-commit <sha> --expected-candidate-commit <sha> --expected-merge-commit <sha>
  verify-public-hook-application.mjs --verify-maintained --repository-root <path>

Inspect one pull request with trusted base code. Candidate Git objects are treated only as data.

Options:
  --classify                    Print application, builder-maintenance, or no-op without network access
  --fetch-candidate             Fetch the exact base-repository PR merge into bounded blobless storage
  --hydrate-candidate           Preflight sizes and hydrate only the closed six-file candidate package
  --repository <owner/name>     Authenticated central GitHub repository for candidate tree metadata
  --pull-request-number <n>     Exact central pull-request number for fetch, hydration, and final application verification
  --verify-maintained           Inspect all closed applications and validate bounded legacy packages
  --repository-root <path>      Trusted post-merge repository root for maintained verification
  --base-root <path>            Trusted base-revision checkout
  --candidate-root <path>       GitHub PR merge checkout treated as untrusted data
  --expected-base-commit <sha>  Exact lowercase base commit supplied by GitHub
  --expected-candidate-commit <sha> Exact lowercase head commit supplied by GitHub
  --expected-merge-commit <sha> Exact lowercase PR merge commit supplied by GitHub
  --expected-builder-login <login> Authenticated pull-request author; required for application verification
  --expected-builder-user-id <decimal-id> Immutable authenticated pull-request author id; required for application verification
  --help                        Show this help
`;

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  emitFailure(error);
  process.exitCode = 2;
  options = null;
}

if (options?.help) {
  process.stdout.write(usage);
} else if (options) {
  try {
    if (options.verifyMaintained) {
      const report = await verifyMaintainedSubmissions({
        repositoryRoot: options.repositoryRoot,
        validateLegacyPackage: runLegacyPackageValidator
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else if (options.fetchCandidate) {
      const report = await fetchPublicApplicationCandidate({
        baseRoot: options.baseRoot,
        candidateRoot: options.candidateRoot,
        repository: options.repository,
        pullRequestNumber: options.pullRequestNumber,
        expectedBaseCommit: options.expectedBaseCommit,
        expectedCandidateCommit: options.expectedCandidateCommit,
        expectedMergeCommit: options.expectedMergeCommit,
        readToken: process.env.CANDIDATE_READ_TOKEN
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else if (options.hydrateCandidate) {
      const report = await hydratePublicApplicationCandidate({
        baseRoot: options.baseRoot,
        candidateRoot: options.candidateRoot,
        expectedBaseCommit: options.expectedBaseCommit,
        expectedCandidateCommit: options.expectedCandidateCommit,
        expectedMergeCommit: options.expectedMergeCommit,
        pullRequestNumber: options.pullRequestNumber,
        repository: options.repository,
        readToken: process.env.CANDIDATE_READ_TOKEN
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      const input = {
        baseRoot: options.baseRoot,
        candidateRoot: options.candidateRoot,
        expectedBaseCommit: options.expectedBaseCommit,
        pullRequestNumber: options.pullRequestNumber,
        expectedBuilderLogin: options.expectedBuilderLogin,
        expectedBuilderUserId: options.expectedBuilderUserId,
        expectedCandidateCommit: options.expectedCandidateCommit,
        expectedMergeCommit: options.expectedMergeCommit
      };
      if (options.classify) {
        const result = classifyPublicIntakePullRequest(input);
        process.stdout.write(`${result.mode}\n`);
      } else {
        const report = await verifyPublicHookApplication(input);
        process.stdout.write(`${JSON.stringify(report)}\n`);
      }
    }
  } catch (error) {
    emitFailure(error);
    process.exitCode = error instanceof PublicIntakeError && error.kind === "candidate" ? 1 : 2;
  }
}

function parseArguments(args) {
  const parsed = {
    classify: false,
    fetchCandidate: false,
    hydrateCandidate: false,
    verifyMaintained: false,
    help: false,
    repositoryRoot: null,
    repository: null,
    pullRequestNumber: null,
    baseRoot: null,
    candidateRoot: null,
    expectedBaseCommit: null,
    expectedBuilderLogin: null,
    expectedBuilderUserId: null,
    expectedCandidateCommit: null,
    expectedMergeCommit: null
  };
  const valueOptions = new Map([
    ["--repository-root", "repositoryRoot"],
    ["--repository", "repository"],
    ["--pull-request-number", "pullRequestNumber"],
    ["--base-root", "baseRoot"],
    ["--candidate-root", "candidateRoot"],
    ["--expected-base-commit", "expectedBaseCommit"],
    ["--expected-builder-login", "expectedBuilderLogin"],
    ["--expected-builder-user-id", "expectedBuilderUserId"],
    ["--expected-candidate-commit", "expectedCandidateCommit"],
    ["--expected-merge-commit", "expectedMergeCommit"]
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (argument === "--classify") {
      parsed.classify = true;
      continue;
    }
    if (argument === "--fetch-candidate") {
      parsed.fetchCandidate = true;
      continue;
    }
    if (argument === "--hydrate-candidate") {
      parsed.hydrateCandidate = true;
      continue;
    }
    if (argument === "--verify-maintained") {
      parsed.verifyMaintained = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "The trusted validator received an unsupported CLI argument.", { kind: "system" });
    if (parsed[key] !== null) throw new PublicIntakeError("CLI_ARGUMENT_DUPLICATE", "A trusted validator CLI option was repeated.", { kind: "system" });
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new PublicIntakeError("CLI_VALUE_MISSING", "A trusted validator CLI option is missing its value.", { kind: "system" });
    parsed[key] = value;
    index += 1;
  }
  if (!parsed.help) {
    if ([parsed.classify, parsed.fetchCandidate, parsed.hydrateCandidate, parsed.verifyMaintained].filter(Boolean).length > 1) {
      throw new PublicIntakeError("CLI_MODE_INVALID", "Trusted validator modes cannot be combined.", { kind: "system" });
    }
    if (parsed.verifyMaintained) {
      if (parsed.repositoryRoot === null) {
        throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "Maintained verification requires the trusted repository root.", { kind: "system" });
      }
      for (const key of ["repository", "pullRequestNumber", "baseRoot", "candidateRoot", "expectedBaseCommit", "expectedBuilderLogin", "expectedBuilderUserId", "expectedCandidateCommit", "expectedMergeCommit"]) {
        if (parsed[key] !== null) {
          throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "Pull-request options cannot be combined with maintained verification.", { kind: "system" });
        }
      }
    } else if (parsed.fetchCandidate) {
      for (const key of ["repository", "pullRequestNumber", "baseRoot", "candidateRoot", "expectedBaseCommit", "expectedCandidateCommit", "expectedMergeCommit"]) {
        if (parsed[key] === null) throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "Candidate fetch is missing a required trusted option.", { kind: "system" });
      }
      for (const key of ["repositoryRoot", "expectedBuilderLogin", "expectedBuilderUserId"]) {
        if (parsed[key] !== null) throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "Candidate fetch received an unrelated validator option.", { kind: "system" });
      }
    } else {
      if (parsed.repositoryRoot !== null) {
        throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "--repository-root is available only for maintained verification.", { kind: "system" });
      }
      for (const key of ["baseRoot", "candidateRoot", "expectedBaseCommit", "expectedCandidateCommit", "expectedMergeCommit"]) {
        if (parsed[key] === null) throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "The trusted validator is missing a required CLI option.", { kind: "system" });
      }
      if (parsed.classify && parsed.pullRequestNumber !== null) {
        throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "Classification does not accept a pull-request number.", { kind: "system" });
      }
      if (!parsed.classify && parsed.pullRequestNumber === null) {
        throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "Hydration and application verification require the exact pull-request number.", { kind: "system" });
      }
      if (parsed.hydrateCandidate && parsed.repository === null) {
        throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "Candidate hydration requires the central GitHub repository identity.", { kind: "system" });
      }
      if (!parsed.hydrateCandidate && parsed.repository !== null) {
        throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "--repository is available only for candidate hydration.", { kind: "system" });
      }
      if (parsed.hydrateCandidate && (parsed.expectedBuilderLogin !== null || parsed.expectedBuilderUserId !== null)) {
        throw new PublicIntakeError("CLI_ARGUMENT_INVALID", "Candidate hydration does not accept a builder identity.", { kind: "system" });
      }
      if (
        !parsed.classify
        && !parsed.hydrateCandidate
        && (parsed.expectedBuilderLogin === null || parsed.expectedBuilderUserId === null)
      ) {
        throw new PublicIntakeError("CLI_ARGUMENT_MISSING", "Application verification requires the authenticated pull-request author login and immutable user id.", { kind: "system" });
      }
    }
  }
  return parsed;
}

function runLegacyPackageValidator({ repositoryRoot, packageName, packageRoot }) {
  const validator = path.join(
    repositoryRoot,
    "skills",
    "programmable-v4-hook-builder",
    "scripts",
    "verify-package.mjs"
  );
  let validatorStatus;
  try {
    validatorStatus = fs.lstatSync(validator);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new PublicIntakeError(
        "MAINTAINED_LEGACY_VALIDATOR_UNAVAILABLE",
        "The trusted revision does not contain the legacy-package validator.",
        { kind: "system" }
      );
    }
    throw error;
  }
  if (validatorStatus.isSymbolicLink() || !validatorStatus.isFile()) {
    throw new PublicIntakeError(
      "MAINTAINED_LEGACY_VALIDATOR_UNAVAILABLE",
      "The trusted legacy-package validator must be a regular file.",
      { kind: "system" }
    );
  }

  process.stderr.write(`Validating maintained legacy package ${packageName}.\n`);
  const result = childProcess.spawnSync(
    process.execPath,
    [validator, "--repository-root", repositoryRoot, packageRoot],
    {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "inherit", "inherit"],
      timeout: MAINTAINED_LEGACY_PACKAGE_TIMEOUT_MS,
      killSignal: "SIGKILL"
    }
  );
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT";
    throw new PublicIntakeError(
      timedOut ? "MAINTAINED_LEGACY_VALIDATION_TIMEOUT" : "MAINTAINED_LEGACY_VALIDATION_FAILED",
      timedOut
        ? `Legacy package ${packageName} exceeded its trusted validation timeout.`
        : `Legacy package ${packageName} could not be validated.`,
      { kind: "system" }
    );
  }
  if (result.status !== 0) {
    throw new PublicIntakeError(
      "MAINTAINED_LEGACY_PACKAGE_INVALID",
      `Legacy package ${packageName} failed trusted package validation.`,
      { kind: "system" }
    );
  }
}

function emitFailure(error) {
  const known = error instanceof PublicIntakeError;
  const payload = {
    schemaVersion: 1,
    result: known && error.kind === "candidate" ? "invalid-public-application-package" : "system-blocked",
    code: known ? error.code : "UNEXPECTED_VALIDATOR_FAILURE",
    message: known ? error.message : "The trusted validator failed unexpectedly."
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
