#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import {
  DEEP_V3_MANIFEST_PATH,
  DEEP_V3_OPS_V2_SOURCE_PATHS,
  DEEP_V3_SCHEMA_PATH,
  assessDeepV3LiveManifest,
  computeDeepV3OpsV2SourceCommitment,
} from "./deep-full-range-release-v3-core.mjs";
import {
  DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH,
  buildDeepV3OpsV2Promotion,
} from "./deep-v3-ops-v2-promotion-core.mjs";
import { parseDeepV3KeeperV2Config } from "../../ops/deep-keeper-v3/config-v2.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const write = process.argv.includes("--write");
const manifestPath = path.join(root, DEEP_V3_MANIFEST_PATH);
const bindingPath = path.join(
  root,
  DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH,
);
const verifier =
  "contracts/scripts/verify-deep-full-range-release-v3-manifest.mjs";

function fail(message) {
  throw new Error(`Deep V3 ops v2 promotion failed: ${message}`);
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      String(result.stderr || result.stdout || args.join(" ")).trim(),
    );
  }
  return result.stdout;
}

function assertReviewedSourcesMatchCommit(commit) {
  for (const relativePath of DEEP_V3_OPS_V2_SOURCE_PATHS) {
    const committed = git(
      ["show", `${commit}:${relativePath}`],
      null,
    );
    const working = readFileSync(path.join(root, relativePath));
    if (!Buffer.from(committed).equals(working)) {
      fail(`${relativePath} differs from ${commit}`);
    }
  }
}

async function writeExclusive(file, contents) {
  const handle = await open(file, "wx", 0o644);
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
}

async function atomicReplace(file, contents) {
  const temporary = `${file}.promotion-${process.pid}`;
  await writeExclusive(temporary, contents);
  await rename(temporary, file);
}

function runVerifier(relativeCandidate) {
  const result = spawnSync(
    process.execPath,
    [
      verifier,
      "--require-live",
      "--manifest-file",
      relativeCandidate,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    fail("the candidate did not pass the live release verifier");
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const head = String(git(["rev-parse", "HEAD"])).trim().toLowerCase();
if (manifest.releaseCommit !== head) {
  fail("the contract release commit is not the checked-out commit");
}
assertReviewedSourcesMatchCommit(head);

const opsSourceCommitment =
  computeDeepV3OpsV2SourceCommitment(root);
const buildSourceBinding = JSON.parse(
  await readFile(
    path.join(
      root,
      "ops/deep-keeper-v3/ops-v2-source-binding.json",
    ),
    "utf8",
  ),
);
if (
  buildSourceBinding?.schemaVersion !== 1 ||
  buildSourceBinding.keeperReleaseVersion !==
    "deep-keeper-v3-ops-v2" ||
  buildSourceBinding.opsSourceCommitment !==
    opsSourceCommitment
) {
  fail("the checked-in build source binding is stale");
}
const config = parseDeepV3KeeperV2Config({
  ...process.env,
  DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT:
    opsSourceCommitment,
});
const promotion = buildDeepV3OpsV2Promotion({
  manifest,
  config,
  root,
});
const schema = JSON.parse(
  await readFile(path.join(root, DEEP_V3_SCHEMA_PATH), "utf8"),
);
const validate = new Ajv({
  allErrors: true,
  strict: false,
}).compile(schema);
if (!validate(promotion.manifest)) {
  fail(`candidate schema errors: ${JSON.stringify(validate.errors)}`);
}
const assessment = assessDeepV3LiveManifest(
  promotion.manifest,
  root,
);
if (!assessment.ready) {
  fail(`candidate readiness: ${assessment.reasons.join(", ")}`);
}

const currentBinding = JSON.parse(
  await readFile(bindingPath, "utf8"),
);
if (
  currentBinding.status !== "pending-deployment" &&
  JSON.stringify(currentBinding) !==
    JSON.stringify(promotion.binding)
) {
  fail("an existing reviewed binding differs from this promotion");
}

if (!write) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        write: false,
        releaseCommit: head,
        opsSourceCommitment,
        signerAddress: promotion.binding.signerAddress,
        manifestPath: DEEP_V3_MANIFEST_PATH,
        bindingPath: DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH,
      },
      null,
      2,
    ),
  );
  console.error(
    "Dry run only. --write requires explicit release authority and performs live read-only verification before local promotion.",
  );
  process.exit(0);
}

const candidateRelative =
  `contracts/deployments/.deep-v3-ops-v2-candidate-${process.pid}.json`;
const candidatePath = path.join(root, candidateRelative);
try {
  await writeExclusive(
    candidatePath,
    `${JSON.stringify(promotion.manifest, null, 2)}\n`,
  );
  runVerifier(candidateRelative);
  if (
    computeDeepV3OpsV2SourceCommitment(root) !==
    opsSourceCommitment
  ) {
    fail("reviewed ops sources changed during live verification");
  }
  assertReviewedSourcesMatchCommit(head);

  await atomicReplace(
    bindingPath,
    `${JSON.stringify(promotion.binding, null, 2)}\n`,
  );
  await atomicReplace(
    manifestPath,
    `${JSON.stringify(promotion.manifest, null, 2)}\n`,
  );
} finally {
  await rm(candidatePath, { force: true });
}

console.log(
  `Promoted ${DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH} and ${DEEP_V3_MANIFEST_PATH}`,
);
console.log(
  "No deployment or transaction was submitted by this promotion.",
);
