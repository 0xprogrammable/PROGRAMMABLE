#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  SOURCE_MANIFEST_CLI_SCHEMA_ID,
  SOURCE_MANIFEST_CLI_VERSION,
  SOURCE_MANIFEST_EXIT,
  SourceManifestError,
  normalizeError,
  parseSourceManifestCliArgs,
  publicRecord,
  sourceManifestHelp
} from "./source-manifest-shared.mjs";
import { generateSourceClosureManifestV1 } from "./source-manifest-plan.mjs";
import { materializeSourceClosureManifestV1 } from "./source-manifest-materialization.mjs";

export {
  SOURCE_MANIFEST_CLI_SCHEMA_ID,
  SOURCE_MANIFEST_CLI_VERSION,
  SOURCE_MANIFEST_EXIT,
  SourceManifestError,
  generateSourceClosureManifestV1,
  materializeSourceClosureManifestV1,
  parseSourceManifestCliArgs,
  sourceManifestHelp
};

export function runSourceManifestCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  fsApi = fs,
  gitRunner = spawnSafeRawGitSync,
  limits = {}
} = {}) {
  try {
    const options = parseSourceManifestCliArgs(argv);
    if (options.action === "help") {
      stdout.write(sourceManifestHelp());
      return SOURCE_MANIFEST_EXIT.READY;
    }
    if (options.action === "version") {
      stdout.write(`${SOURCE_MANIFEST_CLI_VERSION}\n`);
      return SOURCE_MANIFEST_EXIT.READY;
    }
    const plan = generateSourceClosureManifestV1({
      ...options,
      cwd,
      fsApi,
      gitRunner,
      limits
    });
    const materialization = options.write
      ? materializeSourceClosureManifestV1(plan, { fsApi, gitRunner, limits })
      : {
          writePerformed: false,
          directory: plan.output.repositoryPath,
          atomicDirectoryRename: false,
          overwritten: false,
          fileCount: plan.records.length
        };
    stdout.write(`${canonicalJson(successEnvelope(plan, materialization))}\n`);
    return SOURCE_MANIFEST_EXIT.READY;
  } catch (error) {
    const failure = normalizeError(error);
    const splitReviewRequired = failure.code === "SOURCE_MANIFEST_RESOURCE_LIMIT";
    const integrationPending = [
      "SOURCE_GIT_OBJECTS_UNAVAILABLE",
      "SOURCE_GIT_OBJECT_FORMAT_UNSUPPORTED",
      "SOURCE_PATH_UTF8_INVALID",
      "SOURCE_PATH_NONPORTABLE"
    ].includes(failure.code);
    stdout.write(`${canonicalJson({
      schemaId: SOURCE_MANIFEST_CLI_SCHEMA_ID,
      schemaVersion: "1.0.0",
      ok: false,
      status: integrationPending
        ? "INTEGRATION_PENDING"
        : splitReviewRequired
          ? "HOLD_SPLIT_REVIEW"
          : failure.exitCode === SOURCE_MANIFEST_EXIT.HELD
            ? "HELD"
            : "INVALID",
      ...(splitReviewRequired || integrationPending ? {
        ideaEligibility: "ELIGIBLE_FOR_REVIEW",
        ...(splitReviewRequired ? { splitReviewRequired: true } : {})
      } : {}),
      error: {
        code: failure.code,
        message: failure.message,
        ...(splitReviewRequired ? { classification: "tooling-split-review" } : {}),
        ...(integrationPending ? { classification: "tooling-transport" } : {}),
        ...(failure.details === null ? {} : { details: failure.details })
      },
      writePerformed: false,
      networkAccessed: false,
      candidateCodeExecuted: false
    })}\n`);
    return failure.exitCode;
  }
}

function successEnvelope(plan, materialization) {
  return {
    schemaId: SOURCE_MANIFEST_CLI_SCHEMA_ID,
    schemaVersion: "1.0.0",
    ok: true,
    status: materialization.writePerformed ? "WRITTEN_UNCOMMITTED_METADATA" : "READY_TO_WRITE",
    dryRun: !materialization.writePerformed,
    writePerformed: materialization.writePerformed,
    sourceSnapshot: plan.sourceSnapshot,
    repository: plan.repository,
    dependencyPointers: plan.dependencyPointers,
    output: {
      directory: plan.output.repositoryPath,
      atomicDirectoryRename: materialization.atomicDirectoryRename,
      overwritten: false,
      files: plan.records.map(publicRecord),
      rootManifest: plan.manifestBindingTemplate,
      deterministicPlanSha256: plan.deterministicPlanSha256
    },
    stats: plan.stats,
    safety: plan.safety,
    authorization: {
      approvalGranted: false,
      launchAuthorizationGranted: false,
      submissionPerformed: false
    },
    nextSteps: [
      "Review the generated metadata and keep every bound source blob unchanged.",
      "Commit the new metadata directory in the source repository.",
      "Bind that new commit, its tree, and the exact root-manifest blob in Application V3.",
      "Run the local raw-Git source-closure verifier at the exact post-metadata commit."
    ]
  };
}

const isEntrypoint = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) process.exitCode = runSourceManifestCli();
