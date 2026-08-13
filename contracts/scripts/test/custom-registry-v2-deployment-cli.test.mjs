import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scripts = path.resolve(import.meta.dirname, "..");
const run = (name, args = [], env = {}) =>
  spawnSync(process.execPath, [path.join(scripts, name), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

test("broadcast CLI requires explicit broadcast intent", () => {
  const result = run("broadcast-custom-registry-v2-deployment.mjs");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit --broadcast is required/);
});

test("both production broadcasters use protected Keychain custody instead of private-key environment variables", async () => {
  for (const name of [
    "broadcast-custom-registry-v2-safe-controllers.mjs",
    "broadcast-custom-registry-v2-deployment.mjs",
  ]) {
    const source = await readFile(path.join(scripts, name), "utf8");
    assert.match(source, /find-generic-password/);
    assert.doesNotMatch(source, /process\.env\.[A-Z0-9_]*PRIVATE_KEY/);
    assert.doesNotMatch(source, /createWalletClient/);
  }
});

test("broadcast CLI rejects a wrong authorization digest before any RPC or key use", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-cli-");
  try {
    const planPath = path.join(directory, "preflight.json");
    const authorizationPath = path.join(directory, "authorization.json");
    const planBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: "programmable.custom-registry-deployment-preflight.v3",
        status: "PREFLIGHT_ONLY_NO_TRANSACTION",
        chainId: 1,
        broadcastAllowed: false,
        signingAllowed: false,
        createdAtTimestamp: Math.floor(Date.now() / 1000),
        expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60,
      })}\n`,
    );
    await writeFile(planPath, planBytes);
    await writeFile(authorizationPath, "{}\n");
    const result = run(
      "broadcast-custom-registry-v2-deployment.mjs",
      ["--broadcast", "--output", path.join(directory, "journal.jsonl")],
      {
        REGISTRY_REVIEWED_PLAN_PATH: planPath,
        REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
        REGISTRY_BROADCAST_AUTHORIZATION_PATH: authorizationPath,
        REGISTRY_BROADCAST_AUTHORIZATION_SHA256: `0x${"11".repeat(32)}`,
      },
    );
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
      releaseAuthorization: {
        owner,
        maximumSigningAndFirstAttemptValiditySeconds: 300,
        authorizationSemantics:
          "SIGN_AND_FIRST_BROADCAST_ATTEMPT_ONLY_LATER_EXACT_RAW_REBROADCAST_AND_INCLUSION_ALLOWED",
      },
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
    await writeFile(
      stalePath,
      `${JSON.stringify({ ...base, expiresAtTimestamp: 1 })}\n`,
    );
    const commonEnv = {
      REGISTRY_RELEASE_OWNER: owner,
      REGISTRY_AUTHORIZATION_EXPIRES_AT: String(
        Math.floor(Date.now() / 1000) + 60,
      ),
      REGISTRY_SAFE_VERIFICATION_PATH: safePath,
      REGISTRY_SAFE_VERIFICATION_SHA256: `0x${createHash("sha256").update(safeBytes).digest("hex")}`,
    };
    const stale = run(
      "authorize-custom-registry-v2-deployment.mjs",
      ["--preflight", stalePath, "--print-message"],
      commonEnv,
    );
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /preflight plan is stale or invalid/);

    const splicedPath = path.join(directory, "spliced.json");
    await writeFile(
      splicedPath,
      `${JSON.stringify({ ...base, expiresAtTimestamp: Math.floor(Date.now() / 1000) + 60 })}\n`,
    );
    const spliced = run(
      "authorize-custom-registry-v2-deployment.mjs",
      ["--preflight", splicedPath, "--print-message"],
      commonEnv,
    );
    assert.notEqual(spliced.status, 0);
    assert.match(
      spliced.stderr,
      /source manifest|source identity|Safe controller|constructor commitment/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source verifier review freezes exact standard-json without submitting", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-source-review-");
  try {
    const root = path.resolve(scripts, "../..");
    const commit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    const artifact = JSON.parse(
      await readFile(
        path.join(
          root,
          "contracts/out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json",
        ),
      ),
    );
    const onchainPath = path.join(directory, "onchain.json");
    const onchainBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion:
          "programmable.custom-registry-deployment-verification.v1",
        status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
        verified: false,
        chainId: 1,
        source: { commit, tree },
        contractAddress: "0x0000000000000000000000000000000000000001",
        transactionHash: `0x${"11".repeat(32)}`,
        runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
        constructorArguments: "0x",
      })}\n`,
    );
    await writeFile(onchainPath, onchainBytes);
    const planPath = path.join(directory, "plan.json");
    const planBytes = Buffer.from(
      `${JSON.stringify({
        source: { commit, tree },
        expectedTransaction: { input: artifact.bytecode.object },
      })}\n`,
    );
    await writeFile(planPath, planBytes);
    const result = run("verify-custom-registry-v2-source.mjs", [], {
      REGISTRY_ONCHAIN_VERIFICATION_PATH: onchainPath,
      REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(onchainBytes).digest("hex")}`,
      REGISTRY_REVIEWED_PLAN_PATH: planPath,
      REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /REVIEW_ONLY_NO_EXTERNAL_ACTION/);
    assert.match(result.stdout, /standardJsonSha256/);
    const activeOutput = path.join(directory, "active-source.json");
    const active = run(
      "verify-custom-registry-v2-source.mjs",
      ["--capture", "--output", activeOutput],
      {
        REGISTRY_ONCHAIN_VERIFICATION_PATH: onchainPath,
        REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(onchainBytes).digest("hex")}`,
        REGISTRY_REVIEWED_PLAN_PATH: planPath,
        REGISTRY_REVIEWED_PLAN_SHA256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
      },
    );
    assert.notEqual(active.status, 0);
    assert.match(
      active.stderr,
      /exact clean reviewed source|fresh full onchain release verification/u,
    );
    await assert.rejects(() => readFile(activeOutput), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("final source verification rejects self-authored forged sidecars without the full release trust root", async () => {
  const directory = await mkdtemp("/tmp/registry-v2-forged-finalizer-");
  try {
    const forgedOnchainPath = path.join(directory, "onchain.json");
    const forgedSourcePath = path.join(directory, "source.json");
    const forgedOnchainBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion:
          "programmable.custom-registry-deployment-verification.v1",
        status: "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE",
        verified: false,
        chainId: 1,
        source: { commit: "a".repeat(40), tree: "b".repeat(40) },
        contractAddress: "0x0000000000000000000000000000000000000001",
        transactionHash: `0x${"11".repeat(32)}`,
        runtimeCodeKeccak256: `0x${"22".repeat(32)}`,
        constructorArguments: "0x",
      })}\n`,
    );
    const forgedSourceBytes = Buffer.from(
      `${JSON.stringify({
        schemaVersion: "programmable.custom-registry-source-verification.v2",
        status: "SELF_COMPILED_ETHERSCAN_EXACT_SOURCIFY_V2_EXACT",
        verified: true,
      })}\n`,
    );
    await writeFile(forgedOnchainPath, forgedOnchainBytes);
    await writeFile(forgedSourcePath, forgedSourceBytes);
    const outputPath = path.join(directory, "final.json");
    const result = run(
      "verify-custom-registry-v2-deployment.mjs",
      ["--finalize-source", "--output", outputPath],
      {
        REGISTRY_ONCHAIN_VERIFICATION_PATH: forgedOnchainPath,
        REGISTRY_ONCHAIN_VERIFICATION_SHA256: `0x${createHash("sha256").update(forgedOnchainBytes).digest("hex")}`,
        REGISTRY_SOURCE_VERIFICATION_PATH: forgedSourcePath,
        REGISTRY_SOURCE_VERIFICATION_SHA256: `0x${createHash("sha256").update(forgedSourceBytes).digest("hex")}`,
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /fresh full onchain release verification failed/u,
    );
    await assert.rejects(() => readFile(outputPath), /ENOENT/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
