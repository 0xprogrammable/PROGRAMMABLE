import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scripts = path.resolve(import.meta.dirname, "..");
const run = (name, args = [], env = {}) => spawnSync(process.execPath, [path.join(scripts, name), ...args], {
  encoding: "utf8",
  env: { ...process.env, ...env },
});

test("broadcast CLI requires explicit broadcast intent", () => {
  const result = run("broadcast-custom-registry-v2-deployment.mjs");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit --broadcast is required/);
});

test("broadcast CLI rejects a wrong authorization digest before any RPC or key use", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-cli-");
  try {
    const planPath = path.join(directory, "preflight.json");
    const authorizationPath = path.join(directory, "authorization.json");
    const planBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "programmable.custom-registry-deployment-preflight.v3",
      status: "PREFLIGHT_ONLY_NO_TRANSACTION",
      chainId: 1,
      broadcastAllowed: false,
      signingAllowed: false,
      createdAtTimestamp: Math.floor(Date.now() / 1000),
      expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60,
    })}\n`);
    await writeFile(planPath, planBytes);
    await writeFile(authorizationPath, "{}\n");
    const result = run("broadcast-custom-registry-v2-deployment.mjs", ["--broadcast", "--output", path.join(directory, "journal.jsonl")], {
      REGISTRY_REVIEWED_PLAN_PATH: planPath,
      REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
      REGISTRY_BROADCAST_AUTHORIZATION_PATH: authorizationPath,
      REGISTRY_BROADCAST_AUTHORIZATION_SHA256: `0x${"11".repeat(32)}`,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /broadcast authorization digest mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authorize CLI rejects stale and constructor-spliced preflights", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-auth-");
  try {
    const owner = "0xc7fB6d0d2b78A30D0D3599F7F4BAd5c9b87665AF";
    const base = {
      schemaVersion: "programmable.custom-registry-deployment-preflight.v3",
      status: "PREFLIGHT_ONLY_NO_TRANSACTION",
      chainId: 1,
      broadcastAllowed: false,
      signingAllowed: false,
      createdAtTimestamp: Math.floor(Date.now() / 1000) - 10,
      releaseAuthorization: { owner, maximumValiditySeconds: 300 },
      constructor: {
        initialAdminDelay: "10",
        initialAdmin: "0x0000000000000000000000000000000000000001",
        initialApprover: "0x0000000000000000000000000000000000000002",
        initialRegistrar: "0x0000000000000000000000000000000000000003",
        initialFinalizer: "0x0000000000000000000000000000000000000004",
        initialRevoker: "0x0000000000000000000000000000000000000005",
        minimumFinalityBlocks: "64",
        registryPolicyCommitment: `0x${"44".repeat(32)}`,
      },
      constructorCommitment: `0x${"11".repeat(32)}`,
    };
    const stalePath = path.join(directory, "stale.json");
    const safePath = path.join(directory, "safe.json");
    const safeBytes = Buffer.from("{}\n");
    await writeFile(safePath, safeBytes);
    await writeFile(stalePath, `${JSON.stringify({ ...base, expiresAtTimestamp: 1 })}\n`);
    const commonEnv = {
      REGISTRY_RELEASE_OWNER: owner,
      REGISTRY_AUTHORIZATION_EXPIRES_AT: String(Math.floor(Date.now() / 1000) + 60),
      REGISTRY_SAFE_VERIFICATION_PATH: safePath,
      REGISTRY_SAFE_VERIFICATION_SHA256: `0x${createHash("sha256").update(safeBytes).digest("hex")}`,
    };
    const stale = run("authorize-custom-registry-v2-deployment.mjs", ["--preflight", stalePath, "--print-message"], commonEnv);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /preflight plan is stale or invalid/);

    const splicedPath = path.join(directory, "spliced.json");
    await writeFile(splicedPath, `${JSON.stringify({ ...base, expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60 })}\n`);
    const spliced = run("authorize-custom-registry-v2-deployment.mjs", ["--preflight", splicedPath, "--print-message"], commonEnv);
    assert.notEqual(spliced.status, 0);
    assert.match(spliced.stderr, /source manifest|source identity|Safe controller|constructor commitment/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source verifier review freezes exact standard-json without submitting", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-source-review-");
  try {
    const onchainPath = path.join(directory, "onchain.json");
    const onchainBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "programmable.custom-registry-deployment-verification.v1",
      status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
      verified: false,
      chainId: 1,
      source: { commit: "a".repeat(40), tree: "b".repeat(40) },
      contractAddress: "0x0000000000000000000000000000000000000001",
      transactionHash: `0x${"11".repeat(32)}`,
      runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
      constructorArguments: "0x",
    })}\n`);
    await writeFile(onchainPath, onchainBytes);
    const result = run("verify-custom-registry-v2-source.mjs", [], {
      REGISTRY_ONCHAIN_VERIFICATION_PATH: onchainPath,
      REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(onchainBytes).digest("hex")}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REVIEW_ONLY_NO_EXTERNAL_ACTION/);
    assert.match(result.stdout, /standardJsonSha256/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
